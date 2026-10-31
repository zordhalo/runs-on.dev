import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SITE_TOKEN_SCOPE, MANAGE_TOKEN_SCOPE } from './tokens.js';

// The OAuth 2.1 authorization server MCP clients log in through. runs-on.dev
// is its own authorization server rather than pointing clients at GitHub,
// because GitHub tokens mean nothing to the MCP endpoint and GitHub offers no
// dynamic client registration. GitHub is still who the person signs in with:
// the consent page sits behind the ordinary session cookie.
//
// Stateless like the rest of the site's credentials. Nothing here is stored:
// a registered client id, the pending consent request, and the authorization
// code are each an HMAC-signed blob carrying its own expiry. The one thing
// that IS stored is the access token it ends in, which is an ordinary rod1
// token recorded in the token registry -- so it shows up on /manage and dies
// the moment it is deleted there, same as a hand-minted one.

// OAuth scope strings, mapped onto the two token scopes. records:write is
// the opt-in that makes a manage token; anything else gets deploy-only.
export const OAUTH_SCOPES = ['sites:publish', 'records:write'];

export function tokenScopeFor(scopeString) {
  const asked = String(scopeString ?? '').split(/\s+/);
  return asked.includes('records:write') ? MANAGE_TOKEN_SCOPE : SITE_TOKEN_SCOPE;
}

export function oauthScopeFor(tokenScope) {
  return tokenScope === MANAGE_TOKEN_SCOPE ? 'sites:publish records:write' : 'sites:publish';
}

export const CODE_TTL_MS = 5 * 60 * 1000;
export const CONSENT_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TOKEN_DAYS = 30;

// Each blob kind gets its own key derived from the one secret, so a signed
// client id can never be replayed as an authorization code or vice versa.
function keyFor(kind, secret) {
  return createHmac('sha256', secret).update(`runs-on.dev oauth ${kind}`).digest();
}

export function sealBlob(kind, payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', keyFor(kind, secret)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function openBlob(kind, raw, secret, { now = Date.now() } = {}) {
  if (typeof raw !== 'string' || !secret) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [body, provided] = parts;
  const expected = createHmac('sha256', keyFor(kind, secret)).update(body).digest('base64url');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  // Blobs without an expiry (client ids) never expire; anything with one is
  // held to it.
  if ('exp' in payload && !(typeof payload.exp === 'number' && now < payload.exp)) return null;
  return payload;
}

// Redirect URIs: plain http to a loopback address, which is where CLI agents
// (Claude Code, Codex) listen for the callback, plus exactly the hosted
// callbacks of clients we trust by name. Registration is open (RFC 7591), so
// the redirect URI is the only thing deciding who can ever receive a code: an
// attacker who registers their own server as a redirect IS the party that
// started the flow, so PKCE cannot stop them. Every hosted entry below is a
// company trusted with codes that control users' DNS; add one only on purpose.
// No fragments, and no custom schemes: there is no native app here to own one.
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const HOSTED_REDIRECTS = new Set([
  // claude.ai web, Desktop, mobile and Cowork share this one callback.
  'https://claude.ai/api/mcp/auth_callback',
  // ChatGPT's legacy stable redirect, still honoured for published apps.
  'https://chatgpt.com/connector_platform_oauth_redirect',
]);
// ChatGPT's per-app callback: https://chatgpt.com/connector/oauth/{callback_id}.
const CHATGPT_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]+$/;

export function isAllowedRedirectUri(uri) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'http:') return LOOPBACK_HOSTS.includes(u.hostname);
  if (u.protocol !== 'https:' || u.port || u.search) return false;
  if (HOSTED_REDIRECTS.has(`${u.origin}${u.pathname}`)) return true;
  return u.hostname === 'chatgpt.com' && CHATGPT_CALLBACK_PATH.test(u.pathname);
}

