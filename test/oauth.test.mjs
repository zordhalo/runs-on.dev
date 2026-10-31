// The OAuth authorization server for MCP clients, tested as pure functions:
// register -> authorize -> code -> redeem, and every way that chain must
// refuse. The routes are thin wrappers over exactly these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  registerClient, readClient, checkAuthorizeRequest, issueCode, redeemCode,
  isAllowedRedirectUri, redirectUriMatches, sealBlob, openBlob, tokenScopeFor,
  oauthScopeFor, clientRedirect, authorizationServerMetadata, mcpResourceMetadata,
} from '../lib/oauth.js';
import { safeSigninReturn } from '../lib/session.js';

const secret = 'oauth-test-secret';
const REDIRECT = 'http://localhost:33418/callback';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeParams(clientId, challenge, extra = {}) {
  return {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: 'sites:publish records:write',
    ...extra,
  };
}

function registered() {
  const out = registerClient({ client_name: 'Claude Code', redirect_uris: [REDIRECT] }, secret);
  assert.ok(out.ok);
  return out.clientId;
}

test('the full flow: register, authorize, issue, redeem', () => {
  const clientId = registered();
  assert.equal(readClient(clientId, secret).name, 'Claude Code');
  const { verifier, challenge } = pkce();

  const checked = checkAuthorizeRequest(authorizeParams(clientId, challenge), secret);
  assert.ok(checked.ok);
  assert.equal(checked.request.scope, 'manage');

  const code = issueCode({ request: checked.request, login: 'Hawkay002', scope: 'manage' }, secret);
  const out = redeemCode({ code, clientId, redirectUri: REDIRECT, codeVerifier: verifier }, secret);
  assert.deepEqual(out, { ok: true, login: 'Hawkay002', scope: 'manage' });

  // Single use: the same code twice is refused.
  const again = redeemCode({ code, clientId, redirectUri: REDIRECT, codeVerifier: verifier }, secret);
  assert.equal(again.ok, false);
  assert.match(again.description, /already used/);
});

test('redeem refuses a wrong verifier, client, redirect, expiry, or secret', () => {
  const clientId = registered();
  const { verifier, challenge } = pkce();
  const { request } = checkAuthorizeRequest(authorizeParams(clientId, challenge), secret);
  const fresh = () => issueCode({ request, login: 'a', scope: 'sites' }, secret);
  const base = { clientId, redirectUri: REDIRECT, codeVerifier: verifier };

  assert.equal(redeemCode({ ...base, code: fresh(), codeVerifier: pkce().verifier }, secret).ok, false);
  assert.equal(redeemCode({ ...base, code: fresh(), codeVerifier: undefined }, secret).ok, false);
  assert.equal(redeemCode({ ...base, code: fresh(), clientId: registered() + 'x' }, secret).ok, false);
  assert.equal(redeemCode({ ...base, code: fresh(), redirectUri: 'http://localhost:1/callback' }, secret).ok, false);
  assert.equal(redeemCode({ ...base, code: fresh() }, 'other-secret').ok, false);
  const later = Date.now() + 6 * 60 * 1000;
  assert.equal(redeemCode({ ...base, code: fresh() }, secret, { now: later }).ok, false);
  assert.equal(redeemCode({ ...base, code: 'garbage' }, secret).ok, false);
});

test('blob kinds cannot stand in for each other', () => {
  const blob = sealBlob('consent', { login: 'a', exp: Date.now() + 60_000 }, secret);
  assert.ok(openBlob('consent', blob, secret));
  assert.equal(openBlob('code', blob, secret), null);
  assert.equal(openBlob('client', blob, secret), null);
  // A client id with its prefix stripped is not an authorization code.
  assert.equal(redeemCode({ code: registered().slice(5), clientId: 'x', redirectUri: REDIRECT, codeVerifier: 'x'.repeat(43) }, secret).ok, false);
});

