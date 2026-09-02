import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEdit, sameLogin, isUnchanged } from '../lib/edit.js';

const base = {
  name: 'lucas',
  owner: { github: 'zordhalo' },
  claimedAt: '2026-08-30T19:12:04Z',
  records: {},
};

const edit = (patch, editor = 'zordhalo') =>
  validateEdit({ base, head: { ...base, ...patch }, editor });

test('accepts an owner pointing their own name', () => {
  assert.deepEqual(edit({ records: { CNAME: 'cname.vercel-dns.com' } }), { ok: true, errors: [] });
});

test('accepts clearing every record back to the profile card', () => {
  const withRecord = { ...base, records: { CNAME: 'cname.vercel-dns.com' } };
  const out = validateEdit({ base: withRecord, head: { ...withRecord, records: {} }, editor: 'zordhalo' });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('matches the owner case-insensitively', () => {
  assert.equal(edit({ records: {} }, 'ZordHalo').ok, true);
});

test('rejects a non-owner', () => {
  const out = edit({ records: { CNAME: 'evil.example.com' } }, 'attacker');
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('only the owner')));
});

test('reports nothing but ownership when the editor is not the owner', () => {
  // A record that also violates the schema: the caller must not learn that.
  const out = validateEdit({
    base,
    head: { ...base, claimedAt: '2020-01-01T00:00:00Z', records: { A: ['nope'] } },
    editor: 'attacker',
  });
  assert.equal(out.errors.length, 1);
});

test('rejects changing the owner', () => {
  const out = edit({ owner: { github: 'attacker' } });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('owner cannot be changed')));
});

test('rejects changing claimedAt', () => {
  const out = edit({ claimedAt: '2020-01-01T00:00:00Z' });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('claimedAt')));
});

test('rejects renaming the record', () => {
  const out = edit({ name: 'somethingelse' });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('name cannot be changed')));
});

test('rejects a record that fails the schema', () => {
  const out = edit({ records: { CNAME: 'not a hostname', A: ['1.2.3.4'] } });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('CNAME')));
});

test('rejects a javascript: URL redirect', () => {
  const out = edit({ records: { URL: 'javascript:alert(1)' } });
  assert.equal(out.ok, false);
});

test('rejects an edit with no base record', () => {
  const out = validateEdit({ base: null, head: base, editor: 'zordhalo' });
  assert.equal(out.ok, false);
});

test('sameLogin ignores case and rejects non-strings', () => {
  assert.equal(sameLogin('Zyaxxy', 'zyaxxy'), true);
  assert.equal(sameLogin(undefined, 'zyaxxy'), false);
  assert.equal(sameLogin('zyaxxy', null), false);
});

test('isUnchanged ignores key order but not value order', () => {
  const a = { name: 'lucas', records: { A: ['1.2.3.4', '5.6.7.8'], TXT: ['hi'] } };
  const reordered = { records: { TXT: ['hi'], A: ['1.2.3.4', '5.6.7.8'] }, name: 'lucas' };
  assert.equal(isUnchanged(a, reordered), true);

  // Reordering A entries is a real edit: the order is what the owner wrote.
  const swapped = { name: 'lucas', records: { A: ['5.6.7.8', '1.2.3.4'], TXT: ['hi'] } };
  assert.equal(isUnchanged(a, swapped), false);
});

test('isUnchanged sees an actual record change', () => {
  const base = { name: 'lucas', records: {} };
  assert.equal(isUnchanged(base, { name: 'lucas', records: { CNAME: 'x.example.com' } }), false);
  assert.equal(isUnchanged(base, { name: 'lucas', records: {} }), true);
});

test('isUnchanged notices an added or removed subdomains key', () => {
  const base = { name: 'lucas', records: {} };
  assert.equal(isUnchanged(base, { ...base, subdomains: { _atproto: { TXT: ['x'] } } }), false);
});

test('isUnchanged handles nested MX objects', () => {
  const mx = { name: 'l', records: { MX: [{ priority: 10, value: 'mx.example.com' }] } };
  const same = { name: 'l', records: { MX: [{ value: 'mx.example.com', priority: 10 }] } };
  assert.equal(isUnchanged(mx, same), true);
});
