import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVerificationPrune, withoutZoneChallenge, zoneChallengeValues } from '../lib/prune.js';

const claim = (name, extra = {}) => ({
  name,
  owner: { github: 'someone' },
  claimedAt: '2026-08-30T00:00:00Z',
  records: { CNAME: 'cname.vercel-dns.com' },
  ...extra,
});

const withChallenge = (name) =>
  claim(name, {
    subdomains: { _vercel: { TXT: [`vc-domain-verify=${name}.runs-on.dev,tok`] } },
  });

test('a claim with no challenge holds nothing', () => {
  assert.deepEqual(zoneChallengeValues(claim('a')), []);
  assert.equal(withoutZoneChallenge(claim('a')), null);
});

// _vercel.<sub> publishes to a different host with its own 50-value budget,
// so it holds none of the contended slots and must survive the prune.
test('a nested _vercel.<sub> label is not a zone challenge and is left alone', () => {
  const rec = claim('a', {
    subdomains: { '_vercel.blog': { TXT: ['vc-domain-verify=blog.a.runs-on.dev,tok'] } },
  });
  assert.deepEqual(zoneChallengeValues(rec), []);
  assert.equal(withoutZoneChallenge(rec), null);
});

test('pruning drops the _vercel label and the empty subdomains key with it', () => {
  const next = withoutZoneChallenge(withChallenge('a'));
  assert.equal('subdomains' in next, false);
  assert.deepEqual(next.records, { CNAME: 'cname.vercel-dns.com' });
  assert.equal(next.name, 'a');
  assert.equal(next.claimedAt, '2026-08-30T00:00:00Z');
});

test('pruning preserves sibling subdomain labels', () => {
  const rec = claim('a', {
    subdomains: {
      _vercel: { TXT: ['vc-domain-verify=a.runs-on.dev,tok'] },
      _atproto: { TXT: ['did=plc:xyz'] },
    },
  });
  const next = withoutZoneChallenge(rec);
  assert.deepEqual(next.subdomains, { _atproto: { TXT: ['did=plc:xyz'] } });
});

// The label is shared: a value this prune does not own has to survive, and
// keep the label alive with it.
test('a non-challenge TXT under _vercel keeps the label', () => {
  const rec = claim('a', {
    subdomains: { _vercel: { TXT: ['vc-domain-verify=a.runs-on.dev,tok', 'something-else'] } },
  });
  assert.deepEqual(withoutZoneChallenge(rec).subdomains, { _vercel: { TXT: ['something-else'] } });
});

test('the input record is never mutated', () => {
  const rec = withChallenge('a');
  const before = JSON.stringify(rec);
  withoutZoneChallenge(rec);
  assert.equal(JSON.stringify(rec), before);
});

// 'ok' is the only status that is positive evidence verification completed.
// Pruning a 'stuck' name would delete a challenge that is still load-bearing.
test('only names serving their own site are pruned', () => {
  const claims = ['served', 'stuck', 'down', 'card'].map(withChallenge);
  const statuses = { served: 'ok', stuck: 'stuck', down: 'down', card: 'card' };
  const plan = planVerificationPrune(claims, (n) => statuses[n]);

  assert.deepEqual(plan.prune.map((p) => p.name), ['served']);
  assert.equal(plan.freed, 1);
  assert.equal(plan.held.total, 4);
  assert.deepEqual(plan.held.byStatus, { ok: 1, stuck: 1, down: 1, card: 1 });
});

test('an unknown status is never pruned', () => {
  const plan = planVerificationPrune([withChallenge('a')], () => undefined);
  assert.deepEqual(plan.prune, []);
  assert.deepEqual(plan.held.byStatus, { unknown: 1 });
});

test('claims holding no challenge are not counted as held', () => {
  const plan = planVerificationPrune([claim('plain')], () => 'ok');
  assert.equal(plan.held.total, 0);
  assert.deepEqual(plan.prune, []);
});

// A dry run and the apply that follows it must select the same records, so
// the order a limit slices has to be stable rather than directory order.
test('limit selects deterministically by name and reports the remainder', () => {
  const claims = ['c', 'a', 'b'].map(withChallenge);
  const plan = planVerificationPrune(claims, () => 'ok', { limit: 2 });

  assert.deepEqual(plan.prune.map((p) => p.name), ['a', 'b']);
  assert.deepEqual(plan.skipped.map((p) => p.name), ['c']);
  assert.equal(plan.freed, 2);
});

test('a claim holding two challenge values frees both', () => {
  const rec = claim('a', {
    subdomains: { _vercel: { TXT: ['vc-domain-verify=a.runs-on.dev,one', 'vc-domain-verify=a.runs-on.dev,two'] } },
  });
  const plan = planVerificationPrune([rec], () => 'ok');
  assert.equal(plan.freed, 2);
  assert.equal('subdomains' in plan.prune[0].next, false);
});
