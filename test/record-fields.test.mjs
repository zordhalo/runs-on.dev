import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  modeOf, linesToList, parseMx, mxToLines, buildRecords,
  buildSubdomains, subdomainsToRows, buildProfile, profileToRows,
} from '../lib/record-fields.js';
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

test('buildSubdomains turns rows into the nested record shape', () => {
  const rows = [{ label: '_atproto', type: 'TXT', value: 'did=did:plc:abc123' }];
  assert.deepEqual(buildSubdomains(rows), { _atproto: { TXT: ['did=did:plc:abc123'] } });
});

test('rows sharing a label merge into one entry', () => {
  const rows = [
    { label: 'mail', type: 'A', value: '1.2.3.4' },
    { label: 'mail', type: 'TXT', value: 'v=spf1 -all' },
  ];
  assert.deepEqual(buildSubdomains(rows), {
    mail: { A: ['1.2.3.4'], TXT: ['v=spf1 -all'] },
  });
});

test('a merged label still has to satisfy coexistence', () => {
  // CNAME beside TXT under one label is rejected by the schema, exactly as it
  // would be in a hand-written file. The form does not get a private exemption.
  const subdomains = buildSubdomains([
    { label: 'www', type: 'CNAME', value: 'example.com' },
    { label: 'www', type: 'TXT', value: 'hello' },
  ]);
  const out = validateRecord({
    name: 'lucas', owner: { github: 'z' }, claimedAt: '2026-01-01T00:00:00Z',
    records: {}, subdomains,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('CNAME cannot coexist')));
});

test('half-filled and unlabelled rows are skipped, not written as empty', () => {
  assert.deepEqual(buildSubdomains([
    { label: '', type: 'TXT', value: 'orphan' },
    { label: '_vercel', type: 'TXT', value: '   ' },
    { label: '_atproto', type: 'TXT', value: 'did=x' },
  ]), { _atproto: { TXT: ['did=x'] } });
});

test('labels are lowercased, since DNS labels are not case sensitive', () => {
  assert.deepEqual(buildSubdomains([{ label: '_Vercel', type: 'TXT', value: 'x' }]),
    { _vercel: { TXT: ['x'] } });
});

test('subdomain rows round-trip', () => {
  const subdomains = {
    _vercel: { TXT: ['vc-domain-verify=you.runs-on.dev,abc123'] },
    mail: { MX: [{ priority: 10, value: 'mx.example.com' }] },
  };
  assert.deepEqual(buildSubdomains(subdomainsToRows(subdomains)), subdomains);
});

