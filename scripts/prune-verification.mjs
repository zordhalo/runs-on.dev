import { readFile, writeFile, readdir } from 'node:fs/promises';
import { classifyClaim } from '../lib/health.js';
import { planVerificationPrune } from '../lib/prune.js';

// Frees slots at the capped `_vercel.runs-on.dev` TXT host by dropping the
// verification challenge from claims that have demonstrably finished
// verifying. See lib/prune.js for why this has to happen at the claim rather
// than at the DNS record.
//
// Writes nothing unless APPLY=true. The default is a report, because the
// failure mode of guessing wrong is breaking a stranger's domain verification.

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;
const APPLY = process.env.APPLY === 'true';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;

if (Number.isNaN(LIMIT) || LIMIT <= 0) {
  console.error(`prune-verification: LIMIT must be a positive number, got ${process.env.LIMIT}`);
  process.exit(1);
}

// Identical to the health-check probe, and deliberately so: this decides
// whether to delete someone's verification challenge on the strength of that
// classification, so it must be the same question, asked the same way.
async function probe(name) {
  try {
    const res = await fetch(`https://${name}.runs-on.dev/`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'runs-on-dev-prune-verification (github.com/zordhalo/runs-on.dev)' },
    });
    const body = await res.text();
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? '';
    return { ok: true, finalHost: new URL(res.url).hostname, title };
  } catch {
    return { ok: false };
  }
}

const claims = [];
for (const file of await readdir('domains')) {
  if (!file.endsWith('.json')) continue;
  try {
    claims.push(JSON.parse(await readFile(`domains/${file}`, 'utf8')));
  } catch (err) {
    // A record this run cannot read is a record it must not rewrite. Skipping
    // loudly is right: the prune is best-effort maintenance, not a gate.
    console.error(`prune: skipping unreadable ${file}: ${err.message}`);
  }
}

// Only names that actually hold a contended slot are worth a network round
// trip; the rest cannot be pruned whatever the probe says.
const { held } = planVerificationPrune(claims, () => 'unknown');
const queue = claims
  .filter((claim) => (claim.subdomains?._vercel?.TXT ?? []).some(
    (v) => typeof v === 'string' && v.startsWith('vc-domain-verify='),
  ))
  .map((claim) => claim.name);

console.log(`prune: ${queue.length} claim(s) hold ${held.total} value(s) at _vercel.runs-on.dev (cap 50)`);

const probes = new Map();
const pending = [...queue];
async function worker() {
  while (pending.length > 0) {
    const name = pending.shift();
    probes.set(name, await probe(name));
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

const byName = new Map(claims.map((c) => [c.name, c]));
const statusOf = (name) => classifyClaim(byName.get(name), probes.get(name));
const plan = planVerificationPrune(claims, statusOf, { limit: LIMIT });

console.log('\nheld by status:');
for (const [status, n] of Object.entries(plan.held.byStatus).sort()) {
  console.log(`  ${status.padEnd(9)} ${n}`);
}

if (plan.prune.length === 0) {
  console.log('\nnothing to prune: no claim holding a challenge is serving its own site yet.');
  process.exit(0);
}

console.log(`\n${APPLY ? 'pruning' : 'would prune'} ${plan.prune.length} claim(s), freeing ${plan.freed} slot(s):`);
for (const { name, freed } of plan.prune) {
  console.log(`  ${name} (-${freed})`);
}
if (plan.skipped.length > 0) {
  console.log(`\n${plan.skipped.length} further candidate(s) held back by LIMIT=${LIMIT}.`);
}

const remaining = plan.held.total - plan.freed;
console.log(`\n_vercel.runs-on.dev: ${plan.held.total} -> ${remaining} of 50`);

if (!APPLY) {
  console.log('\ndry run. re-run with APPLY=true to write these changes.');
  process.exit(0);
}

for (const { name, next } of plan.prune) {
  await writeFile(`domains/${name}.json`, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`pruned domains/${name}.json`);
}

console.log(`\nprune-verification: rewrote ${plan.prune.length} record(s), freed ${plan.freed} slot(s).`);
