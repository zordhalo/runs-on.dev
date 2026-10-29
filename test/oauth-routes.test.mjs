// The OAuth routes end to end, through the real handlers: consent POST ->
// code -> token endpoint -> a rod1 token that the MCP front door accepts.
// Only GitHub's contents API is faked, as an in-memory file store, so the
// token registry write and the revocation read are both real code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { POST as authorize } from '../app/api/oauth/authorize/route.js';
import { POST as token } from '../app/api/oauth/token/route.js';
import { registerClient, checkAuthorizeRequest, sealBlob, CONSENT_TTL_MS } from '../lib/oauth.js';
import { signSession } from '../lib/session.js';
import { authorizeBearer } from '../lib/site-access.js';

const REDIRECT = 'http://localhost:33418/callback';

function fakeGitHub(t) {
  const files = new Map();
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.github.com');
    const path = url.pathname.split('/contents/')[1];
    if ((options.method ?? 'GET') === 'PUT') {
      const body = JSON.parse(options.body);
      files.set(path, Buffer.from(body.content, 'base64').toString());
      return Response.json({ commit: { sha: 'c1' } }, { status: 201 });
    }
    if (!files.has(path)) return Response.json({ message: 'Not Found' }, { status: 404 });
    return Response.json({ sha: 's1', content: Buffer.from(files.get(path)).toString('base64') });
  });
  return files;
}

function env(t) {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, {
    SITE_TOKEN_SECRET: 'route-secret',
    SESSION_SECRET: 'route-session',
    REGISTRY_TOKEN: 'fake',
    APP_ORIGIN: 'https://runs-on.dev',
  });
}

async function approve({ login = 'Hawkay002', scope = 'manage', sessionLogin = login } = {}) {
  const { clientId } = registerClient({ redirect_uris: [REDIRECT] }, 'route-secret');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const { request } = checkAuthorizeRequest({
    client_id: clientId, redirect_uri: REDIRECT, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 's',
    scope: 'sites:publish records:write',
  }, 'route-secret');
  const consent = sealBlob('consent', { ...request, login, exp: Date.now() + CONSENT_TTL_MS }, 'route-secret');
  const res = await authorize(new Request('https://runs-on.dev/api/oauth/authorize', {
    method: 'POST',
    headers: {
      cookie: `session=${signSession({ login: sessionLogin }, 'route-session')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ consent, decision: 'approve', scope }),
  }));
  return { res, clientId, verifier };
}

function exchange({ code, clientId, verifier }) {
  return token(new Request('https://runs-on.dev/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: verifier,
    }),
  }));
}

test('consent -> code -> token -> accepted by the MCP front door, and revocable', async (t) => {
  env(t);
  const files = fakeGitHub(t);
  const { res, clientId, verifier } = await approve();
  assert.equal(res.status, 303);
  const code = new URL(res.headers.get('location')).searchParams.get('code');

  const tokenRes = await exchange({ code, clientId, verifier });
  assert.equal(tokenRes.status, 200);
  const body = await tokenRes.json();
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.scope, 'sites:publish records:write');
  assert.match(body.access_token, /^rod1\./);

  // Recorded in the registry, so /manage lists it with its scope.
  const recorded = JSON.parse(files.get('tokens/hawkay002.json'));
  assert.equal(recorded.tokens[0].scope, 'manage');

  const bearer = (tok) => new Request('https://runs-on.dev/.well-known/mcp', { headers: { authorization: `Bearer ${tok}` } });
  const ok = await authorizeBearer(bearer(body.access_token), () => ({ ok: true }));
  assert.deepEqual(ok, { login: 'Hawkay002', scope: 'manage' });

  // Deleting it on /manage (an empty registry entry list) kills it at once.
  files.set('tokens/hawkay002.json', JSON.stringify({ tokens: [] }));
  const dead = await authorizeBearer(bearer(body.access_token), () => ({ ok: true }));
  assert.equal(dead.response.status, 401);

  // And the code was single-use.
  const replay = await exchange({ code, clientId, verifier });
  assert.equal(replay.status, 400);
});

test('the person can narrow the scope on the consent page', async (t) => {
  env(t);
  fakeGitHub(t);
  const { res, clientId, verifier } = await approve({ scope: 'sites' });
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const body = await (await exchange({ code, clientId, verifier })).json();
  assert.equal(body.scope, 'sites:publish');
});

test('a consent blob for one login cannot be approved by another session', async (t) => {
  env(t);
  fakeGitHub(t);
  const { res } = await approve({ login: 'Hawkay002', sessionLogin: 'mallory' });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('location'), null);
});

test('the token endpoint refuses other grants and bad codes in RFC 6749 shape', async (t) => {
  env(t);
  fakeGitHub(t);
  const other = await token(new Request('https://runs-on.dev/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  }));
  assert.equal(other.status, 400);
  assert.equal((await other.json()).error, 'unsupported_grant_type');
  const bad = await exchange({ code: 'nope', clientId: 'x', verifier: 'y' });
  assert.equal((await bad.json()).error, 'invalid_grant');
  assert.equal(bad.headers.get('cache-control'), 'no-store');
});
