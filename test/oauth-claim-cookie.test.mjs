import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET as githubAuth } from '../app/api/auth/github/route.js';

// Two Set-Cookie headers cannot be emitted through a plain headers record:
// the value array is stringified into one comma-joined header, which never
// sets oauth_claim (the 404 claim round-trip silently never works) and
// corrupts oauth_state's Max-Age into a value browsers discard (review on
// #106). Headers.append is the only form that produces two, and this test
// is the only place the difference is visible without a real browser.
test('the claim name rides along as its own Set-Cookie header', async () => {
  const res = await githubAuth(new Request('http://localhost:3000/api/auth/github?claim=refinix'));

  assert.equal(res.status, 302);
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 2);

  const state = cookies.find((c) => c.startsWith('oauth_state='));
  const claim = cookies.find((c) => c.startsWith('oauth_claim='));
  assert.ok(state, 'oauth_state cookie present');
  assert.ok(claim, 'oauth_claim cookie present');
  assert.match(claim, /^oauth_claim=refinix;/);
  assert.match(state, /Max-Age=600$/);
  assert.match(claim, /Max-Age=600$/);
});

test('without a claim there is exactly one cookie', async () => {
  const res = await githubAuth(new Request('http://localhost:3000/api/auth/github'));

  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^oauth_state=/);
});
