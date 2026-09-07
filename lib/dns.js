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
    return `${record.type}|${record.name}|${record.value}|${priority}`;
  };

  const existingKeys = new Set(existing.map(key));
  const desiredKeys = new Set(desired.map(key));

  return {
    unchanged: existing.filter((r) => desiredKeys.has(key(r))),
    remove: existing.filter((r) => !desiredKeys.has(key(r))),
    create: desired.filter((r) => !existingKeys.has(key(r))),
  };
}
