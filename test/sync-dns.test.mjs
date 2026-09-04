import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDnsChanges,
  planZoneVerificationRecords,
  reconcileZoneVerification,
  reconcileDnsRecords,
  listPath,
  createPath,
  removePath,
} from '../lib/dns.js';

const base = { name: 'lucas', owner: { github: 'zordhalo' }, claimedAt: '2026-08-30T00:00:00Z' };

test('an empty records object plans no changes', () => {
  assert.deepEqual(planDnsChanges({ ...base, records: {} }), []);
});

test('plans a CNAME', () => {
  assert.deepEqual(planDnsChanges({ ...base, records: { CNAME: 'lucas.vercel.app' } }), [
    { type: 'CNAME', name: 'lucas', value: 'lucas.vercel.app' },
  ]);
});

test('plans one entry per A address', () => {
  assert.deepEqual(planDnsChanges({ ...base, records: { A: ['1.2.3.4', '5.6.7.8'] } }), [
    { type: 'A', name: 'lucas', value: '1.2.3.4' },
    { type: 'A', name: 'lucas', value: '5.6.7.8' },
  ]);
});

test('plans TXT entries', () => {
  assert.deepEqual(planDnsChanges({ ...base, records: { TXT: ['v=spf1 -all'] } }), [
    { type: 'TXT', name: 'lucas', value: 'v=spf1 -all' },
  ]);
});

test('plans MX entries with priority', () => {
  assert.deepEqual(
    planDnsChanges({
      ...base,
      records: { MX: [{ priority: 10, value: 'mx1.example.com' }, { priority: 20, value: 'mx2.example.com' }] },
    }),
    [
      { type: 'MX', name: 'lucas', value: 'mx1.example.com', priority: 10 },
      { type: 'MX', name: 'lucas', value: 'mx2.example.com', priority: 20 },
    ],
  );
});

test('a URL record plans no DNS change', () => {
  assert.deepEqual(planDnsChanges({ ...base, records: { URL: 'https://example.com' } }), []);
});

test('plans a nested subdomain TXT record as <label>.<name>', () => {
  assert.deepEqual(
    planDnsChanges({
      ...base,
      records: {},
      subdomains: { _atproto: { TXT: ['did=did:plc:abc123'] } },
    }),
    [{ type: 'TXT', name: '_atproto.lucas', value: 'did=did:plc:abc123' }],
  );
});

test('plans both root and nested subdomain records together', () => {
  assert.deepEqual(
    planDnsChanges({
      ...base,
      records: { CNAME: 'lucas.vercel.app' },
      subdomains: { _discord: { TXT: ['verify=abc'] } },
    }),
    [
      { type: 'CNAME', name: 'lucas', value: 'lucas.vercel.app' },
      { type: 'TXT', name: '_discord.lucas', value: 'verify=abc' },
    ],
  );
});

// The Vercel DNS endpoint paths. These lived as inline template strings in
// scripts/sync-dns.mjs, where nothing could assert them: the delete path was
// missing its {domain} segment, so every delete 404'd from the day it was
// written and the sync only stayed green while no name had records to replace.
test('listPath asks for the domain\'s records, a page at a time', () => {
  assert.equal(listPath('runs-on.dev'), '/v4/domains/runs-on.dev/records?limit=100');
  assert.equal(
    listPath('runs-on.dev', 'abc123'),
    '/v4/domains/runs-on.dev/records?limit=100&until=abc123',
  );
});

test('createPath posts under the domain', () => {
  assert.equal(createPath('runs-on.dev'), '/v2/domains/runs-on.dev/records');
});

test('removePath includes the domain, not just the record id', () => {
  assert.equal(removePath('runs-on.dev', 'rec_abc'), '/v2/domains/runs-on.dev/records/rec_abc');
});

