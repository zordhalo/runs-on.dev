import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(body, secret) {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

// One source of truth for the lifetime: the cookie's Max-Age is derived from
// this too, so the browser stops sending the session at the same moment the
// server stops honouring it.
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function signSession(payload, secret, { now = Date.now() } = {}) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: now + SESSION_TTL_MS }),
  ).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function readSession(cookie, secret, { now = Date.now() } = {}) {
  if (typeof cookie !== 'string') return null;
  const parts = cookie.split('.');
  if (parts.length !== 2) return null;

  const [body, provided] = parts;
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

  // Fail closed on anything without a usable expiry, which includes sessions
  // issued before this field existed. A valid signature only proves we minted
  // the cookie, never that it is still current -- without this check a copied
  // cookie stays a working credential forever, revocable only by rotating
  // SESSION_SECRET and signing out every user at once.
  if (!payload || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
  if (now >= payload.exp) return null;

  return payload;
}

// Both write paths onto the registry (claiming and editing) authenticate the
// same way: one signed cookie, read from the request. Kept here so neither
// route grows its own idea of how to find it.
export function sessionFromRequest(request, secret) {
  const cookie = request.headers.get('cookie') ?? '';
  const raw = cookie.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  return raw ? readSession(raw, secret) : null;
}
