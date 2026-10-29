import { SITE_TOKEN_SCOPE, MANAGE_TOKEN_SCOPE } from '../../../lib/tokens.js';
import { normalizeDuration, mintRecordedToken, listTokens, revokeToken } from '../../../lib/token-registry.js';
import { sessionFromRequest } from '../../../lib/session.js';
import { createRateLimiter, rateLimitHeaders } from '../../../lib/throttle.js';

// Minting is a no-op on the wire (the token is signed, not stored), but it
// writes one registry entry and should still not be free: a leaned-on button
// or a stuck loop minting thousands of valid credentials is its own kind of
// incident. Tight enough that a human generating, copying, and pasting never
// trips it.
const MINT_WINDOW_MS = 10 * 60 * 1000;
const MINT_MAX = 5;
const takeMint = createRateLimiter({ windowMs: MINT_WINDOW_MS, max: MINT_MAX });

// Every route here is session-gated: listing and revoking speak for the
// signed-in login and nobody else's, and minting records under that login.

// The list half. Previously created keys, live ones only -- entries expire
// out of the registry on read, which is the "auto delete" half -- each with
// its id (for the delete button), its creation date, and its expiry. The
// tokens themselves never come back: they were shown once at mint.
export async function GET(request) {
  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  if (!session?.login) {
    return Response.json({ error: 'signin_required' }, { status: 401 });
  }

  try {
    const listed = await listTokens(session.login, { token: process.env.REGISTRY_TOKEN });
    return Response.json({
      tokens: (listed?.tokens ?? []).map(({ id, createdAt, exp, scope }) => ({
        id,
        // Entries minted before scopes existed are all deploy tokens.
        scope: scope ?? SITE_TOKEN_SCOPE,
        createdAt: createdAt ?? null,
        expiresAt: new Date(exp).toISOString(),
      })),
    });
  } catch {
    return Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '4' } });
  }
}

export async function POST(request) {
  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  if (!session?.login) {
    return Response.json({ error: 'signin_required' }, { status: 401 });
  }

  const budget = takeMint(session.login.toLowerCase());
  if (!budget.ok) {
    const seconds = Math.ceil(budget.retryAfterMs / 1000);
    return Response.json(
      { error: 'rate_limited', retryInMs: budget.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(seconds), ...rateLimitHeaders(budget) } },
    );
  }

  const secret = process.env.SITE_TOKEN_SECRET;
  if (!secret) {
    // Fail closed rather than sign with nothing: an empty secret would make
    // every token forgeable by anyone who guesses the failure mode.
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }
  if (!process.env.REGISTRY_TOKEN) {
    // A mint the registry cannot record would hand out a credential the list
    // cannot show and the delete button cannot reach. Same fail-closed rule
    // as the secret.
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  // The duration rides in the body from the manage panel's dropdown; anything
  // off the menu falls back to the default rather than trusting the client.
  const body = await request.json().catch(() => ({}));
  const days = normalizeDuration(body.durationDays);
  // Same rule as the duration: only the exact opt-in word widens the token.
  const scope = body.scope === MANAGE_TOKEN_SCOPE ? MANAGE_TOKEN_SCOPE : SITE_TOKEN_SCOPE;

  const minted = await mintRecordedToken({
    login: session.login,
    scope,
    days,
    secret,
    registryToken: process.env.REGISTRY_TOKEN,
  });
  if (!minted.ok) {
    return Response.json(
      { error: minted.reason === 'ratelimited' ? 'busy' : 'server_error' },
      { status: minted.reason === 'ratelimited' ? 503 : 500 },
    );
  }

  return Response.json({
    token: minted.token,
    scope,
    durationDays: days,
    expiresAt: new Date(minted.expiresAt).toISOString(),
  });
}

// The manual delete: one id, removed from this login's registry file. An id
// that is already gone (expired out, deleted from another tab) answers ok
// rather than 404 -- the end state is what the caller asked for.
export async function DELETE(request) {
  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  if (!session?.login) {
    return Response.json({ error: 'signin_required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[0-9a-f]{16}$/.test(id)) {
    return Response.json({ error: 'invalid_id' }, { status: 400 });
  }

  try {
    const result = await revokeToken(session.login, id, { token: process.env.REGISTRY_TOKEN });
    if (!result.ok) {
      return Response.json({ error: result.reason === 'stale' ? 'stale' : 'server_error' }, { status: result.reason === 'stale' ? 409 : 500 });
    }
    return Response.json({ deleted: result.had ? id : null });
  } catch {
    return Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '4' } });
  }
}
