import { randomBytes } from 'node:crypto';

// Initiates the Vercel OAuth flow. If the Vercel OAuth app credentials
// aren't configured yet, explains what the owner needs to set up.
export async function GET(request) {
  const clientId = process.env.VERCEL_CLIENT_ID;
  const origin = new URL(request.url).origin;

  if (!clientId) {
    return new Response(
      `Vercel OAuth is not configured yet.

To enable it, the registry owner needs to:
1. Go to https://vercel.com/account/settings/tokens
2. Create an OAuth App (or use an existing integration)
3. Set VERCEL_CLIENT_ID and VERCEL_CLIENT_SECRET as environment variables
4. Add this callback URL to the OAuth app: ${origin}/api/auth/vercel/callback

Once configured, this button will redirect to Vercel's authorization page.`,
      { status: 200, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  // Same state contract as the GitHub flow: a single-use random value in a
  // short-lived HttpOnly cookie, compared by the callback. Without it, an
  // attacker could complete an authorization for their own Vercel account
  // and have the victim's browser deliver the code to our callback, binding
  // the attacker's account to the victim's session.
  const state = randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/vercel/callback`,
    // Every endpoint this integration calls is a project endpoint: adding a
    // domain to a project, reading it back, verifying it, and listing
    // projects. `projects` is therefore the whole grant; `domains` would add
    // account-wide domain write that the flow never uses.
    scope: 'projects',
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://vercel.com/oauth/authorize?${params}`,
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
