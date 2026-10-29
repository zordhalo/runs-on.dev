import { createHash } from 'node:crypto';
import { getContentsMeta, putContents } from './registry.js';
import { signSiteToken } from './tokens.js';

// The deploy-token registry. Tokens themselves stay signed and stateless --
// the signature is still what proves authenticity -- but the registry is
// what makes them manageable: minting records an entry, listing reads them
// back, deleting removes one, and the deploy front door checks membership so
// a deleted or expired token stops working before its signature says so.
//
// One file per login, `tokens/<login>.json`, holding IDs and expiries and
// never a secret: entries store a SHA-256 of the token string, which nobody
// can turn back into a credential. The file is owner-scoped and written only
// by the session-authenticated token routes.

export const TOKEN_DURATION_DAYS = [1, 7, 30, 90];
const DEFAULT_DURATION_DAYS = 30;

export function tokenId(rawToken) {
  return createHash('sha256').update(rawToken).digest('hex').slice(0, 16);
}

export function normalizeDuration(days) {
  const n = Number(days);
  return TOKEN_DURATION_DAYS.includes(n) ? n : DEFAULT_DURATION_DAYS;
}

function pathFor(login) {
  return `tokens/${String(login).toLowerCase()}.json`;
}

function prune(entries) {
  const now = Date.now();
  return (entries ?? [])
    .filter((e) => e && typeof e.id === 'string' && typeof e.exp === 'number')
    .filter((e) => e.exp > now);
}

// Live entries for a login, expired ones dropped (the "auto delete" half:
// expiry is enforced lazily, on every read, so a deleted-on-expiry token
// stops verifying the moment it ages out). Returns null when the owner has
// never minted a tracked token.
export async function listTokens(login, { fetchImpl = fetch, token } = {}) {
  const meta = await getContentsMeta(pathFor(login), { fetchImpl, token }).catch(() => null);
  if (!meta) return null;
  return {
    sha: meta.sha,
    tokens: prune(meta.data?.tokens),
  };
}

// Append one entry. Reads the current list itself and merges, retrying once
// on a stale sha (another tab minted a token in between) so a concurrent
// mint loses neither entry.
export async function recordToken(login, entry, { fetchImpl = fetch, token, attempts = 2 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const listed = await listTokens(login, { fetchImpl, token });
    const meta = listed ?? { sha: null, tokens: [] };
    const tokens = prune([...meta.tokens, entry]);
    const res = await putContents(pathFor(login), { tokens }, {
      sha: meta.sha,
      fetchImpl,
      token,
      message: `token: mint by @${login}`,
    });
    if (res.ok || res.reason !== 'stale') return res;
  }
  return { ok: false, reason: 'stale' };
}

// Remove one entry by id. `had` says whether the id was actually there, so
// deleting an already-gone token can answer honestly instead of inventing a
// 404 on a race.
export async function revokeToken(login, id, { fetchImpl = fetch, token } = {}) {
  const listed = await listTokens(login, { fetchImpl, token });
  if (!listed) return { ok: true, had: false };

  const idPresent = listed.tokens.some((e) => e.id === id);
  const remaining = prune(listed.tokens.filter((e) => e.id !== id));
  // Nothing to remove and nothing aged out: no write needed.
  if (!idPresent && remaining.length === listed.tokens.length) {
    return { ok: true, had: false };
  }

  const res = await putContents(pathFor(login), { tokens: remaining }, {
    sha: listed.sha,
    fetchImpl,
    token,
    message: `token: revoke by @${login}`,
  });
  return { ...res, had: idPresent };
}

// Does this raw token still count? True when the signature was fine AND the
// registry does not contradict it: an unreadable registry (GitHub hiccup)
// lets the signature stand, because availability of the deploy path should
// not ride on a second service, but a registry that answer "not listed"
// is a revocation and wins.
export async function isTokenRevoked(login, rawToken, { fetchImpl = fetch, token } = {}) {
  let listed;
  try {
    listed = await listTokens(login, { fetchImpl, token });
  } catch {
    return false;
  }
  // No file: the login predates the registry, so its still-unexpired tokens
  // grandfather through until they age out naturally.
  if (!listed) return false;
  return !listed.tokens.some((e) => e.id === tokenId(rawToken));
}

// Sign and record in one step, for the two places that hand out tokens: the
// /manage mint button and the OAuth token endpoint. Recorded before it is
// returned: once tracking exists for this login, an unrecorded token would
// fail the front door's membership check, so a mint that cannot be recorded
// must not succeed.
export async function mintRecordedToken({ login, scope, days, secret, registryToken, fetchImpl = fetch, now = Date.now() }) {
  const ttlMs = days * 24 * 60 * 60 * 1000;
  const token = signSiteToken({ login, scope }, secret, { now, ttlMs });
  const recorded = await recordToken(login, {
    id: tokenId(token),
    scope,
    createdAt: now,
    exp: now + ttlMs,
  }, { token: registryToken, fetchImpl });
  if (!recorded.ok) return { ok: false, reason: recorded.reason };
  return { ok: true, token, expiresAt: now + ttlMs };
}
