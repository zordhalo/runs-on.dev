import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAttemptClaim, evaluateClaim } from '../lib/claim.js';

const now = new Date('2026-08-30T00:00:00Z');
const session = {
  login: 'zordhalo',
  createdAt: '2020-01-01T00:00:00Z',
  publicRepos: 5,
};

test('produces a record for a good claim', () => {
  const out = evaluateClaim({ name: 'lucas', session, existing: null, now });
  assert.equal(out.ok, true);
  assert.deepEqual(out.record, {
    name: 'lucas',
    owner: { github: 'zordhalo' },
    claimedAt: now.toISOString(),
    records: {},
  });
});

test('requires a session', () => {
  const out = evaluateClaim({ name: 'lucas', session: null, existing: null, now });
  assert.deepEqual(out, { ok: false, status: 401, code: 'signin_required' });
});

test('rejects a bad name', () => {
  assert.equal(evaluateClaim({ name: 'Lucas', session, existing: null, now }).code, 'invalid_name');
});

test('rejects a reserved name', () => {
  assert.equal(evaluateClaim({ name: 'api', session, existing: null, now }).code, 'reserved');
});

test('rejects a taken name', () => {
  const existing = { name: 'lucas', owner: { github: 'someone' } };
  const out = evaluateClaim({ name: 'lucas', session, existing, now });
  assert.deepEqual(out, { ok: false, status: 409, code: 'taken' });
});

test('rejects an ineligible account', () => {
  const fresh = { ...session, createdAt: '2026-08-25T00:00:00Z' };
  assert.equal(evaluateClaim({ name: 'lucas', session: fresh, existing: null, now }).code, 'ineligible_age');
});

test('rejects an account with no public repos', () => {
  const bare = { ...session, publicRepos: 0 };
  assert.equal(evaluateClaim({ name: 'lucas', session: bare, existing: null, now }).code, 'ineligible_repos');
});

test('allows a claim at ownedCount 0', () => {
  const out = evaluateClaim({ name: 'lucas', session, existing: null, now, ownedCount: 0 });
  assert.equal(out.ok, true);
});

test('rejects a claim at the per-account limit', () => {
  const out = evaluateClaim({ name: 'lucas', session, existing: null, now, ownedCount: 1 });
  assert.deepEqual(out, { ok: false, status: 403, code: 'limit_reached' });
});

test('a maintainer project name is exempt from the per-account limit', () => {
  const out = evaluateClaim({ name: 'clatterbox', session, existing: null, now, ownedCount: 1 });
  assert.equal(out.ok, true);
});

test('the maintainer exemption is per name and per account', () => {
  const other = { ...session, login: 'someone-else' };
  assert.equal(evaluateClaim({ name: 'clatterbox', session: other, existing: null, now, ownedCount: 1 }).code, 'limit_reached');
  assert.equal(evaluateClaim({ name: 'another', session, existing: null, now, ownedCount: 1 }).code, 'limit_reached');
});

test('a taken maintainer project name still reports taken', () => {
  const existing = { name: 'clatterbox', owner: { github: 'someone' } };
  assert.equal(evaluateClaim({ name: 'clatterbox', session, existing, now, ownedCount: 1 }).code, 'taken');
});

test('checks the limit after eligibility, so an ineligible account at the limit reports the eligibility reason', () => {
  const fresh = { ...session, createdAt: '2026-08-25T00:00:00Z' };
  const out = evaluateClaim({ name: 'lucas', session: fresh, existing: null, now, ownedCount: 1 });
  assert.equal(out.code, 'ineligible_age');
});

test('checks the limit before the existing/taken check', () => {
  const existing = { name: 'lucas', owner: { github: 'someone' } };
  const out = evaluateClaim({ name: 'lucas', session, existing, now, ownedCount: 1 });
  assert.deepEqual(out, { ok: false, status: 403, code: 'limit_reached' });
});

// canAttemptClaim gates the "Claim it" button. The availability check is
// advisory — /api/claim's atomic create is the authority — so a check that
// could not run must leave the button live rather than stranding the visitor.
test('allows an attempt when the check could not run', () => {
  for (const status of ['check_failed', 'busy', 'server_error', 'retry_exhausted', null]) {
    assert.equal(canAttemptClaim({ name: 'lucas', status }), true, `status ${status}`);
  }
});

test('allows an attempt on a name the check said was available', () => {
  assert.equal(canAttemptClaim({ name: 'lucas', status: 'available' }), true);
});

test('refuses an attempt the server already settled as a no', () => {
  for (const status of [
    'taken',
    'reserved',
    'claimed',
    'limit_reached',
    'signin_required',
    'ineligible_age',
    'ineligible_repos',
  ]) {
    assert.equal(canAttemptClaim({ name: 'lucas', status }), false, `status ${status}`);
  }
});

test('refuses an attempt while one is already in flight', () => {
  assert.equal(canAttemptClaim({ name: 'lucas', status: 'claiming' }), false);
  assert.equal(canAttemptClaim({ name: 'lucas', status: 'retrying' }), false);
});

test('refuses an attempt on a name that fails the grammar', () => {
  assert.equal(canAttemptClaim({ name: 'a', status: null }), false);
  assert.equal(canAttemptClaim({ name: '-nope', status: null }), false);
  assert.equal(canAttemptClaim({ name: 'lucas', status: 'invalid_length' }), false);
  assert.equal(canAttemptClaim({ name: 'Lucas!', status: 'check_failed' }), false);
});
