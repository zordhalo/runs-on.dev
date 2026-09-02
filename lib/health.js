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
