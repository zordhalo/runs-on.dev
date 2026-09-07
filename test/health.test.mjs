import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyClaim, issueName, planIssueClosures, planIssueOpens, diagnoseStuck, stuckIssueBody,
  normalizeAnswer, findDrift,
} from '../lib/health.js';

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

// A TXT wrapped in quotes is zone-file presentation, not content: the provider
// stores the inner string, so comparing raw reported drift that no resync could
// clear and failed health-check forever. selim.runs-on.dev sat in that state.
test('a quoted TXT compares equal to the value DNS holds', () => {
  assert.equal(
    normalizeAnswer('TXT', '"Under Construction... SOON"'),
    normalizeAnswer('TXT', 'Under Construction... SOON'),
  );
});

test('only one surrounding pair is stripped, inner quotes survive', () => {
  assert.equal(normalizeAnswer('TXT', '"say \\"hi\\""'), 'say \\"hi\\"');
  assert.equal(normalizeAnswer('TXT', 'no quotes here'), 'no quotes here');
});

test('a verification token is unaffected by TXT normalization', () => {
  const t = 'vc-domain-verify=selim.runs-on.dev,ABC123def';
  assert.equal(normalizeAnswer('TXT', t), t);
});

// --- opening nudge issues (the half that never existed) ---

const rows = (o) => Object.entries(o).map(([name, status]) => ({ name, status }));

test('opens an issue only for stuck names', () => {
  const out = planIssueOpens(rows({ a: 'stuck', b: 'ok', c: 'down', d: 'card', e: 'redirect' }), []);
  assert.deepEqual(out.map((x) => x.name), ['a']);
});

// A robot filing an issue about someone's transient outage is noise; `down`
// is as easily a host having a bad afternoon as a misconfiguration.
test('down is never reported, however many there are', () => {
  assert.deepEqual(planIssueOpens(rows({ a: 'down', b: 'down' }), []), []);
});

test('a name that already has an issue is not given another', () => {
  const issues = [{ number: 7, title: 'a.runs-on.dev is not serving your site yet' }];
  assert.deepEqual(planIssueOpens(rows({ a: 'stuck', b: 'stuck' }), issues).map((x) => x.name), ['b']);
});

// Deduping reads closed issues too: an owner who closed theirs without fixing
// the name should not be handed a fresh one every morning.
test('a closed issue still counts as spoken for', () => {
  const issues = [{ number: 7, title: 'a.runs-on.dev is not serving your site yet', state: 'closed' }];
  assert.deepEqual(planIssueOpens(rows({ a: 'stuck' }), issues), []);
});

test('the cap bounds how many a single run files', () => {
  const many = rows(Object.fromEntries('abcdefgh'.split('').map((n) => [n, 'stuck'])));
  assert.equal(planIssueOpens(many, []).length, 5);
  assert.equal(planIssueOpens(many, [], { cap: 2 }).length, 2);
});

// --- diagnosis drives what the issue actually says ---

test('a CNAME at a vercel.app deployment URL is named as such', () => {
  assert.equal(diagnoseStuck({ records: { CNAME: 'portfolio-chi.vercel.app' } }), 'vercel-app-url');
});

test('a vercel target with no challenge is distinguished from one awaiting verification', () => {
  const cname = { CNAME: 'abc.vercel-dns-017.com' };
  assert.equal(diagnoseStuck({ records: cname }), 'vercel-no-challenge');
  assert.equal(
    diagnoseStuck({ records: cname, subdomains: { _vercel: { TXT: ['vc-domain-verify=a.runs-on.dev,t'] } } }),
    'vercel-awaiting-verification',
  );
});

test('platform default hosts are recognised, and anything else falls back', () => {
  assert.equal(diagnoseStuck({ records: { CNAME: 'me.github.io' } }), 'platform-default-host');
  assert.equal(diagnoseStuck({ records: { CNAME: 'x.pages.dev' } }), 'platform-default-host');
  assert.equal(diagnoseStuck({ records: { A: ['1.2.3.4'] } }), 'unknown');
});

// --- the issue text itself ---
//
// These exist because the first real run of the issue opener died with
// "Cannot access 'STUCK_BODY' before initialization": the templates were a
// module-level const in the script, below the call site, so they sat in the
// temporal dead zone. Nothing local caught it -- without a token the writer
// returns early and never reaches them. Rendering every kind here does.

const stuckClaim = {
  name: 'aman', owner: { github: 'aman690888' },
  records: { CNAME: 'abc.vercel-dns-017.com' },
};

test('every diagnosis renders a body naming the owner and the name', () => {
  for (const kind of ['vercel-app-url', 'vercel-no-challenge', 'vercel-awaiting-verification', 'platform-default-host', 'unknown']) {
    const claim = kind === 'vercel-app-url'
      ? { ...stuckClaim, records: { CNAME: 'portfolio.vercel.app' } }
      : stuckClaim;
    const body = stuckIssueBody(kind, 'aman', claim);
    assert.ok(body.startsWith('@aman690888 — '), `${kind} should address the owner`);
    assert.ok(body.includes('aman.runs-on.dev'), `${kind} should name the hostname`);
    assert.ok(body.includes('**Fix:**') || kind === 'unknown', `${kind} should say what to do`);
  }
});

test('an unrecognised diagnosis falls back rather than throwing', () => {
  const body = stuckIssueBody('something-new', 'aman', stuckClaim);
  assert.ok(body.includes('aman.runs-on.dev'));
});

test('a claim with no owner still renders', () => {
  const body = stuckIssueBody('unknown', 'aman', { name: 'aman', records: {} });
  assert.ok(!body.startsWith('@'));
  assert.ok(body.includes('aman.runs-on.dev'));
});

test('an A-record claim renders its addresses rather than undefined', () => {
  const body = stuckIssueBody('unknown', 'aman', { name: 'aman', records: { A: ['1.2.3.4', '5.6.7.8'] } });
  assert.ok(body.includes('1.2.3.4, 5.6.7.8'));
  assert.ok(!body.includes('undefined'));
});
