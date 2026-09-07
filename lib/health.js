// Classification for one claimed name, given the result of probing it. Pure:
// the script owns the network, this owns the meaning, so the meanings stay
// under test without a socket in sight.
//
// 'card'     No records: the wildcard serving the profile card IS the
//            intended state.
// 'redirect' A URL record: served by the app itself, DNS never points away.
// 'ok'       Records point at a provider and something that is not the
//            profile card answers.
// 'stuck'    Records point at a provider but the wildcard card still
//            answers — provider-side ownership verification has not
//            completed (the issue #26 class: the CNAME resolves, the probe
//            returns 200 with a certificate, and it is still the registry's
//            own page the visitor gets).
// 'down'     Records point at a provider and nothing answered the probe.
export function classifyClaim(claim, probe) {
  const records = claim.records ?? {};
  if (records.URL) return 'redirect';
  if (!records.CNAME && !(records.A ?? []).length) return 'card';
  if (!probe?.ok) return 'down';
  const host = `${claim.name}.runs-on.dev`;
  const answeredByCard = probe.finalHost === host && (probe.title ?? '').endsWith(`(${host})`);
  return answeredByCard ? 'stuck' : 'ok';
}

// The label the nudge issues carry. Matching on a label rather than on the
// title alone means an unrelated issue that happens to open with a claimed
// name can never be closed by this.
export const STUCK_LABEL = 'dns-stuck';

// A nudge issue is titled `<name>.runs-on.dev ...`, so the name it concerns
// is recoverable from the title. Anything that does not match that shape
// returns null and is left alone.
export function issueName(title) {
  const match = /^([a-z0-9-]+)\.runs-on\.dev\b/.exec(String(title ?? ''));
  return match ? match[1] : null;
}

// Only `ok` and `redirect` count as recovered. Deliberately not `card`: a
// name whose records were removed is no longer stuck, but it is not serving
// the owner's site either, and closing with "this is working now" would be a
// lie. A human can close those.
const RECOVERED = new Set(['ok', 'redirect']);

// Which open nudge issues this run should close. Pure, so the decision is
// testable without touching the GitHub API — the script owns the network.
//
// An issue is only closed when its name is one this run actually probed. An
// issue naming something absent from the registry is left open: closing an
// issue we cannot account for is worse than leaving a stale one behind.
export function planIssueClosures(rows, issues) {
  const status = new Map((rows ?? []).map((row) => [row.name, row.status]));
  const closures = [];
  for (const issue of issues ?? []) {
    const name = issueName(issue.title);
    if (!name || !status.has(name)) continue;
    if (RECOVERED.has(status.get(name))) closures.push({ number: issue.number, name });
  }
  return closures;
}

// Which names this run should open a nudge issue for. The mirror of
// planIssueClosures, and the half that was missing: the script listed open
// issues, commented on them and closed the recovered ones, but nothing ever
// created one. Every nudge issue in the tracker had been opened by hand, so a
// name that went stuck after the last manual sweep was never mentioned to its
// owner -- 25 names were stuck with 5 issues between them.
//
// Only `stuck` opens an issue. `down` means nothing answered, which a host
// having a bad afternoon produces just as readily as a misconfiguration, and
// a robot filing an issue about someone's transient outage is noise. `stuck`
// is unambiguous: DNS resolves, the certificate is ours, and the registry's
// own card is answering, which only happens when provider-side verification
// has not completed.
//
// `cap` exists because the first run after this ships would otherwise file
// every backlogged name at once. Opening a few per run spreads it out, and a
// name that keeps failing gets picked up on a later run anyway.
export function planIssueOpens(rows, issues, { cap = 5 } = {}) {
  const spokenFor = new Set(
    (issues ?? []).map((issue) => issueName(issue.title)).filter(Boolean),
  );
  return (rows ?? [])
    .filter((row) => row.status === 'stuck' && !spokenFor.has(row.name))
    .slice(0, cap)
    .map((row) => ({ name: row.name }));
}

// What to actually tell the owner. A generic "your name is not serving"
// helps nobody; the registry can see which of a few specific mistakes was
// made, and saying so is the difference between an issue that gets fixed and
// one that gets ignored.
export function diagnoseStuck(claim) {
  const cname = claim?.records?.CNAME ?? '';
  const challenges = (claim?.subdomains?._vercel?.TXT ?? [])
    .filter((v) => typeof v === 'string' && v.startsWith('vc-domain-verify='));

  if (/\.vercel\.app$/i.test(cname)) return 'vercel-app-url';
  if (/vercel-dns/i.test(cname)) {
    return challenges.length === 0 ? 'vercel-no-challenge' : 'vercel-awaiting-verification';
  }
  if (/\.(github\.io|netlify\.app|pages\.dev)$/i.test(cname)) return 'platform-default-host';
  return 'unknown';
}

