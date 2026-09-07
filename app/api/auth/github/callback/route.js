import { SESSION_TTL_MS, signSession } from '../../../../../lib/session.js';
import { validateName } from '../../../../../lib/name.js';

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const cookie = request.headers.get('cookie') ?? '';
  const expected = cookie.match(/(?:^|;\s*)oauth_state=([^;]+)/)?.[1];
  if (!code || !state || !expected || state !== expected) {
    return new Response('bad oauth state', { status: 400 });
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const { access_token: accessToken } = await tokenRes.json();
  if (!accessToken) return new Response('oauth exchange failed', { status: 400 });

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!userRes.ok) return new Response('github user lookup failed', { status: 502 });
  const user = await userRes.json();

  const session = signSession(
    {
      login: user.login,
      avatar: user.avatar_url,
      name: user.name,
      bio: user.bio,
      createdAt: user.created_at,
      publicRepos: user.public_repos,
    },
    process.env.SESSION_SECRET,
  );

  const headersOut = new Headers();

  // Read back the claim name from the 404 page (set alongside oauth_state)
  // so the user lands on the homepage with their name already filled in.
  // The value is HttpOnly and encoded at the set site, so it should never
  // be hostile — but run it through validateName anyway so the redirect is
  // safe by construction rather than by argument.
  //
  // decodeURIComponent throws URIError on a malformed sequence, and this
  // cookie is not as trustworthy as HttpOnly suggests: a claimed
  // <name>.runs-on.dev can set a cookie for the parent domain, so a hostile
  // claim could plant `oauth_claim=%` and turn every sign-in on the apex into
  // a 500. Decoding defensively keeps a bad value merely ignored.
  const rawClaim = cookie.match(/(?:^|;\s*)oauth_claim=([^;]+)/)?.[1];
  let decodedClaim = '';
  try {
    decodedClaim = rawClaim ? decodeURIComponent(rawClaim) : '';
  } catch {
    decodedClaim = '';
  }
  const claimName = validateName(decodedClaim).ok ? encodeURIComponent(decodedClaim) : '';
  const redirectUrl = claimName
    ? `/?signed-in=1&claim=${claimName}`
    : '/?signed-in=1';
  headersOut.append('Location', redirectUrl);
  // Max-Age from the same constant the payload's exp uses, so the browser
  // stops sending the cookie exactly when the server stops honouring it.
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  headersOut.append(
    'Set-Cookie',
    `session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  );
  headersOut.append('Set-Cookie', 'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

  return new Response(null, { status: 302, headers: headersOut });
}
