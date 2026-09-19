function planFor(name, records, changes) {
  if (records.CNAME) changes.push({ type: 'CNAME', name, value: records.CNAME });
  for (const value of records.A ?? []) changes.push({ type: 'A', name, value });
  for (const value of records.TXT ?? []) changes.push({ type: 'TXT', name, value });
  for (const mx of records.MX ?? []) {
    changes.push({ type: 'MX', name, value: mx.value, priority: mx.priority });
  }
  // URL redirects are served by the app itself off the wildcard record, so
  // they plan no DNS change at all.
}

export function planDnsChanges(record) {
  const changes = [];
  const { name, records = {}, subdomains = {} } = record;

  planFor(name, records, changes);

  for (const [label, subRecords] of Object.entries(subdomains)) {
    planFor(`${label}.${name}`, subRecords, changes);
  }

  return changes;
}

// Vercel proves ownership of a subdomain by reading a TXT challenge from
// `_vercel.<apex>` — zone level, one label ABOVE every claim — whenever the
// apex itself is registered in a Vercel account. No `domains/<name>.json`
// can express that host (`subdomains` records are always children of the
// claim's own name), so a `_vercel` TXT planned by planDnsChanges lands at
// `_vercel.<name>` and verification stays pending while the wildcard keeps
// answering with the profile card (issue #26).
//
// The sync therefore mirrors every claim's `_vercel` TXT values to the zone
// level. TXT values coexist on one host, so each claim contributes its own
// `vc-domain-verify=<name>.runs-on.dev,<token>` string at `_vercel.runs-on.dev`
// without disturbing anyone else's.
export const ZONE_VERIFICATION_LABEL = '_vercel';

export function planZoneVerificationRecords(claims, { domain = 'runs-on.dev' } = {}) {
  const values = new Set();
  for (const claim of claims) {
    // A claim may only mirror a challenge naming its OWN hostname. Without
    // this the mirror is a domain takeover: `records` and `subdomains` are
    // owner-controlled and editable from /manage with no review, so a claim
    // holding `vc-domain-verify=runs-on.dev,<their token>` would have that
    // published at `_vercel.runs-on.dev` and could attach the apex itself to
    // someone else's Vercel account. The same check stops one claim
    // publishing a challenge for another claim's name.
    const prefix = `vc-domain-verify=${claim.name}.${domain},`;
    for (const value of claim.subdomains?.[ZONE_VERIFICATION_LABEL]?.TXT ?? []) {
      if (typeof value === 'string' && value.startsWith(prefix)) values.add(value);
    }
  }
  return [...values].map((value) => ({ type: 'TXT', name: ZONE_VERIFICATION_LABEL, value }));
}

// `desired` comes from planZoneVerificationRecords over ALL claims; `actual`
// is what the zone currently holds at `_vercel`, straight from the API.
//
// Removal is deliberately restricted to TXT values starting
// `vc-domain-verify=`: those are the only values this mirror creates, so a
// TXT hand-placed at that host by the operator survives every sync
// untouched. A stale `vc-domain-verify=` value whose claim is gone or has
// dropped the record is exactly what must be cleaned up.
export function reconcileZoneVerification(desired, actual) {
  const have = new Set(actual.map((record) => record.value));
  const want = new Set(desired.map((change) => change.value));
  return {
    create: desired.filter((change) => !have.has(change.value)),
    remove: actual.filter(
      (record) =>
        record.type === 'TXT' &&
        typeof record.value === 'string' &&
        record.value.startsWith('vc-domain-verify=') &&
        !want.has(record.value),
    ),
  };
}

// Vercel caps one TXT hostname at 50 values (issues #104, #105). Past it a
// create returns 400, and failing the whole run on that turned every sync red
// — for every name, not just the ones waiting on the mirror. Instead, publish
// what fits and hand back the rest as `deferred`, so the caller can prune
// verified claims and let the resulting push publish them.
//
// `actual` counts in full, hand-placed values included: they hold slots too.
export const ZONE_VERIFICATION_CAP = 50;

export function fitZoneVerification(create, remove, actual, cap = ZONE_VERIFICATION_CAP) {
  const free = Math.max(0, cap - (actual.length - remove.length));
  return { create: create.slice(0, free), deferred: create.slice(free) };
}

// Vercel's DNS REST endpoints, kept here rather than inline in the sync script
// so the paths themselves are under test. The delete path is the reason: it is
// `/v2/domains/{domain}/records/{recordId}`, and a version missing the
// `{domain}` segment returns 404 for every record that exists, which reads as
// "already gone" but is really "wrong URL".
//
// Listing stays on v4 deliberately. v5 is current, but v4 is what this zone has
// been paginated with in production; moving versions is a separate, verifiable
// change and not part of fixing the delete.
export function listPath(domain, cursor = '') {
  const base = `/v4/domains/${domain}/records?limit=100`;
  return cursor ? `${base}&until=${cursor}` : base;
}