test('the zone mirror unions _vercel TXT values across claims, deduplicated', () => {
  const claims = [
    { ...base, subdomains: { _vercel: { TXT: ['vc-domain-verify=lucas.runs-on.dev,a1'] } } },
    {
      name: 'shrey',
      owner: { github: 'someone' },
      claimedAt: '2026-09-01T00:00:00Z',
      subdomains: {
        _vercel: { TXT: ['vc-domain-verify=shrey.runs-on.dev,b2', 'vc-domain-verify=lucas.runs-on.dev,a1'] },
      },
    },
    { ...base, name: 'dexi', records: { CNAME: 'cname.vercel-dns.com' } },
  ];

  assert.deepEqual(planZoneVerificationRecords(claims), [
    { type: 'TXT', name: '_vercel', value: 'vc-domain-verify=lucas.runs-on.dev,a1' },
    { type: 'TXT', name: '_vercel', value: 'vc-domain-verify=shrey.runs-on.dev,b2' },
  ]);
});

test('claims without _vercel TXTs plan no zone records', () => {
  assert.deepEqual(
    planZoneVerificationRecords([
      { ...base, records: { CNAME: 'cname.vercel-dns.com' } },
      { ...base, name: 'hussain', subdomains: { _atproto: { TXT: ['did=did:plc:abc123'] } } },
    ]),
    [],
  );
});

// --- reconcileDnsRecords (issue #54) ---

test('identical existing and desired records are all unchanged — nothing touched', () => {
  const existing = [
    { id: 'rec_1', type: 'CNAME', name: 'lucas', value: 'cname.vercel-dns.com' },
  ];
  const desired = [
    { type: 'CNAME', name: 'lucas', value: 'cname.vercel-dns.com' },
  ];
  const { unchanged, remove, create } = reconcileDnsRecords(existing, desired);
  assert.equal(unchanged.length, 1);
  assert.equal(remove.length, 0);
  assert.equal(create.length, 0);
});

test('a CNAME value change produces exactly one remove and one create, not a full wipe', () => {
  const existing = [
    { id: 'rec_1', type: 'CNAME', name: 'lucas', value: 'old.vercel-dns.com' },
    { id: 'rec_2', type: 'TXT', name: '_vercel.lucas', value: 'vc-domain-verify=lucas.runs-on.dev,abc' },
  ];
  const desired = [
    { type: 'CNAME', name: 'lucas', value: 'new.vercel-dns.com' },
    { type: 'TXT', name: '_vercel.lucas', value: 'vc-domain-verify=lucas.runs-on.dev,abc' },
  ];
  const { unchanged, remove, create } = reconcileDnsRecords(existing, desired);
  // The TXT is untouched even though the CNAME changed — this is the exact
  // safety property issue #54 asks for: a failed create only takes down the
  // record being changed, not the whole name.
  assert.equal(unchanged.length, 1);
  assert.equal(unchanged[0].type, 'TXT');
  assert.equal(remove.length, 1);
  assert.equal(remove[0].value, 'old.vercel-dns.com');
  assert.equal(create.length, 1);
  assert.equal(create[0].value, 'new.vercel-dns.com');
});

test('an empty desired set removes everything (name released)', () => {
  const existing = [
    { id: 'rec_1', type: 'CNAME', name: 'lucas', value: 'x.example.com' },
  ];
  const { remove, create, unchanged } = reconcileDnsRecords(existing, []);
  assert.equal(remove.length, 1);
  assert.equal(create.length, 0);
  assert.equal(unchanged.length, 0);
});

test('MX records with the same priority match across mxPriority and priority field names', () => {
  const existing = [
    { id: 'rec_1', type: 'MX', name: 'lucas', value: 'mx1.example.com', mxPriority: 10 },
  ];
  const desired = [
    { type: 'MX', name: 'lucas', value: 'mx1.example.com', priority: 10 },
  ];
  const { unchanged, remove, create } = reconcileDnsRecords(existing, desired);
  assert.equal(unchanged.length, 1);
  assert.equal(remove.length, 0);
  assert.equal(create.length, 0);
});

test('MX priority change produces a remove + create pair', () => {
  const existing = [
    { id: 'rec_1', type: 'MX', name: 'lucas', value: 'mx1.example.com', mxPriority: 10 },
  ];
  const desired = [
    { type: 'MX', name: 'lucas', value: 'mx1.example.com', priority: 20 },
  ];
  const { remove, create } = reconcileDnsRecords(existing, desired);
  assert.equal(remove.length, 1);
  assert.equal(create.length, 1);
});

