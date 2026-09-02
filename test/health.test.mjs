import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClaim, issueName, planIssueClosures, normalizeAnswer, findDrift } from '../lib/health.js';

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

test('normalizeAnswer strips the trailing dot and case from hostnames', () => {
  assert.equal(normalizeAnswer('CNAME', 'CNAME.Vercel-DNS.com.'), 'cname.vercel-dns.com');
  assert.equal(normalizeAnswer('MX', '10 MX.Example.COM.'), '10 mx.example.com');
  // A TXT value is compared byte for byte: a verification token is case
  // sensitive and a trailing dot inside one would be part of the value.
  assert.equal(normalizeAnswer('TXT', 'vc-domain-verify=X.runs-on.dev,AbC.'), 'vc-domain-verify=X.runs-on.dev,AbC.');
});

test('findDrift reports a declared record the zone does not serve', () => {
  const expected = [{ type: 'CNAME', host: 'dexi.runs-on.dev', value: 'cname.vercel-dns.com' }];
  assert.equal(findDrift(expected, new Map()).length, 1);
  const resolved = new Map([['CNAME dexi.runs-on.dev', ['cname.vercel-dns.com']]]);
  assert.deepEqual(findDrift(expected, resolved), []);
});

test('findDrift is a subset check, so unplanned records are not drift', () => {
  // The zone legitimately holds the apex, the wildcard, and anything placed
  // by hand. Reporting those would make the gate cry wolf immediately.
  const expected = [{ type: 'TXT', host: '_vercel.runs-on.dev', value: 'vc-domain-verify=a.runs-on.dev,tok' }];
  const resolved = new Map([['TXT _vercel.runs-on.dev', [
    'vc-domain-verify=a.runs-on.dev,tok',
    'vc-domain-verify=someone-else.runs-on.dev,other',
    'google-site-verification=whatever',
  ]]]);
  assert.deepEqual(findDrift(expected, resolved), []);
});

test('findDrift matches a resolver answer that came back dotted and uppercased', () => {
  const expected = [{ type: 'CNAME', host: 'x.runs-on.dev', value: 'cname.vercel-dns.com' }];
  const resolved = new Map([['CNAME x.runs-on.dev', [normalizeAnswer('CNAME', 'CNAME.Vercel-DNS.com.')]]]);
  assert.deepEqual(findDrift(expected, resolved), []);
});

test('findDrift compares MX on priority as well as host', () => {
  const expected = [{ type: 'MX', host: 'm.runs-on.dev', value: 'mx.example.com', priority: 10 }];
  const wrongPriority = new Map([['MX m.runs-on.dev', ['20 mx.example.com']]]);
  assert.equal(findDrift(expected, wrongPriority).length, 1);
  const right = new Map([['MX m.runs-on.dev', ['10 mx.example.com']]]);
  assert.deepEqual(findDrift(expected, right), []);
});
