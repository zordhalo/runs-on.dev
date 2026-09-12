import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(body, secret) {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

// Deploy tokens outlive any browser session (an agent or CI posts a zip weeks
// after its owner clicked "generate"), so 30 days rather than the session's
// 24 hours. One source of truth for the lifetime, like SESSION_TTL_MS.
export const SITE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The prefix makes a deploy token visually unmistakable from a session cookie
// in logs and bug reports, and the version digit means a future format change
// can ship as rod2 without rod1 tokens becoming ambiguous garbage.
const PREFIX = 'rod1';
export const SITE_TOKEN_SCOPE = 'sites';

export function signSiteToken(payload, secret, { now = Date.now() } = {}) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: now + SITE_TOKEN_TTL_MS }),
  ).toString('base64url');
  return `${PREFIX}.${body}.${sign(body, secret)}`;
}

// The token counterpart of readSession, with the same fail-closed rules: a
// valid signature only proves we minted the string, never that it is still
// current or of this version. Stateless by design -- the server stores
// nothing, so minting a new token cannot revoke an old one; rotation is the
// revocation path, and the manage UI says so in plain words.
export function readSiteToken(raw, secret, { now = Date.now() } = {}) {
  if (typeof raw !== 'string' || !secret) return null;

  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;

  const [prefix, body, provided] = parts;
  const expected = sign(body, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
  if (now >= payload.exp) return null;

  return payload;
}

// Deploy endpoints authenticate with `Authorization: Bearer rod1.…` instead of
// the session cookie, because the whole point is publishing from a terminal or
// an agent. Kept beside the session helper so neither route grows its own idea
// of how to find a credential.
export function siteTokenFromRequest(request, secret) {
  const header = request.headers.get('authorization') ?? '';
  const raw = header.match(/^Bearer\s+(rod1\.\S+)$/i)?.[1];
  return raw ? readSiteToken(raw, secret) : null;
}