test('a no-op save touches zero DNS records', () => {
  // The scenario a double-clicked Save produces: same record, same values.
  // The old flow deleted and recreated everything; this must be a no-op.
  const record = { type: 'CNAME', name: 'lucas', value: 'cname.vercel-dns.com' };
  const existing = [{ id: 'rec_1', ...record }];
  const { unchanged, remove, create } = reconcileDnsRecords(existing, [record]);
  assert.deepEqual({ remove, create }, { remove: [], create: [] });
  assert.equal(unchanged.length, 1);
});

test('reconcile creates missing values and drops only unclaimed vc-domain-verify TXTs', () => {
  const { create, remove } = reconcileZoneVerification(
    [{ type: 'TXT', name: '_vercel', value: 'vc-domain-verify=lucas.runs-on.dev,a1' }],
    [
      { id: 'rec_stays', type: 'TXT', name: '_vercel', value: 'vc-domain-verify=lucas.runs-on.dev,a1' },
      { id: 'rec_dropped', type: 'TXT', name: '_vercel', value: 'vc-domain-verify=gone.runs-on.dev,z9' },
      // Hand-placed by the operator: no vc-domain-verify= prefix, so the
      // mirror must never claim ownership of it.
      { id: 'rec_manual', type: 'TXT', name: '_vercel', value: 'operator-note=keep-me' },
      // A claim's own child record: belongs to that claim's sync pass.
      { id: 'rec_child', type: 'TXT', name: '_vercel.lucas', value: 'vc-domain-verify=lucas.runs-on.dev,a1' },
    ],
  );

  assert.deepEqual(create, []);
  assert.deepEqual(remove.map((record) => record.id), ['rec_dropped']);
});

test('reconcile creates a value the zone does not hold yet', () => {
  const { create, remove } = reconcileZoneVerification(
    [{ type: 'TXT', name: '_vercel', value: 'vc-domain-verify=shovith.runs-on.dev,c3' }],
    [],
  );

  assert.deepEqual(create, [{ type: 'TXT', name: '_vercel', value: 'vc-domain-verify=shovith.runs-on.dev,c3' }]);
  assert.deepEqual(remove, []);
});

// The mirror publishes to the apex, one label above every claim, from a field
// its owner controls and can edit from /manage with no review. What it accepts
// is therefore a security boundary, not a formatting detail.
test('a claim may only mirror a challenge naming its own hostname', () => {
  const attacker = {
    name: 'attacker',
    subdomains: { _vercel: { TXT: [
      'vc-domain-verify=runs-on.dev,ATTACKERTOKEN',
      'vc-domain-verify=hussain.runs-on.dev,ATTACKERTOKEN',
      'vc-domain-verify=attacker.runs-on.dev,OWNTOKEN',
    ] } },
  };
  const values = planZoneVerificationRecords([attacker]).map((r) => r.value);
  assert.deepEqual(values, ['vc-domain-verify=attacker.runs-on.dev,OWNTOKEN']);
});

test('a challenge for the apex itself is never mirrored', () => {
  // Publishing this would let the claimant attach runs-on.dev to their own
  // Vercel account: the apex, not their one name.
  const claim = { name: 'x', subdomains: { _vercel: { TXT: ['vc-domain-verify=runs-on.dev,T'] } } };
  assert.deepEqual(planZoneVerificationRecords([claim]), []);
});

test('a name that merely prefixes another cannot borrow its challenge', () => {
  // "hussain" must not satisfy the prefix check for "hussain-two".
  const claim = { name: 'hussain', subdomains: { _vercel: { TXT: [
    'vc-domain-verify=hussain-two.runs-on.dev,T',
  ] } } };
  assert.deepEqual(planZoneVerificationRecords([claim]), []);
});

test('every real _vercel claim still mirrors', () => {
  const claims = ['hussain', 'shovith', 'laurentmaxhuni', 'feel-your-phone'].map((name) => ({
    name,
    subdomains: { _vercel: { TXT: [`vc-domain-verify=${name}.runs-on.dev,tok`] } },
  }));
  assert.equal(planZoneVerificationRecords(claims).length, 4);
});
