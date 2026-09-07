import { appendFile, readFile, readdir } from 'node:fs/promises';
import {
  classifyClaim, planIssueClosures, planIssueOpens, diagnoseStuck, stuckIssueBody,
  STUCK_LABEL, findDrift, normalizeAnswer, expectationKey,
} from '../lib/health.js';
import { planDnsChanges, planZoneVerificationRecords } from '../lib/dns.js';
import { Resolver } from 'node:dns/promises';

const DOMAIN = 'runs-on.dev';
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;

// A stuck name keeps the registry's own 200 and certificate, so nothing
// errors anywhere: the owner believes it works until someone reads the page.
// The title check is what separates the two worlds — a verified name is
// served BY the provider ON our hostname, so the hostname alone can't tell
// them apart, but the provider's page never carries the card's
// "<name> (name.runs-on.dev)" title.
async function probe(name) {
  try {
    const res = await fetch(`https://${name}.runs-on.dev/`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'runs-on-dev-health-check (github.com/zordhalo/runs-on.dev)' },
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
    console.error(`health: skipping unreadable ${file}: ${err.message}`);
  }
}

const queue = claims
  .filter((claim) => claim.records?.CNAME || (claim.records?.A ?? []).length)
  .map((claim) => claim.name);
const probes = new Map();

async function worker() {
  while (queue.length > 0) {
    const name = queue.shift();
    probes.set(name, await probe(name));
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

const SEVERITY = { stuck: 0, down: 1, ok: 2, redirect: 3, card: 4 };
const rows = claims
  .map((claim) => ({ name: claim.name, status: classifyClaim(claim, probes.get(claim.name)) }))
  .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.name.localeCompare(b.name));

const counts = {};
for (const { status } of rows) counts[status] = (counts[status] ?? 0) + 1;

const lines = [
  `# DNS health — ${new Date().toISOString()}`,
  '',
  `${rows.length} claims: ${Object.entries(counts)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ')}`,
  '',
  '| name | status |',
  '| --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.status} |`),
  '',
];

const stuck = rows.filter((row) => row.status === 'stuck');
if (stuck.length > 0) {
  lines.push(
    '## Stuck on the profile card despite pointing elsewhere',
    '',
    'These names have provider records, but the wildcard profile card still',
    'answers, which means provider-side ownership verification has not',
    'completed. For Vercel that is the zone-level `_vercel` challenge — see',
    'issue #26 and the zone mirror in `scripts/sync-dns.mjs`.',
    '',
    ...stuck.map((row) => `- ${row.name}`),
    '',
  );
}

const report = lines.join('\n');
process.stdout.write(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, report, 'utf8');
}

// Close the nudge issues whose names have come back. Without this the probe
// knows a name recovered and the person who was told it was broken is never
// told otherwise, so the tracker fills with issues nobody owns closing.
//
// Everything here is best effort and deliberately cannot fail the run: the
// probe result above is the point of this script, and losing it because the
// issues API had a bad minute would be a poor trade.
await closeRecoveredIssues(rows);

// The other half. Without this the check knew a name was broken and never
// told the one person who could fix it.
await openStuckIssues(rows, claims);

// `stuck` and `down` are reported, never failed on. Both describe something
// a third party has not done -- an owner who has not re-run their provider's
// verification, a host having a bad afternoon -- and a scheduled job that
// goes red for weeks over someone else's dashboard is a job everyone learns
// to ignore, including on the day it means something. The open dns-stuck
// issues track those, one per owner, and close themselves.
//
// Drift is different. It means the registry declares a record that DNS does
// not serve, which can only be sync-dns having failed silently. That is ours,
// it is actionable, and nothing else looks for it.
const drift = await findDnsDrift(claims);