export function isLoopbackRedirect(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

// RFC 8252 7.3: a loopback redirect may come back on any port, because the
// client picks a free one per login. Everything else must match exactly.
export function redirectUriMatches(registered, presented) {
  if (registered === presented) return true;
  let a;
  let b;
  try {
    a = new URL(registered);
    b = new URL(presented);
  } catch {
    return false;
  }
  if (a.protocol !== 'http:' || !isAllowedRedirectUri(registered)) return false;
  return a.hostname === b.hostname && a.protocol === b.protocol
    && a.pathname === b.pathname && a.search === b.search;
}

// RFC 7591 dynamic registration, without a database: the client id IS the
// signed registration. Public clients only (token_endpoint_auth_method
// "none"); PKCE is what stands in for a client secret.
export function registerClient(meta, secret) {
  const uris = meta?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return { ok: false, error: 'invalid_redirect_uri', detail: 'redirect_uris must be a list of 1 to 10 URIs' };
  }
  if (!uris.every((u) => typeof u === 'string' && u.length <= 512 && isAllowedRedirectUri(u))) {
    return { ok: false, error: 'invalid_redirect_uri', detail: 'redirect URIs must be http on localhost, or a supported hosted client callback (Claude, ChatGPT)' };
  }
  if (meta.token_endpoint_auth_method && meta.token_endpoint_auth_method !== 'none') {
    return { ok: false, error: 'invalid_client_metadata', detail: 'only public clients (token_endpoint_auth_method "none") are supported' };
  }
  // The name is self-asserted and shown on the consent page, so it is capped
  // and stripped to printable text here; the page escapes it again.
  const name = typeof meta.client_name === 'string'
    ? meta.client_name.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 60)
    : '';
  const client = { n: name || 'an MCP client', r: uris, iat: Math.floor(Date.now() / 1000) };
  return {
    ok: true,
    clientId: `roc1.${sealBlob('client', client, secret)}`,
    client: { name: client.n, redirectUris: uris },
  };
}

export function readClient(clientId, secret) {
  if (typeof clientId !== 'string' || !clientId.startsWith('roc1.')) return null;
  const c = openBlob('client', clientId.slice(5), secret);
  if (!c || !Array.isArray(c.r) || typeof c.n !== 'string') return null;
  return { name: c.n, redirectUris: c.r };
}

// Validates an /authorize request. Errors split the way RFC 6749 4.1.2.1
// demands: a bad client or redirect URI must NOT redirect (the error would go
// to an address we cannot vouch for), everything after that goes back to the
// client as error= on its own redirect URI.
export function checkAuthorizeRequest(params, secret) {
  const client = readClient(params.client_id, secret);
  if (!client) return { ok: false, redirect: false, error: 'invalid_client' };
  const redirectUri = params.redirect_uri;
  // isAllowedRedirectUri is checked here too, not only at registration: client
  // ids are stateless signed blobs, so one registered before the allowlist
  // existed (any https redirect) would otherwise keep working forever.
  if (typeof redirectUri !== 'string' || !isAllowedRedirectUri(redirectUri)
    || !client.redirectUris.some((r) => redirectUriMatches(r, redirectUri))) {
    return { ok: false, redirect: false, error: 'invalid_redirect_uri' };
  }
  // Registration is open, so a registered https redirect proves nothing about
  // who owns it: auto-redirecting errors there would make this endpoint an
  // open redirect off runs-on.dev for anyone who registers a client and
  // links to a malformed request (RFC 9700 4.11.2). Errors only go back to
  // loopback, which is the user's own machine; anything else gets the local
  // error page. The consent page's Deny still redirects, because by then the
  // person has seen the destination host and clicked.
  const back = (error, description) => (isLoopbackRedirect(redirectUri)
    ? { ok: false, redirect: true, redirectUri, state: params.state, error, description }
    : { ok: false, redirect: false, error, description });
  if (params.response_type !== 'code') return back('unsupported_response_type', 'only response_type=code');
  if (typeof params.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) {
    return back('invalid_request', 'PKCE code_challenge required');
  }
  if (params.code_challenge_method !== 'S256') return back('invalid_request', 'code_challenge_method must be S256');
  const asked = String(params.scope ?? '').split(/\s+/).filter(Boolean);
  if (asked.some((s) => !OAUTH_SCOPES.includes(s))) return back('invalid_scope', `supported scopes: ${OAUTH_SCOPES.join(' ')}`);
  return {
    ok: true,
    client,
    request: {
      clientId: params.client_id,
      redirectUri,
      state: typeof params.state === 'string' ? params.state.slice(0, 512) : undefined,
      codeChallenge: params.code_challenge,
      scope: tokenScopeFor(params.scope),
    },
  };
}

