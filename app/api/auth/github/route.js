import { randomBytes } from 'node:crypto';

export async function GET(request) {
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${process.env.APP_ORIGIN}/api/auth/github/callback`);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);

  // Preserve the claim name from the 404 page through the OAuth round-trip.
  // GitHub's redirect doesn't carry our query params, so it rides in a cookie
  // alongside the oauth_state and is read back in the callback. Each cookie
  // must be appended separately: a plain headers record coerces an array into
  // ONE comma-joined Set-Cookie header, which never sets oauth_claim and
  // corrupts oauth_state's Max-Age into a value browsers discard.
  const claim = new URL(request.url).searchParams.get('claim') ?? '';

  const headers = new Headers({ Location: url.toString() });
  headers.append('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  if (claim) {
    headers.append('Set-Cookie', `oauth_claim=${encodeURIComponent(claim)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  }

  return new Response(null, { status: 302, headers });
}