test('the Vercel verification record the guide documents builds correctly', () => {
  const out = validateRecord({
    name: 'you', owner: { github: 'you' }, claimedAt: '2026-01-01T00:00:00.000Z',
    records: buildRecords('cname', { cname: 'cname.vercel-dns.com' }),
    subdomains: buildSubdomains([
      { label: '_vercel', type: 'TXT', value: 'vc-domain-verify=you.runs-on.dev,abc123' },
    ]),
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

// --- profile ---

test('buildProfile emits only filled fields', () => {
  assert.deepEqual(
    buildProfile({ name: '  Lucas ', bio: '', linkRows: [] }),
    { name: 'Lucas' },
  );
  assert.deepEqual(buildProfile({ name: '', bio: 'hello', linkRows: [] }), { bio: 'hello' });
});

test('buildProfile returns undefined when everything is empty — the API removes the block', () => {
  assert.equal(
    buildProfile({ name: '  ', bio: '', linkRows: [{ label: '', url: '' }] }),
    undefined,
  );
});

test('half-filled link rows survive so the schema reports them', () => {
  // Same discipline as malformed MX lines: drop nothing the owner typed.
  const out = buildProfile({ linkRows: [{ label: 'Site', url: '' }] });
  assert.deepEqual(out, { links: [{ label: 'Site', url: '' }] });
  assert.equal(
    validateRecord({
      name: 'lucas', owner: { github: 'z' }, claimedAt: '2026-01-01T00:00:00Z',
      records: {}, profile: out,
    }).ok,
    false,
  );
});

test('a complete profile builds a record the schema accepts', () => {
  const profile = buildProfile({
    name: 'Lucas',
    bio: 'Builds',
    linkRows: [{ label: 'Site', url: 'https://example.com' }, { label: '', url: '' }],
  });
  const out = validateRecord({
    name: 'lucas', owner: { github: 'z' }, claimedAt: '2026-01-01T00:00:00Z',
    records: {}, profile,
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('profile links round-trip through rows', () => {
  const profile = { name: 'L', links: [{ label: 'a', url: 'https://a.com' }] };
  assert.deepEqual(
    buildProfile({ name: 'L', bio: '', linkRows: profileToRows(profile) }),
    profile,
  );
});

// The manage form's four provider modes select what goes in `records`, and
// 'card' means "publish nothing". That is correct on its own -- but the profile
// editor used to render only inside the card-mode branch, so the single path to
// editing a bio was to switch modes, and saving then wrote records:{} and
// silently dropped a live CNAME. The profile fields now sit outside the mode
// switch. These pin the contract that made the coupling dangerous.
test('card mode publishes no records', () => {
  assert.deepEqual(buildRecords('card', { cname: 'example.vercel.app' }), {});
});

test('a records mode ignores the fields belonging to other modes', () => {
  assert.deepEqual(
    buildRecords('cname', { cname: 'example.vercel.app', url: 'https://elsewhere.test' }),
    { CNAME: 'example.vercel.app' },
  );
});

test('building a profile never produces records', () => {
  // profile and records are independent keys; editing one must not touch the
  // other, which is exactly what the manage form got wrong.
  const profile = buildProfile({ name: 'Ada', bio: 'builds things', linkRows: [] });
  assert.equal('records' in (profile ?? {}), false);
  assert.equal(profile.bio, 'builds things');
});

test('modeOf reports cname for a record that has one, so the form opens there', () => {
  assert.equal(modeOf({ CNAME: 'example.vercel.app' }), 'cname');
  assert.equal(modeOf({}), 'card');
});

// Providers hand out hostnames in shapes the schema's HOSTNAME pattern
// rejects. Rejecting them produced "CNAME must be a hostname" about a value
// that plainly was one -- reported by an owner who had pasted Vercel's target
// with its trailing dot and had no way to see what was wrong.
test('a trailing dot is stripped from a CNAME', () => {
  assert.deepEqual(
    buildRecords('cname', { cname: 'e6bcca57117d3d7e.vercel-dns-017.com.' }),
    { CNAME: 'e6bcca57117d3d7e.vercel-dns-017.com' },
  );
});

test('a CNAME is lowercased, because DNS is case-insensitive', () => {
  assert.deepEqual(
    buildRecords('cname', { cname: '  CNAME.Vercel-DNS.com.  ' }),
    { CNAME: 'cname.vercel-dns.com' },
  );
});

test('normalized CNAMEs pass the schema that used to reject them', () => {
  const rec = {
    name: 'aman', owner: { github: 'x' }, claimedAt: '2026-09-07T00:00:00Z',
    records: buildRecords('cname', { cname: 'E6BCCA.vercel-dns-017.com.' }),
  };
  assert.deepEqual(validateRecord(rec), { ok: true, errors: [] });
});

test('a subdomain CNAME row is normalized the same way', () => {
  assert.deepEqual(
    buildSubdomains([{ label: 'www', type: 'CNAME', value: 'Target.Example.COM.' }]),
    { www: { CNAME: 'target.example.com' } },
  );
});

test('an MX host is normalized but its priority is untouched', () => {
  assert.deepEqual(parseMx('10 MX.Example.com.'), [{ priority: 10, value: 'mx.example.com' }]);
});

// Verification tokens are opaque and case-sensitive; normalizing one breaks it.
test('TXT values are never lowercased or stripped', () => {
  const v = 'vc-domain-verify=amanworks.runs-on.dev,81E73fdea1b7f9058ffa';
  assert.deepEqual(buildSubdomains([{ label: '_vercel', type: 'TXT', value: v }]), { _vercel: { TXT: [v] } });
});
