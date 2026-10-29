import { redeemCode, oauthScopeFor, ACCESS_TOKEN_DAYS, NO_STORE, CORS } from '../../../../lib/oauth.js';
import { mintRecordedToken } from '../../../../lib/token-registry.js';

// The token endpoint: an authorization code plus its PKCE verifier in, a rod1
// token out. The token is minted and recorded exactly like the /manage
// button's, so it is listed there, revocable there, and subject to the same
// registry check on every use.
//
// No refresh tokens: the access token lives 30 days and the client logs in
// again after that, which for a CLI agent is one browser click.

const fail = (error, description, status = 400) => Response.json(
  { error, error_description: description },
  { status, headers: { ...CORS, ...NO_STORE } },
);

export async function POST(request) {
  const secret = process.env.SITE_TOKEN_SECRET;
  if (!secret || !process.env.REGISTRY_TOKEN) {
    // Fail closed, as the mint route does: no secret means forgeable tokens,
    // no registry means a token /manage could never show or revoke.
    return fail('temporarily_unavailable', 'token issuance is not configured', 503);
  }

  // RFC 6749 says form-encoded; accept JSON too, because some clients send it.
  const type = request.headers.get('content-type') ?? '';
  let params;
  if (type.includes('application/json')) {
    params = await request.json().catch(() => ({}));
  } else {
    params = Object.fromEntries(new URLSearchParams(await request.text().catch(() => '')));
  }

  if (params.grant_type !== 'authorization_code') {
    return fail('unsupported_grant_type', 'only authorization_code is supported');
  }

  const redeemed = redeemCode({
    code: params.code,
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    codeVerifier: params.code_verifier,
  }, secret);
  if (!redeemed.ok) return fail(redeemed.error, redeemed.description);

  const minted = await mintRecordedToken({
    login: redeemed.login,
    scope: redeemed.scope,
    days: ACCESS_TOKEN_DAYS,
    secret,
    registryToken: process.env.REGISTRY_TOKEN,
  });
  if (!minted.ok) return fail('temporarily_unavailable', 'could not record the token, try again', 503);

  return Response.json({
    access_token: minted.token,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_DAYS * 24 * 60 * 60,
    scope: oauthScopeFor(redeemed.scope),
  }, { headers: { ...CORS, ...NO_STORE } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
