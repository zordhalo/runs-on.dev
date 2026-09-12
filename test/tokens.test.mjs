import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  signSiteToken, readSiteToken, siteTokenFromRequest,
  SITE_TOKEN_TTL_MS, SITE_TOKEN_SCOPE,
} from '../lib/tokens.js';

const secret = 'test-secret-value';

test('round-trips a payload', () => {
  const now = Date.now();
  const token = signSiteToken({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE }, secret, { now });
  assert.deepEqual(readSiteToken(token, secret, { now }), {
    login: 'hawkay002',
    scope: SITE_TOKEN_SCOPE,
    exp: now + SITE_TOKEN_TTL_MS,
  });
});

test('carries the rod1 prefix and three parts', () => {
  const token = signSiteToken({ login: 'zordhalo', scope: SITE_TOKEN_SCOPE }, secret);
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'rod1');
});

test('rejects a tampered payload', () => {
  const token = signSiteToken({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE }, secret);
  const [, sig] = token.split('.');
  const body = Buffer.from(
    JSON.stringify({ login: 'someone-else', scope: SITE_TOKEN_SCOPE }),
  ).toString('base64url');
  assert.equal(readSiteToken(`rod1.${body}.${sig}`, secret), null);
});

test('rejects a signature from a different secret', () => {
  const token = signSiteToken({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE }, 'other-secret');
  assert.equal(readSiteToken(token, secret), null);
});

test('rejects malformed input without throwing', () => {
  for (const raw of ['', 'no-dot', 'a.b.c', 'rod1.only-two', 'rod2.a.b', 'rod1.a.b.c']) {
    assert.equal(readSiteToken(raw, secret), null, raw);
  }
});

// A token from any future rod2 scheme must not validate as rod1: version
// confusion is how a retired format comes back from the dead.
test('rejects a different version prefix even with a valid signature', () => {
  const body = Buffer.from(
    JSON.stringify({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE, exp: Date.now() + 1000 }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  assert.equal(readSiteToken(`rod2.${body}.${sig}`, secret), null);
});

test('rejects a token past its expiry, exactly at the boundary', () => {
  const now = Date.now();
  const token = signSiteToken({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE }, secret, { now });
  assert.notEqual(readSiteToken(token, secret, { now: now + SITE_TOKEN_TTL_MS - 1 }), null);
  assert.equal(readSiteToken(token, secret, { now: now + SITE_TOKEN_TTL_MS }), null);
});

test('fails closed on a missing or non-numeric expiry', () => {
  for (const exp of [undefined, '9999999999999', null, NaN]) {
    const body = Buffer.from(
      JSON.stringify({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE, exp }),
    ).toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    assert.equal(readSiteToken(`rod1.${body}.${sig}`, secret), null, `exp ${JSON.stringify(exp)}`);
  }
});

test('an extended expiry does not survive the signature check', () => {
  const now = Date.now();
  const token = signSiteToken({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE }, secret, { now });
  const sig = token.split('.').pop();
  const stretched = Buffer.from(
    JSON.stringify({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE, exp: now + 10 * SITE_TOKEN_TTL_MS }),
  ).toString('base64url');
  assert.equal(readSiteToken(`rod1.${stretched}.${sig}`, secret), null);
});

// With no secret configured the helper must fail closed rather than treat the
// absence as a universal-accept wildcard.
test('readSiteToken returns null without a secret', () => {
  const token = signSiteToken({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE }, secret);
  assert.equal(readSiteToken(token, undefined), null);
  assert.equal(readSiteToken(token, ''), null);
});

function requestWith(header) {
  return { headers: new Map([['authorization', header]]) };
}

test('siteTokenFromRequest reads a Bearer token, case-insensitively', () => {
  const token = signSiteToken({ login: 'hawkay002', scope: SITE_TOKEN_SCOPE }, secret);
  const req = requestWith(`Bearer ${token}`);
  assert.equal(siteTokenFromRequest(req, secret)?.login, 'hawkay002');
  const lower = requestWith(`bearer ${token}`);
  assert.equal(siteTokenFromRequest(lower, secret)?.login, 'hawkay002');
});

test('siteTokenFromRequest ignores anything that is not a rod1 bearer token', () => {
  assert.equal(siteTokenFromRequest(requestWith(''), secret), null);
  assert.equal(siteTokenFromRequest(requestWith('Bearer ghpx_someothertoken'), secret), null);
  assert.equal(siteTokenFromRequest(requestWith('Basic rod1.abc.def'), secret), null);
  assert.equal(siteTokenFromRequest({ headers: new Map() }, secret), null);
});
