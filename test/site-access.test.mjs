import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { GET } from '../app/api/sites/deployments/route.js';
import { signSiteToken, SITE_TOKEN_SCOPE } from '../lib/tokens.js';
import { tokenId } from '../lib/token-registry.js';

// Exercise the real route, token verification and registry readers. Only the
// GitHub transport is redirected to a local contents-API fixture.
async function fixture(t, { login, revoked = false, names = ['example'], site = null, ownerStatus = 200 }) {
  const secret = 'site-access-test-secret';
  const previousSecret = process.env.SITE_TOKEN_SECRET;
  const previousRegistryToken = process.env.REGISTRY_TOKEN;
  process.env.SITE_TOKEN_SECRET = secret;
  delete process.env.REGISTRY_TOKEN;
  const token = signSiteToken({ login, scope: SITE_TOKEN_SCOPE }, secret);
  const paths = [];
  const pending = new Set();
  const server = createServer((request, response) => {
    const file = request.url.split('/contents/')[1];
    paths.push(file);
    let data;
    let status = 200;
    if (file === `tokens/${login}.json`) {
      data = { tokens: revoked ? [] : [{ id: tokenId(token), exp: Date.now() + 60_000 }] };
    } else if (file === `owners/${login}.json`) {
      status = ownerStatus;
      data = { github: login, names };
    } else if (file === 'sites/example.json') {
      status = site ? 200 : 404;
      data = site;
    } else {
      status = 404;
    }
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(status === 200
      ? { sha: 'test-sha', content: Buffer.from(JSON.stringify(data)).toString('base64') }
      : { message: 'unavailable' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options?.method ?? 'GET', 'GET');
    const fetching = nativeFetch(new URL(url.pathname + url.search, origin), options);
    pending.add(fetching);
    fetching.then(() => pending.delete(fetching), () => pending.delete(fetching));
    return fetching;
  });
  t.after(async () => {
    // Drain even a broken caller that starts authorization without awaiting it.
    await Promise.allSettled(pending);
    await new Promise(setImmediate);
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.SITE_TOKEN_SECRET;
    else process.env.SITE_TOKEN_SECRET = previousSecret;
    if (previousRegistryToken === undefined) delete process.env.REGISTRY_TOKEN;
    else process.env.REGISTRY_TOKEN = previousRegistryToken;
  });
  return {
    paths,
    request: (query = '', authenticated = true) => new Request(`http://localhost/api/sites/deployments${query}`, {
      headers: authenticated ? { authorization: `Bearer ${token}` } : {},
    }),
  };
}

test('deployment listing rejects missing credentials before registry reads', async (t) => {
  const { request, paths } = await fixture(t, { login: 'missing-credentials' });
  const response = await GET(request('', false));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'invalid_token' });
  assert.deepEqual(paths, []);
});

test('deployment listing waits for authorization and returns the owner history', async (t) => {
  const site = {
    name: 'example', active: 'a1',
    deployments: [{ id: 'a1', at: '2026-01-01T00:00:00.000Z', files: 2, bytes: 10 }],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const { request, paths } = await fixture(t, { login: 'existing-history', site });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), site);
  assert.deepEqual(paths, ['tokens/existing-history.json', 'owners/existing-history.json', 'sites/example.json']);
});

test('deployment listing returns empty history before the first deploy', async (t) => {
  const { request } = await fixture(t, { login: 'empty-history' });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { name: 'example', active: null, deployments: [] });
});

test('deployment listing preserves revocation errors without reading ownership', async (t) => {
  const { request, paths } = await fixture(t, { login: 'revoked-token', revoked: true });
  const response = await GET(request());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'revoked_token' });
  assert.deepEqual(paths, ['tokens/revoked-token.json']);
});

test('deployment listing rejects a name belonging to another owner', async (t) => {
  const { request, paths } = await fixture(t, { login: 'different-owner' });
  const response = await GET(request('?name=someone-else'));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'not_your_name' });
  assert.deepEqual(paths, ['tokens/different-owner.json', 'owners/different-owner.json']);
});

test('deployment listing reports an account with no claimed name', async (t) => {
  const { request } = await fixture(t, { login: 'no-claimed-name', names: [] });
  const response = await GET(request());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'no_claimed_name' });
});

test('deployment listing retains the busy response for an unreadable owner index', async (t) => {
  const { request, paths } = await fixture(t, { login: 'unreadable-owner', ownerStatus: 503 });
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'busy' });
  assert.equal(response.headers.get('retry-after'), '4');
  assert.deepEqual(paths, ['tokens/unreadable-owner.json', 'owners/unreadable-owner.json']);
});

test('deployment listing preserves the read limit and its retry guidance', async (t) => {
  const { request, paths } = await fixture(t, { login: 'limited-reader' });
  for (let i = 0; i < 30; i += 1) {
    const response = await GET(request());
    assert.equal(response.status, 200);
    await response.json();
  }
  const previousReads = paths.length;
  const response = await GET(request());
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error, 'rate_limited');
  assert.ok(body.retryInMs > 0);
  assert.equal(Number(response.headers.get('retry-after')), Math.ceil(body.retryInMs / 1000));
  assert.deepEqual(paths.slice(previousReads), ['tokens/limited-reader.json']);
});
