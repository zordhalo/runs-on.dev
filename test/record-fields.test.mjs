import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeOf, linesToList, parseMx, mxToLines, buildRecords } from '../lib/record-fields.js';
import { validateRecord } from '../lib/schema.js';

test('modeOf reads the shape back out of a stored record', () => {
  assert.equal(modeOf({}), 'card');
  assert.equal(modeOf({ CNAME: 'x.example.com' }), 'cname');
  assert.equal(modeOf({ URL: 'https://example.com' }), 'url');
  assert.equal(modeOf({ A: ['1.2.3.4'] }), 'advanced');
  assert.equal(modeOf({ TXT: ['hello'] }), 'advanced');
  assert.equal(modeOf({ MX: [{ priority: 10, value: 'mx.example.com' }] }), 'advanced');
  assert.equal(modeOf(undefined), 'card');
});

test('linesToList trims, drops blanks, and survives stray whitespace', () => {
  assert.deepEqual(linesToList('  1.2.3.4 \n\n 5.6.7.8  \n'), ['1.2.3.4', '5.6.7.8']);
  assert.deepEqual(linesToList(''), []);
  assert.deepEqual(linesToList(undefined), []);
});

test('MX round-trips through lines and back', () => {
  const mx = [{ priority: 10, value: 'mx1.example.com' }, { priority: 20, value: 'mx2.example.com' }];
  assert.deepEqual(parseMx(mxToLines(mx)), mx);
});

test('a malformed MX line survives parsing so the schema can reject it', () => {
  // Silently dropping it would tell the owner their record saved fine while
  // quietly discarding the line they typed.
  const parsed = parseMx('notanumber mx.example.com');
  assert.equal(parsed.length, 1);
  assert.ok(Number.isNaN(parsed[0].priority));
  const check = validateRecord({
    name: 'lucas', owner: { github: 'z' }, claimedAt: '2026-01-01T00:00:00Z',
    records: { MX: parsed },
  });
  assert.equal(check.ok, false);
});

test('buildRecords emits only the active mode, never a coexistence violation', () => {
  const fields = { cname: 'cname.vercel-dns.com', url: 'https://example.com', a: '1.2.3.4', txt: 'hi', mx: '10 mx.example.com' };
  assert.deepEqual(buildRecords('cname', fields), { CNAME: 'cname.vercel-dns.com' });
  assert.deepEqual(buildRecords('url', fields), { URL: 'https://example.com' });
  assert.deepEqual(buildRecords('card', fields), {});
  assert.deepEqual(buildRecords('advanced', fields), {
    A: ['1.2.3.4'], TXT: ['hi'], MX: [{ priority: 10, value: 'mx.example.com' }],
  });
});

test('every mode builds a record the schema accepts', () => {
  const fields = { cname: 'cname.vercel-dns.com', url: 'https://example.com', a: '1.2.3.4', txt: 'hi', mx: '10 mx.example.com' };
  for (const mode of ['card', 'cname', 'url', 'advanced']) {
    const out = validateRecord({
      name: 'lucas', owner: { github: 'z' }, claimedAt: '2026-01-01T00:00:00Z',
      records: buildRecords(mode, fields),
    });
    assert.deepEqual(out, { ok: true, errors: [] }, `mode ${mode}: ${out.errors}`);
  }
});

test('an empty field in a stand-alone mode clears the record rather than writing a blank', () => {
  assert.deepEqual(buildRecords('cname', { cname: '   ' }), {});
  assert.deepEqual(buildRecords('url', { url: '' }), {});
  assert.deepEqual(buildRecords('advanced', { a: '', txt: '', mx: '' }), {});
});