export function createPath(domain) {
  return `/v2/domains/${domain}/records`;
}

export function removePath(domain, recordId) {
  return `/v2/domains/${domain}/records/${encodeURIComponent(recordId)}`;
}

// The sync script used to log a bare status code on a failed create or delete
// (`failed to create TXT _vercel: 400`), which is why two independent zone
// TXT-mirror failures (#104) couldn't be diagnosed by anyone reading the
// Action log — the API's own reason for the 400 was fetched and then
// discarded. This formats whatever the response body turns out to be into
// one line, without assuming its shape, so the next failure explains itself.
export function formatApiError(status, body) {
  if (!body) return `${status}`;
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message ?? parsed?.error?.code;
    if (message) return `${status} ${message}`;
  } catch {
    // Not JSON — fall through and log the raw body.
  }
  const trimmed = body.trim();
  return trimmed ? `${status} ${trimmed}` : `${status}`;
}

// The diff that makes a sync safe: only the records that genuinely changed
// are touched, and everything else survives untouched. The old flow —
// delete every record for the name, then recreate them all — meant a single
// failed create after a successful delete left a working name with no DNS
// at all (issue #54). This shrinks the blast radius of a mid-sync failure
// from "every record the name has" to "only the part being changed".
//
// Records are matched by type + name + value + MX priority. The Vercel API
// returns `mxPriority` on existing records while planDnsChanges emits
// `priority` on desired ones, so the key reads both.
export function reconcileDnsRecords(existing, desired) {
  const key = (record) => {
    const priority = record.mxPriority ?? record.priority ?? '';
    // Vercel lists hostnames fully qualified (`cname.vercel-dns.com.`);
    // records hold the bare form. Unnormalised, an unchanged CNAME never
    // matched and was deleted and recreated on every sync of the name.
    const value = record.type === 'TXT' ? record.value : String(record.value).replace(/\.$/, '');
    return `${record.type}|${record.name}|${value}|${priority}`;
  };

  const existingKeys = new Set(existing.map(key));
  const desiredKeys = new Set(desired.map(key));

  return {
    unchanged: existing.filter((r) => desiredKeys.has(key(r))),
    remove: existing.filter((r) => !desiredKeys.has(key(r))),
    create: desired.filter((r) => !existingKeys.has(key(r))),
  };
}

// A push run only ever synced the files its own push touched, and GitHub keeps
// one pending run per concurrency group: a third push cancels the queued
// second, and that push's names never reached DNS (vishal, vinit). No log
// line, no red run -- the next push is green because it synced something
// else. The sweep closes that for good by having every run converge the whole
// registry against the zone listing it already paged in full.
//
// Pure planning, no API calls: hands back only the names whose DNS differs
// from their claim, so an in-sync zone costs nothing but the one listing.
// `released` is every name whose file has ever been deleted; one that still
// holds records and has not been reclaimed is a release whose sync was lost,
// and plans an empty desired set. Records for a label that was never a claim
// (hand-placed by the operator) are never selected.
export function planSweep(claims, zone, { skip = new Set(), released = new Set() } = {}) {
  const byLabel = new Map();
  for (const record of zone) {
    // The last label is the claim: `blog.lucas` and `_vercel.lucas` both
    // belong to `lucas`, the same rule existingFor applies in the sync.
    const label = String(record.name).split('.').pop();
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(record);
  }

  const drifted = [];
  const claimed = new Set();
  for (const claim of claims) {
    claimed.add(claim.name);
    if (skip.has(claim.name)) continue;
    const desired = planDnsChanges(claim);
    const { remove, create } = reconcileDnsRecords(byLabel.get(claim.name) ?? [], desired);
    if (remove.length > 0 || create.length > 0) drifted.push({ name: claim.name, desired });
  }
  for (const name of released) {
    if (claimed.has(name) || skip.has(name) || !byLabel.has(name)) continue;
    drifted.push({ name, desired: [] });
  }
  return drifted.sort((a, b) => a.name.localeCompare(b.name));
}

// Runs `syncOne` for every name and hands back the ones that failed, by a
// false return or a throw. The sync used to exit on the first bad record, so
// one value Vercel rejected skipped every later name in the push and the
// zone mirror too, and stayed red until someone fixed that record.
export async function syncEach(names, syncOne) {
  const failed = [];
  for (const name of names) {
    let ok = false;
    try {
      ok = await syncOne(name);
    } catch (err) {
      console.error(`sync-dns: ${name}: ${err.message}`);
    }
    if (!ok) failed.push(name);
  }
  return failed;
}
