import { ZONE_VERIFICATION_LABEL } from './dns.js';

// Vercel caps a single TXT hostname at 50 values, and every claim that mirrors
// a challenge contributes one to `_vercel.runs-on.dev` (issues #104, #105).
// Past the cap sync-dns cannot publish, so the next claim's verification can
// never complete — the registry stops accepting new Vercel-hosted names.
//
// The challenge is only needed WHILE a domain is pending verification. Once
// the provider has verified, the value is dead weight holding a capped slot.
// But `planZoneVerificationRecords` re-derives the desired set from the claim
// files on every run, so deleting the DNS record alone is futile: the next
// sync recreates it. Removing it from the claim is what makes it stay gone —
// `desired` shrinks and the existing reconciler cleans up the record with no
// new logic.
const CHALLENGE_PREFIX = 'vc-domain-verify=';

// Only `subdomains._vercel` is mirrored to the zone. A nested label like
// `_vercel.recruitment` publishes to `_vercel.recruitment.<name>.runs-on.dev`,
// which is a different host with its own 50-value budget, so it holds none of
// the contended slots and must be left alone.
export function zoneChallengeValues(claim) {
  const values = claim?.subdomains?.[ZONE_VERIFICATION_LABEL]?.TXT ?? [];
  return values.filter((v) => typeof v === 'string' && v.startsWith(CHALLENGE_PREFIX));
}

// Returns the record as it should be written once the challenge is dropped,
// or null when there is nothing to drop. Everything else on the record is
// carried through untouched: other subdomain labels, records, profile.
//
// An emptied `subdomains` object is removed rather than left as `{}`, because
// the schema treats the key as optional and a bare `{}` is noise in a file
// people read and hand-edit.
export function withoutZoneChallenge(claim) {
  if (zoneChallengeValues(claim).length === 0) return null;

  const subdomains = { ...claim.subdomains };
  const entry = { ...subdomains[ZONE_VERIFICATION_LABEL] };

  // The label may carry values this prune does not own — anything that is not
  // a `vc-domain-verify=` challenge stays, and the label survives with it.
  const keep = (entry.TXT ?? []).filter(
    (v) => !(typeof v === 'string' && v.startsWith(CHALLENGE_PREFIX)),
  );
  if (keep.length > 0) {
    entry.TXT = keep;
    subdomains[ZONE_VERIFICATION_LABEL] = entry;
  } else {
    delete entry.TXT;
    if (Object.keys(entry).length > 0) subdomains[ZONE_VERIFICATION_LABEL] = entry;
    else delete subdomains[ZONE_VERIFICATION_LABEL];
  }

  const next = { ...claim };
  if (Object.keys(subdomains).length > 0) next.subdomains = subdomains;
  else delete next.subdomains;
  return next;
}

// `status` comes from classifyClaim in lib/health.js, which is already the
// registry's answer to "is this name serving its owner's site, or still the
// wildcard profile card?".
//
// Only 'ok' is pruned. It is the one status that is positive evidence the
// provider finished verifying: something that is not the registry's own card
// is answering on the owner's hostname, which cannot happen until the
// provider has taken ownership. 'stuck' is the opposite — verification has
// NOT completed and the challenge is still load-bearing. 'down', 'card' and
// 'redirect' are all ambiguous (mid-setup, or provider outage), and the cost
// of guessing wrong is breaking someone's verification, so they are left.
const PRUNABLE = new Set(['ok']);

export function planVerificationPrune(claims, statusOf, { limit = Infinity } = {}) {
  const candidates = [];
  const held = { total: 0, byStatus: {} };

  for (const claim of claims) {
    const values = zoneChallengeValues(claim);
    if (values.length === 0) continue;

    const status = statusOf(claim.name) ?? 'unknown';
    held.total += values.length;
    held.byStatus[status] = (held.byStatus[status] ?? 0) + values.length;

    if (!PRUNABLE.has(status)) continue;
    const next = withoutZoneChallenge(claim);
    if (next) candidates.push({ name: claim.name, status, freed: values.length, next });
  }

  // Deterministic order so a dry run and the apply that follows it agree on
  // which records a `limit` selects.
  candidates.sort((a, b) => a.name.localeCompare(b.name));

  const prune = candidates.slice(0, limit);
  return {
    prune,
    skipped: candidates.slice(limit),
    held,
    freed: prune.reduce((n, c) => n + c.freed, 0),
  };
}