// What the nudge issue actually says. Kept here rather than in the script for
// two reasons: this is the text 18 strangers will read, so it should be under
// test like any other decision, and a module-level const in the script sat in
// the temporal dead zone at its call site -- the function that used it hoists,
// the const does not, so the first real run died with "Cannot access
// 'STUCK_BODY' before initialization". The local dry-run could not catch it,
// because with no token the writer returns early and never reaches the const.
const BODIES = {
  'vercel-app-url': (name, claim) => `Your record points at \`${claim.records.CNAME}\`, which is your project's **deployment URL** rather than a custom-domain target.

Vercel decides what to serve from the \`Host\` header, and \`${name}.runs-on.dev\` is not registered on your project, so nothing there matches it and your site is never served for this hostname. A CNAME to a \`.vercel.app\` address looks like it should work and never does.

**Fix:** add \`${name}.runs-on.dev\` as a domain on your Vercel project. Vercel will say the domain belongs to another team — it does, we own \`runs-on.dev\` — and offer you a \`vc-domain-verify=\` TXT challenge. Add that on [/manage](https://runs-on.dev/manage) as a subdomain record with label \`_vercel\` and type \`TXT\`, and replace the CNAME with the target Vercel shows you.`,

  'vercel-no-challenge': (name, claim) => `Your record points at \`${claim.records.CNAME}\`, which is the right kind of target — but no ownership challenge is published, so Vercel can never verify the domain.

\`runs-on.dev\` belongs to us rather than to you, so Vercel wants proof you control this specific name before it will serve it.

**Fix:** in your Vercel project's domain settings, copy the \`vc-domain-verify=${name}.runs-on.dev,…\` TXT value it offers. Add it on [/manage](https://runs-on.dev/manage) as a subdomain record with label \`_vercel\`, type \`TXT\`. Save, give our DNS sync a minute, then press **Refresh** on Vercel.`,

  'vercel-awaiting-verification': (name) => `Your CNAME and your \`_vercel\` TXT challenge are both published correctly, but \`${name}.runs-on.dev\` is still serving our profile card rather than your project — so Vercel has not finished verifying.

**Fix:** open your Vercel project's domain settings and press **Refresh** next to \`${name}.runs-on.dev\`. Verification usually needs that nudge once the DNS is in place.

If it still will not verify, say so here. A challenge value goes stale if the domain was removed and re-added on Vercel, in which case you need the new one.`,

  'platform-default-host': (name, claim) => `Your record points at \`${claim.records.CNAME}\`, your platform's default host, and nothing is answering for \`${name}.runs-on.dev\` there.

Pointing DNS at the platform is only half of it. The platform also has to be told it should answer for this hostname, or it has no matching site and falls through.

**Fix:** add \`${name}.runs-on.dev\` as a custom domain in your host's settings — GitHub Pages puts it under repo Settings → Pages → Custom domain; Netlify and Cloudflare Pages have the same under domain management.`,

  unknown: (name, claim) => `\`${name}.runs-on.dev\` resolves and holds a valid certificate, but it is serving our profile card rather than your site — which means your provider is not yet answering for this hostname.

Currently pointing at: \`${claim.records?.CNAME ?? (claim.records?.A ?? []).join(', ')}\`

**Fix:** whichever host you use, add \`${name}.runs-on.dev\` to it as a custom domain. DNS alone is not enough — the provider has to recognise the hostname before it serves anything for it.`,
};

export function stuckIssueBody(kind, name, claim) {
  const render = BODIES[kind] ?? BODIES.unknown;
  const owner = claim?.owner?.github;
  return `${owner ? `@${owner} — ` : ''}${render(name, claim)}

---
Opened automatically by the daily health check, which noticed \`${name}.runs-on.dev\` is serving the registry's profile card instead of your site. It closes itself once your name starts serving. If this is wrong, or you meant to serve the card, just close it.`;
}

// --- Drift between what the registry declares and what DNS actually serves ---
//
// This is the half of the health check that is ours to fix. A name stuck on
// the profile card is waiting on its owner; a name whose declared records
// never reached the zone means sync-dns did not do its job, silently, which
// is the failure mode behind both #21 and #26. Nothing else looks for it.

// Answers arrive in shapes that differ from what a record file declares:
// resolvers hand back hostnames with a trailing dot and in arbitrary case,
// and Node splits a long TXT string into chunks. Comparing raw would report
// drift that is not there.
export function normalizeAnswer(type, value) {
  if (type === 'CNAME' || type === 'MX') {
    return String(value).toLowerCase().replace(/\.$/, '');
  }
  // A TXT value is often written wrapped in double quotes, because that is how
  // zone files present one and how most provider docs show it. The quotes are
  // presentation, not content: the provider stores the inner string, so a
  // record declaring `"Under Construction"` and DNS holding `Under
  // Construction` are the same record. Comparing them raw reported permanent
  // drift that no resync could ever clear, and failed health-check forever --
  // which matters because that failure masks every other finding in the run.
  //
  // Only one fully-surrounding pair is stripped, so a value with quotes inside
  // it keeps them.
  if (type === 'TXT') {
    const v = String(value);
    return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
  }
  return String(value);
}

export function expectationKey(type, host) {
  return `${type} ${String(host).toLowerCase().replace(/\.$/, '')}`;
}

// `expected` is planDnsChanges output (plus the zone mirror), each entry
// carrying the host it belongs at. `resolved` maps expectationKey() to the
// normalized values that host actually serves.
//
// A subset check, not an exact match: the zone legitimately holds records
// this registry never planned -- the apex, the wildcard, anything the
// operator placed by hand -- and reporting those as drift would make the
// gate cry wolf on its first run.
export function findDrift(expected, resolved) {
  const missing = [];
  for (const record of expected) {
    const key = expectationKey(record.type, record.host);
    const want = normalizeAnswer(record.type, record.type === 'MX'
      ? `${record.priority} ${record.value}`
      : record.value);
    const have = resolved.get(key) ?? [];
    if (!have.includes(want)) missing.push({ ...record, key, want });
  }
  return missing;
}
