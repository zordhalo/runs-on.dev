import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClaim, issueName, planIssueClosures } from '../lib/health.js';

const base = { name: 'lucas', owner: { github: 'zordhalo' }, claimedAt: '2026-08-30T00:00:00Z' };

test('no records: the card is the intended state', () => {
  assert.equal(classifyClaim({ ...base, records: {} }, null), 'card');
});

test('a URL record is an app-served redirect', () => {
  assert.equal(classifyClaim({ ...base, records: { URL: 'https://example.com' } }, null), 'redirect');
});

test('pointed name with a foreign page answering is ok', () => {
  assert.equal(
    classifyClaim(
      { ...base, records: { CNAME: 'cname.vercel-dns.com' } },
      { ok: true, finalHost: 'lucas.runs-on.dev', title: 'Lucas — portfolio' },
    ),
    'ok',
  );
});

test('pointed name that redirected away from the registry host is ok', () => {
  assert.equal(
    classifyClaim(
      { ...base, records: { CNAME: 'cname.vercel-dns.com' } },
      { ok: true, finalHost: 'lucas.vercel.app', title: 'Lucas' },
    ),
    'ok',
  );
});

test('pointed name still answering with the profile card is stuck', () => {
  assert.equal(
    classifyClaim(
      { ...base, records: { CNAME: 'cname.vercel-dns.com' } },
      { ok: true, finalHost: 'lucas.runs-on.dev', title: 'Lucas (lucas.runs-on.dev)' },
    ),
    'stuck',
  );
});

test('pointed name with nothing answering is down', () => {
  assert.equal(
    classifyClaim({ ...base, records: { CNAME: 'cname.vercel-dns.com' } }, { ok: false }),
    'down',
  );
  assert.equal(classifyClaim({ ...base, records: { A: ['1.2.3.4'] } }, undefined), 'down');
});

test('issueName reads the claim out of a nudge title', () => {
  assert.equal(issueName('dexi.runs-on.dev is pointing at Vercel but not serving your project'), 'dexi');
  assert.equal(issueName('feel-your-phone.runs-on.dev should verify now — worth a re-check'), 'feel-your-phone');
  assert.equal(issueName('sync-dns fails deleting existing records with 404'), null);
  assert.equal(issueName(undefined), null);
});

test('closes a nudge issue once its name serves something real', () => {
  const rows = [{ name: 'dexi', status: 'ok' }, { name: 'shrey', status: 'stuck' }];
  const issues = [
    { number: 35, title: 'dexi.runs-on.dev is pointing at Vercel but not serving your project' },
    { number: 40, title: 'shrey.runs-on.dev is pointing at Vercel but not serving your project' },
  ];
  assert.deepEqual(planIssueClosures(rows, issues), [{ number: 35, name: 'dexi' }]);
});

test('a redirect counts as recovered, a bare profile card does not', () => {
  const issues = [{ number: 1, title: 'a.runs-on.dev x' }, { number: 2, title: 'b.runs-on.dev x' }];
  const rows = [{ name: 'a', status: 'redirect' }, { name: 'b', status: 'card' }];
  // 'card' means the records were removed: no longer stuck, but not serving
  // their site either, so "this is working now" would be untrue.
  assert.deepEqual(planIssueClosures(rows, issues), [{ number: 1, name: 'a' }]);
});

test('never closes an issue for a name this run did not probe', () => {
  const rows = [{ name: 'dexi', status: 'ok' }];
  const issues = [{ number: 9, title: 'someoneelse.runs-on.dev is broken' }];
  assert.deepEqual(planIssueClosures(rows, issues), []);
});

test('never closes an issue whose title it cannot parse', () => {
  const rows = [{ name: 'dexi', status: 'ok' }];
  assert.deepEqual(planIssueClosures(rows, [{ number: 9, title: 'Something else entirely' }]), []);
});

test('a down name keeps its issue open', () => {
  const rows = [{ name: 'dexi', status: 'down' }];
  assert.deepEqual(planIssueClosures(rows, [{ number: 35, title: 'dexi.runs-on.dev x' }]), []);
});