if (drift.length > 0) {
  console.error(`health: ${drift.length} declared record(s) missing from DNS`);
  for (const record of drift) console.error(`  ${record.type} ${record.host} -> ${record.want}`);

  // Drift used to exit 1 and stop there, which made it an alarm nobody could
  // act on without opening a laptop -- and, worse, a red run masks every other
  // finding in the same job. `selim`'s quoted TXT held this red for days and
  // hid two names whose DNS was genuinely missing.
  //
  // It is now self-healing: the names are handed to the repair job, which
  // calls sync-dns with exactly them. That is the same path a human would
  // take by hand (workflow_dispatch with `names`), so nothing new can go
  // wrong that could not already. The alarm moves with it -- if the repair
  // fails, that job goes red, which is the signal that actually needs a
  // person. Exiting 0 here is what lets the repair job run at all.
  // The last label before the domain is the claim: `arpitraj.runs-on.dev` and
  // `_vercel.arpitraj.runs-on.dev` both belong to `arpitraj`. The zone mirror
  // at `_vercel.runs-on.dev` belongs to no claim and yields `_vercel`, so the
  // result is intersected with the registry -- sync-dns rebuilds the mirror on
  // every run regardless of which names it was given, so repairing any real
  // name repairs the mirror alongside it.
  const registry = new Set(claims.map((claim) => claim.name));
  const names = [...new Set(
    drift
      .map((record) => String(record.host).replace(`.${DOMAIN}`, '').split('.').pop())
      .filter((name) => registry.has(name)),
  )].sort();

  if (names.length === 0) {
    console.error('health: drift is at the zone level only, which no per-name resync repairs');
    process.exit(1);
  }

  console.error(`health: handing ${names.length} name(s) to the repair job: ${names.join(' ')}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `drifted=${names.join(' ')}\n`, 'utf8');
  }
  process.exit(0);
}
console.log(`health: every declared record is live in DNS (${stuck.length} name(s) awaiting provider verification)`);

async function findDnsDrift(allClaims) {
  const expected = [
    ...allClaims.flatMap((claim) =>
      planDnsChanges(claim).map((change) => ({ ...change, host: `${change.name}.${DOMAIN}` }))),
    ...planZoneVerificationRecords(allClaims).map((change) => ({ ...change, host: `${change.name}.${DOMAIN}` })),
  ];

  // A public resolver rather than the runner's: the runner's may cache an
  // answer from before a sync, which would read as drift that is not there.
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers(['1.1.1.1', '8.8.8.8']);

  const resolved = new Map();
  const hosts = [...new Set(expected.map((e) => expectationKey(e.type, e.host)))];
  for (const key of hosts) {
    const [type, host] = key.split(' ');
    resolved.set(key, await lookup(resolver, type, host));
  }

  const missing = findDrift(expected, resolved);
  if (missing.length === 0) return [];

  // Re-check only what looked missing, once, before calling it drift. A
  // record written minutes before this run may simply not have propagated,
  // and a daily job that cries wolf over propagation is the noise this
  // change exists to remove.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const recheck = new Map();
  for (const record of missing) recheck.set(record.key, await lookup(resolver, record.type, record.host));
  return findDrift(missing, recheck);
}

async function lookup(resolver, type, host) {
  try {
    if (type === 'CNAME') return (await resolver.resolveCname(host)).map((v) => normalizeAnswer('CNAME', v));
    if (type === 'A') return await resolver.resolve4(host);
    if (type === 'TXT') return (await resolver.resolveTxt(host)).map((chunks) => chunks.join(''));
    if (type === 'MX') {
      return (await resolver.resolveMx(host))
        .map((mx) => normalizeAnswer('MX', `${mx.priority} ${mx.exchange}`));
    }
  } catch {
    // NXDOMAIN, NODATA, or a resolver hiccup all mean "this host does not
    // serve what we expect right now", which the caller re-checks before
    // reporting.
  }
  return [];
}

async function closeRecoveredIssues(statusRows) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  // Absent locally, which is why running this by hand probes and reports but
  // never writes.
  if (!token || !repo) return;

  const api = (path, init = {}) =>
    fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
    });

  let issues;
  try {
    const res = await api(`/issues?state=open&labels=${STUCK_LABEL}&per_page=100`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // The issues endpoint returns pull requests too; they are not nudges.
    issues = (await res.json()).filter((issue) => !issue.pull_request);
  } catch (err) {
    console.error(`health: could not list ${STUCK_LABEL} issues: ${err.message}`);
    return;
  }

  for (const { number, name } of planIssueClosures(statusRows, issues)) {
    try {
      await api(`/issues/${number}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: `\`${name}.runs-on.dev\` is serving your site now, so this is resolved. `
            + 'Closed automatically by the daily health check — reopen if it regresses.',
        }),
      });
      const res = await api(`/issues/${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      console.log(`closed #${number} (${name} recovered)`);
    } catch (err) {
      console.error(`health: could not close #${number}: ${err.message}`);
    }
  }
}

async function openStuckIssues(statusRows, allClaims) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return;

  const api = (path, init = {}) =>
    fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
    });

  // Two lists, because either alone lets a duplicate through.
  //
  // Labelled in every state: an owner who closed their nudge without fixing
  // the name should not be handed a fresh one every morning.
  //
  // Open issues regardless of label: a nudge opened by hand carries no label,
  // and the first real run filed a second issue at an owner who already had
  // one open and a conversation running in it. Deduping on the hostname in
  // the title rather than on the label is what stops that.
  let issues;
  try {
    const [labelled, open] = await Promise.all([
      api(`/issues?state=all&labels=${STUCK_LABEL}&per_page=100`),
      api('/issues?state=open&per_page=100'),
    ]);
    if (!labelled.ok) throw new Error(`${labelled.status} ${labelled.statusText}`);
    if (!open.ok) throw new Error(`${open.status} ${open.statusText}`);
    issues = [...await labelled.json(), ...await open.json()].filter((issue) => !issue.pull_request);
  } catch (err) {
    console.error(`health: could not list issues to dedupe against: ${err.message}`);
    return;
  }

  const byName = new Map(allClaims.map((claim) => [claim.name, claim]));
  for (const { name } of planIssueOpens(statusRows, issues)) {
    const claim = byName.get(name);
    if (!claim) continue;
    const kind = diagnoseStuck(claim);
    const body = stuckIssueBody(kind, name, claim);

    try {
      const res = await api('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: `${name}.runs-on.dev is not serving your site yet`,
          body,
          labels: [STUCK_LABEL],
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const { number } = await res.json();
      console.log(`opened #${number} (${name}: ${kind})`);
    } catch (err) {
      console.error(`health: could not open an issue for ${name}: ${err.message}`);
    }
  }
}
