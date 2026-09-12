import { signSiteToken, SITE_TOKEN_SCOPE, SITE_TOKEN_TTL_MS } from '../../../lib/tokens.js';
import { sessionFromRequest } from '../../../lib/session.js';
import { createRateLimiter } from '../../../lib/throttle.js';

// Minting is a no-op on the registry (the token is stateless), but it should
// still not be free: a leaned-on button or a stuck loop minting thousands of
// valid 30-day credentials is its own kind of incident. Tight enough that a
// human generating, copying, and pasting never trips it.
const MINT_WINDOW_MS = 10 * 60 * 1000;
const MINT_MAX = 5;
const takeMint = createRateLimiter({ windowMs: MINT_WINDOW_MS, max: MINT_MAX });

// The only way a deploy token comes into existence: the browser session says
// who the login is, the server signs it, the response shows it once. There is
// deliberately no GET: stateless tokens cannot be listed, and a "does one
// exist" oracle would only ever return yes after the first mint anyway.
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
      { status: 429, headers: { 'Retry-After': String(seconds) } },
    );
  }

  const secret = process.env.SITE_TOKEN_SECRET;
  if (!secret) {
    // Fail closed rather than sign with nothing: an empty secret would make
    // every token forgeable by anyone who guesses the failure mode.
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  const now = Date.now();
  const token = signSiteToken(
    { login: session.login, scope: SITE_TOKEN_SCOPE },
    secret,
    { now },
  );

  return Response.json({
    token,
    scope: SITE_TOKEN_SCOPE,
    expiresAt: new Date(now + SITE_TOKEN_TTL_MS).toISOString(),
  });
}
