import { SESSION_TTL_MS, signSession, sessionFromRequest } from '../../../../../lib/session.js';

// Receives the OAuth callback from Vercel. Checks the single-use state
// cookie set by /api/auth/vercel, exchanges the code for an access token,
// and writes that token into the signed session cookie itself. The token
// never appears in a URL, never reaches the client, and dies with the
// session. The caller must already be signed in with GitHub, since the
// token is stored in their session.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const clientId = process.env.VERCEL_CLIENT_ID;
  const clientSecret = process.env.VERCEL_CLIENT_SECRET;

  const cookie = request.headers.get('cookie') ?? '';
  const expected = cookie.match(/(?:^|;\s*)oauth_state=([^;]+)/)?.[1];
  if (!code || !state || !expected || state !== expected) {
    return Response.redirect(`${url.origin}/manage?vercel=bad-state`, 302);
  }

  // The Vercel connection belongs to the signed-in user's session, so a
  // session must already exist to attach it to.
  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  if (!session?.login) {
    return Response.redirect(`${url.origin}/manage?vercel=signin-required`, 302);
  }

  if (!clientId || !clientSecret) {
    return Response.redirect(`${url.origin}/manage?vercel=not-configured`, 302);
  }

  const tokenRes = await fetch('https://api.vercel.com/v2/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${url.origin}/api/auth/vercel/callback`,
      grant_type: 'authorization_code',
    }),
  }).catch(() => null);

  if (!tokenRes || !tokenRes.ok) {
    return Response.redirect(`${url.origin}/manage?vercel=error`, 302);
  }

  const { access_token: vercelToken } = await tokenRes.json().catch(() => ({}));
  if (!vercelToken) {
    return Response.redirect(`${url.origin}/manage?vercel=error`, 302);
  }

  // Re-sign the existing session with the Vercel token. signSession issues
  // a fresh exp, so the connection lasts exactly as long as the session.
  const updated = signSession({ ...session, vercelToken }, process.env.SESSION_SECRET);

  const headersOut = new Headers();
  headersOut.append('Location', '/manage?vercel=connected');
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  headersOut.append(
    'Set-Cookie',
    `session=${updated}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  );
  headersOut.append('Set-Cookie', 'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

  return new Response(null, { status: 302, headers: headersOut });
}