test('a client id cannot be edited to add a redirect URI', () => {
  const clientId = registered();
  const [body, sig] = clientId.slice(5).split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  payload.r.push('https://evil.example/cb');
  const forged = `roc1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
  assert.equal(readClient(forged, secret), null);
});

test('authorize: bad client or redirect never redirects; the rest go back with error=', () => {
  const clientId = registered();
  const { challenge } = pkce();
  const unknown = checkAuthorizeRequest(authorizeParams('roc1.nope.nope', challenge), secret);
  assert.deepEqual([unknown.ok, unknown.redirect], [false, false]);
  const elsewhere = checkAuthorizeRequest(authorizeParams(clientId, challenge, { redirect_uri: 'https://evil.example/cb' }), secret);
  assert.deepEqual([elsewhere.ok, elsewhere.redirect], [false, false]);

  for (const [extra, error] of [
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ scope: 'names:release' }, 'invalid_scope'],
  ]) {
    const out = checkAuthorizeRequest(authorizeParams(clientId, challenge, extra), secret);
    assert.equal(out.redirect, true, JSON.stringify(extra));
    assert.equal(out.error, error);
    assert.equal(out.state, 'xyz');
  }
});

test('errors for an https client never auto-redirect (no open redirect off runs-on.dev)', () => {
  const claude = 'https://claude.ai/api/mcp/auth_callback';
  const { clientId } = registerClient({ redirect_uris: [claude] }, secret);
  const out = checkAuthorizeRequest(
    authorizeParams(clientId, pkce().challenge, { redirect_uri: claude, response_type: 'bad' }),
    secret,
  );
  assert.equal(out.ok, false);
  assert.equal(out.redirect, false);
  assert.equal(out.error, 'unsupported_response_type');
});

test('a client sealed before the allowlist, with an arbitrary https redirect, is refused at authorize', () => {
  // Same signing path registerClient uses, minus the allowlist: what an
  // attacker holds if they registered before this change.
  const clientId = registered();
  const [body] = clientId.slice(5).split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  const legacy = `roc1.${sealBlob('client', { ...payload, r: ['https://evil.example/cb'] }, secret)}`;
  assert.ok(readClient(legacy, secret), 'the legacy id still verifies');
  const out = checkAuthorizeRequest(authorizeParams(legacy, pkce().challenge, { redirect_uri: 'https://evil.example/cb' }), secret);
  assert.deepEqual([out.ok, out.redirect, out.error], [false, false, 'invalid_redirect_uri']);
});

test('loopback redirects may change port; nothing else may change', () => {
  assert.ok(redirectUriMatches(REDIRECT, 'http://localhost:51234/callback'));
  assert.ok(!redirectUriMatches(REDIRECT, 'http://localhost:51234/other'));
  assert.ok(!redirectUriMatches(REDIRECT, 'http://127.0.0.1:33418/callback'));
  assert.ok(!redirectUriMatches('https://app.example/cb', 'https://app.example:8443/cb'));
  assert.ok(redirectUriMatches('https://app.example/cb', 'https://app.example/cb'));
});

test('registration accepts loopback http and the named Claude and ChatGPT callbacks only', () => {
  assert.ok(isAllowedRedirectUri('http://127.0.0.1:9/cb'));
  assert.ok(isAllowedRedirectUri('http://[::1]:9/cb'));
  assert.ok(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback'));
  assert.ok(isAllowedRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect'));
  assert.ok(isAllowedRedirectUri('https://chatgpt.com/connector/oauth/abc_DEF-123'));
  for (const bad of [
    'https://app.example/cb', 'https://evil.example/cb',
    'http://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback/x',
    'https://claude.ai/api/mcp/auth_callback?next=evil', 'https://claude.ai:8443/api/mcp/auth_callback',
    'https://evil.claude.ai/api/mcp/auth_callback', 'https://claude.ai.evil.example/api/mcp/auth_callback',
    'https://chatgpt.com/connector/oauth/a/b', 'https://chatgpt.com/connector/oauth/', 'https://chatgpt.com/connector/oauth/..%2Fx',
    'http://example.com/cb', 'javascript:alert(1)', 'myapp://cb', 'https://claude.ai/api/mcp/auth_callback#frag',
    'https://u:p@claude.ai/api/mcp/auth_callback', 'not a url',
  ]) {
    assert.ok(!isAllowedRedirectUri(bad), bad);
  }
  assert.equal(registerClient({ redirect_uris: ['https://evil.example/cb'] }, secret).ok, false);
  assert.equal(registerClient({ redirect_uris: ['http://example.com/cb'] }, secret).ok, false);
  assert.equal(registerClient({ redirect_uris: [] }, secret).ok, false);
  assert.equal(registerClient(null, secret).ok, false);
  assert.equal(registerClient({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' }, secret).ok, false);
});

test('client names are capped and stripped to printable ASCII', () => {
  const out = registerClient({ client_name: `<b>evil</b>‮gnp.exe${'x'.repeat(100)}`, redirect_uris: [REDIRECT] }, secret);
  assert.ok(out.client.name.length <= 60);
  assert.ok(!out.client.name.includes('‮'));
});

test('scope mapping: records:write is the only way to a manage token', () => {
  assert.equal(tokenScopeFor('sites:publish records:write'), 'manage');
  assert.equal(tokenScopeFor('sites:publish'), 'sites');
  assert.equal(tokenScopeFor(''), 'sites');
  assert.equal(tokenScopeFor(undefined), 'sites');
  assert.equal(oauthScopeFor('manage'), 'sites:publish records:write');
  assert.equal(oauthScopeFor('sites'), 'sites:publish');
});

test('the client redirect carries code, state, and iss', () => {
  const u = new URL(clientRedirect(REDIRECT, { code: 'c', state: 's', error: undefined }, 'https://runs-on.dev'));
  assert.equal(u.searchParams.get('code'), 'c');
  assert.equal(u.searchParams.get('state'), 's');
  assert.equal(u.searchParams.get('iss'), 'https://runs-on.dev');
  assert.equal(u.searchParams.has('error'), false);
});

test('metadata documents advertise PKCE S256 and point at each other', () => {
  const as = authorizationServerMetadata('https://runs-on.dev');
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal(as.issuer, 'https://runs-on.dev');
  assert.ok(as.registration_endpoint.endsWith('/api/oauth/register'));
  const rs = mcpResourceMetadata('https://runs-on.dev');
  assert.equal(rs.resource, 'https://runs-on.dev/.well-known/mcp');
  assert.deepEqual(rs.authorization_servers, ['https://runs-on.dev']);
});

test('sign-in may only return to the consent page', () => {
  assert.equal(safeSigninReturn('/api/oauth/authorize?client_id=x'), '/api/oauth/authorize?client_id=x');
  for (const bad of ['https://evil.example', '//evil.example', '/manage', '/api/oauth/authorizeX', '/api/oauth/authorize?a\r\nSet-Cookie: x', null, undefined]) {
    assert.equal(safeSigninReturn(bad), null, String(bad));
  }
});
