import { validateName } from './name.js';
import { isReserved } from './blocklist.js';
import { checkEligibility } from './eligibility.js';

export const MAX_NAMES_PER_ACCOUNT = 1;

// Names the registry maintainer holds for their own open-source projects, on
// top of their one personal name. The exemption is per (account, name) pair,
// never per account, so it can't be used for any other name. Every entry is
// public here and listed in POLICY.md.
export const MAINTAINER_PROJECT_NAMES = Object.freeze({
  zordhalo: Object.freeze(['clatterbox', 'ninebrains']),
});

export function isMaintainerProjectName(login, name) {
  const names = MAINTAINER_PROJECT_NAMES[String(login ?? '').toLowerCase()];
  return Boolean(names?.includes(String(name ?? '').toLowerCase()));
}

// True when `login` may take `name` given how many names it already owns.
export function withinNameLimit(login, name, ownedCount) {
  return ownedCount < MAX_NAMES_PER_ACCOUNT || isMaintainerProjectName(login, name);
}

// Statuses where the server has already settled the question with a definitive
// "you cannot have this name". Everything else — including a check that could
// not run — leaves it open.
const SETTLED_NO = new Set([
  'taken',
  'reserved',
  'claimed',
  'limit_reached',
  'signin_required',
  'ineligible_age',
  'ineligible_repos',
]);

const IN_FLIGHT = new Set(['claiming', 'retrying']);

// Gates the "Claim it" button. The availability check is advisory: putRecord's
// atomic create is the authority on whether a name is free, and /api/claim
// answers `taken` from it directly. So a check that could not run (a bad
// registry token, a GitHub hiccup, a rate limit) must leave the button live —
// gating on a *successful* check instead strands the visitor with a dead
// button and no way to find out whether the name was ever theirs to take.
export function canAttemptClaim({ name, status }) {
  if (!validateName(name).ok) return false;
  if (typeof status === 'string' && status.startsWith('invalid_')) return false;
  return !SETTLED_NO.has(status) && !IN_FLIGHT.has(status);
}

// Clean ISO 3166-1 alpha-2 only. The claim route reads this from the edge
// (x-vercel-ip-country); anything missing or malformed means no country is
// recorded, never a guess.
const COUNTRY = /^[A-Z]{2}$/;

export function evaluateClaim({ name, session, existing, now = new Date(), ownedCount = 0, country }) {
  if (!session || !session.login) {
    return { ok: false, status: 401, code: 'signin_required' };
  }

  if (!validateName(name).ok) {
    return { ok: false, status: 400, code: 'invalid_name' };
  }

  if (isReserved(name).reserved) {
    return { ok: false, status: 403, code: 'reserved' };
  }

  const eligible = checkEligibility(
    { created_at: session.createdAt, public_repos: session.publicRepos },
    now,
  );
  if (!eligible.ok) {
    return { ok: false, status: 403, code: `ineligible_${eligible.reason}` };
  }

  if (!withinNameLimit(session.login, name, ownedCount)) {
    return { ok: false, status: 403, code: 'limit_reached' };
  }

  if (existing) {
    return { ok: false, status: 409, code: 'taken' };
  }

  const record = {
    name,
    owner: { github: session.login },
    claimedAt: now.toISOString(),
    records: {},
  };
  // Claim-time country, for aggregate stats only. Recorded at the exact
  // moment of the claim, from the request's edge-inferred country; absent
  // when the edge does not say (local dev) or says something malformed.
  if (typeof country === 'string' && COUNTRY.test(country)) record.country = country;
  return { ok: true, record };
}