// The redirect back to the client, success or error. iss per RFC 9207 so a
// client talking to several servers can tell which one answered.
export function clientRedirect(redirectUri, params, issuer) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries({ ...params, iss: issuer })) {
    if (v !== undefined && v !== null) u.searchParams.set(k, v);
  }
  return u.toString();
}

export function issueCode({ request, login, scope }, secret, { now = Date.now() } = {}) {
  return sealBlob('code', {
    jti: randomBytes(12).toString('base64url'),
    c: request.clientId,
    r: request.redirectUri,
    ch: request.codeChallenge,
    l: login,
    s: scope,
    exp: now + CODE_TTL_MS,
  }, secret);
}

export function pkceMatches(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(String(challenge));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ponytail: single-use is enforced per instance in memory, not globally. A
// code replayed on another warm instance inside its 5 minutes would redeem
// twice -- but only by someone holding the PKCE verifier, which is the client
// that asked for it. Move to a shared store if that ever matters.
const spent = new Map();
function spend(jti, exp, now) {
  for (const [k, e] of spent) if (e <= now) spent.delete(k);
  if (spent.has(jti)) return false;
  spent.set(jti, exp);
  return true;
}

// The token endpoint's authorization_code grant, minus the minting. Returns
// { ok, login, scope } or { ok: false, error } with an RFC 6749 5.2 code.
export function redeemCode({ code, clientId, redirectUri, codeVerifier }, secret, { now = Date.now() } = {}) {
  const p = openBlob('code', code, secret, { now });
  if (!p) return { ok: false, error: 'invalid_grant', description: 'code is invalid or expired' };
  if (p.c !== clientId) return { ok: false, error: 'invalid_grant', description: 'code was issued to another client' };
  if (p.r !== redirectUri) return { ok: false, error: 'invalid_grant', description: 'redirect_uri does not match' };
  if (!pkceMatches(codeVerifier, p.ch)) return { ok: false, error: 'invalid_grant', description: 'PKCE verification failed' };
  if (!spend(p.jti, p.exp, now)) return { ok: false, error: 'invalid_grant', description: 'code already used' };
  return { ok: true, login: p.l, scope: p.s };
}

export function authorizationServerMetadata(issuer) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/docs/mcp`,
  };
}

export const MCP_PATH = '/.well-known/mcp';
export const MCP_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

export function mcpResourceMetadata(issuer) {
  return {
    resource: `${issuer}${MCP_PATH}`,
    authorization_servers: [issuer],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'runs-on.dev MCP server',
    resource_documentation: `${issuer}/docs/mcp`,
  };
}

// The issuer is the deployment's own origin: APP_ORIGIN in production (the
// same value the GitHub callback is registered against), the request's origin
// on previews and localhost so a test login does not bounce to production.
export function issuerFor(request) {
  return (process.env.APP_ORIGIN || new URL(request.url).origin).replace(/\/$/, '');
}

// Everything an OAuth endpoint answers is per-request and must not be cached.
export const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

// Browser-based MCP clients (the MCP Inspector, web IDEs) call discovery,
// registration and the token endpoint cross-origin. None of them use cookies,
// so a wildcard origin grants nothing a curl could not already do.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
};
