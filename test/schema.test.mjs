import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRecord } from '../lib/schema.js';

// --- profile ---

test('accepts a full profile block', () => {
  const out = validateRecord({
    ...valid,
    profile: {
      name: 'Lucas',
      bio: 'Builds things',
      links: [{ label: 'Site', url: 'https://example.com' }],
    },
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('accepts a partial profile — any subset of fields', () => {
  assert.equal(validateRecord({ ...valid, profile: {} }).ok, true);
  assert.equal(validateRecord({ ...valid, profile: { name: 'L' } }).ok, true);
  assert.equal(
    validateRecord({ ...valid, profile: { links: [{ label: 'a', url: 'http://x.com' }] } }).ok,
    true,
  );
});

test('rejects unknown profile keys', () => {
  const out = validateRecord({ ...valid, profile: { nickname: 'L' } });
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes('unknown key: profile.nickname'));
});

test('rejects an empty or overlong name/bio', () => {
  // Presence means content: an empty string would render as a deliberate blank.
  assert.equal(validateRecord({ ...valid, profile: { name: '' } }).ok, false);
  assert.equal(validateRecord({ ...valid, profile: { bio: 'x'.repeat(201) } }).ok, false);
  assert.equal(validateRecord({ ...valid, profile: { name: 'x'.repeat(61) } }).ok, false);
});

test('rejects profile links that are not absolute http(s) URLs', () => {
  // Links render as clickable rows on a trusted domain, so they follow the
  // URL-record rules, not looser ones.
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', 'not a url']) {
    const out = validateRecord({ ...valid, profile: { links: [{ label: 'x', url }] } });
    assert.equal(out.ok, false, url);
  }
});

test('rejects extra keys on a link entry', () => {
  const out = validateRecord({
    ...valid,
    profile: { links: [{ label: 'x', url: 'https://a.com', icon: 'y' }] },
  });
  assert.equal(out.ok, false);
});

test('rejects more than 8 links, an empty array, and overlong labels', () => {
  const links = Array.from({ length: 9 }, () => ({ label: 'x', url: 'https://a.com' }));
  assert.equal(validateRecord({ ...valid, profile: { links } }).ok, false);
  assert.equal(validateRecord({ ...valid, profile: { links: [] } }).ok, false);
  assert.equal(
    validateRecord({ ...valid, profile: { links: [{ label: 'x'.repeat(41), url: 'https://a.com' }] } }).ok,
    false,
  );
});

const valid = {
  name: 'lucas',
  owner: { github: 'zordhalo' },
  claimedAt: '2026-08-30T19:12:04Z',
  records: {},
};

test('accepts a minimal claim record', () => {
  assert.deepEqual(validateRecord(valid), { ok: true, errors: [] });
});

test('accepts CNAME, A and TXT records', () => {
  assert.equal(validateRecord({ ...valid, records: { CNAME: 'lucas.vercel.app' } }).ok, true);
  assert.equal(validateRecord({ ...valid, records: { A: ['76.76.21.21'] } }).ok, true);
  assert.equal(validateRecord({ ...valid, records: { TXT: ['hello'] } }).ok, true);
});

test('rejects unknown top-level keys', () => {
  const out = validateRecord({ ...valid, sneaky: true });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('sneaky')));
});

test('rejects a name that fails grammar', () => {
  assert.equal(validateRecord({ ...valid, name: 'Lucas' }).ok, false);
});

test('rejects a missing owner', () => {
  const { owner, ...rest } = valid;
  assert.equal(validateRecord(rest).ok, false);
});

test('rejects CNAME combined with A', () => {
  const out = validateRecord({ ...valid, records: { CNAME: 'x.example.com', A: ['1.2.3.4'] } });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('CNAME')));
});

test('rejects malformed A records', () => {
  assert.equal(validateRecord({ ...valid, records: { A: ['999.1.1.1'] } }).ok, false);
  assert.equal(validateRecord({ ...valid, records: { A: 'not-an-array' } }).ok, false);
});

test('rejects a non-ISO claimedAt', () => {
  assert.equal(validateRecord({ ...valid, claimedAt: 'yesterday' }).ok, false);
});

test('accepts a valid https URL redirect', () => {
  const out = validateRecord({ ...valid, records: { URL: 'https://github.com/zordhalo' } });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('accepts a valid http URL redirect', () => {
  assert.equal(validateRecord({ ...valid, records: { URL: 'http://example.com' } }).ok, true);
});

test('rejects a javascript: URL', () => {
  const out = validateRecord({ ...valid, records: { URL: 'javascript:alert(1)' } });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('URL')));
});

test('rejects a data: URL', () => {
  assert.equal(validateRecord({ ...valid, records: { URL: 'data:text/html,<script>' } }).ok, false);
});

test('rejects a vbscript: URL', () => {
  assert.equal(validateRecord({ ...valid, records: { URL: 'vbscript:msgbox(1)' } }).ok, false);
});

test('rejects a protocol-relative URL', () => {
  assert.equal(validateRecord({ ...valid, records: { URL: '//evil.com' } }).ok, false);
});

test('rejects a URL that fails new URL()', () => {
  assert.equal(validateRecord({ ...valid, records: { URL: 'not a url' } }).ok, false);
});

test('rejects URL alongside another record type', () => {
  const out = validateRecord({ ...valid, records: { URL: 'https://example.com', TXT: ['hi'] } });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('URL')));
});

test('accepts MX alone', () => {
  const out = validateRecord({
    ...valid,
    records: { MX: [{ priority: 10, value: 'mx1.example.com' }] },
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('accepts MX alongside A and TXT', () => {
  const out = validateRecord({
    ...valid,
    records: {
      A: ['1.2.3.4'],
      TXT: ['hello'],
      MX: [{ priority: 10, value: 'mx1.example.com' }],
    },
  });
  assert.equal(out.ok, true);
});

test('rejects MX alongside CNAME', () => {
  const out = validateRecord({
    ...valid,
    records: { CNAME: 'x.example.com', MX: [{ priority: 10, value: 'mx1.example.com' }] },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('CNAME')));
});

test('rejects MX with a bad priority', () => {
  const tooHigh = validateRecord({
    ...valid,
    records: { MX: [{ priority: 70000, value: 'mx1.example.com' }] },
  });
  assert.equal(tooHigh.ok, false);

  const negative = validateRecord({
    ...valid,
    records: { MX: [{ priority: -1, value: 'mx1.example.com' }] },
  });
  assert.equal(negative.ok, false);

  const nonInteger = validateRecord({
    ...valid,
    records: { MX: [{ priority: 1.5, value: 'mx1.example.com' }] },
  });
  assert.equal(nonInteger.ok, false);
});

test('rejects an empty MX array', () => {
  assert.equal(validateRecord({ ...valid, records: { MX: [] } }).ok, false);
});

test('rejects more than 5 MX entries', () => {
  const mx = Array.from({ length: 6 }, (_, i) => ({ priority: i, value: 'mx.example.com' }));
  assert.equal(validateRecord({ ...valid, records: { MX: mx } }).ok, false);
});

test('accepts a valid subdomains entry', () => {
  const out = validateRecord({
    ...valid,
    subdomains: { _atproto: { TXT: ['did=did:plc:abc123'] } },
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('rejects a subdomain label with a dot', () => {
  const out = validateRecord({
    ...valid,
    subdomains: { 'foo.bar': { TXT: ['hello'] } },
  });
  assert.equal(out.ok, false);
});

test('rejects a subdomain holding URL', () => {
  const out = validateRecord({
    ...valid,
    subdomains: { blog: { URL: 'https://example.com' } },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('URL')));
});

test('rejects more than 10 subdomains', () => {
  const subdomains = {};
  for (let i = 0; i < 11; i += 1) subdomains[`sub${i}`] = { TXT: ['hi'] };
  assert.equal(validateRecord({ ...valid, subdomains }).ok, false);
});

test('accepts exactly 10 subdomains', () => {
  const subdomains = {};
  for (let i = 0; i < 10; i += 1) subdomains[`sub${i}`] = { TXT: ['hi'] };
  assert.equal(validateRecord({ ...valid, subdomains }).ok, true);
});

test('rejects a subdomain CNAME alongside A', () => {
  const out = validateRecord({
    ...valid,
    subdomains: { blog: { CNAME: 'x.example.com', A: ['1.2.3.4'] } },
  });
  assert.equal(out.ok, false);
});

test('accepts a subdomain MX alongside A', () => {
  const out = validateRecord({
    ...valid,
    subdomains: {
      mail: { A: ['1.2.3.4'], MX: [{ priority: 10, value: 'mx1.example.com' }] },
    },
  });
  assert.equal(out.ok, true);
});

// --- schema/record.schema.json stays in step with lib/schema.js ---
//
// The JSON Schema file is published to contributors: the pull request
// template asks them to tick "My records validate against
// schema/record.schema.json", and README.md, docs/records.md and the
// resources page all link to it. Nothing loads it at runtime, though --
// CI validates through scripts/validate-pr.mjs -> lib/schema.js -- so
// the two drifted apart with nothing to notice. A record could satisfy
// the published schema and still be rejected by the check that actually
// runs, which makes the checkbox a lie.
//
// This walks the constraints the mirror declares and asserts lib/schema.js
// reaches the same verdict on each case. It is not a JSON Schema
// implementation (the repo has no validator dependency and does not need
// one) -- it covers the keywords the mirror actually uses for the fields
// that drifted.

const mirror = JSON.parse(
  await readFile(new URL('../schema/record.schema.json', import.meta.url), 'utf8'),
);

function mirrorAcceptsName(name) {
  const s = mirror.properties.name;
  if (typeof name !== 'string') return false;
  if (name.length < s.minLength || name.length > s.maxLength) return false;
  if (!new RegExp(s.pattern).test(name)) return false;
  return !new RegExp(s.not.pattern).test(name);
}

test('the JSON Schema mirror and lib/schema.js agree on names', () => {
  // Each of these was accepted by the mirror and rejected by validateName
  // before the mirror grew minLength/maxLength/not.
  const names = [
    ['lucas', true],
    ['my-name', true],
    ['ab', true],
    ['a', false], // minLength: validateName requires 2
    ['1', false],
    ['xn--abc', false], // punycode prefix
    ['ab--cd', false], // `--` in the 3rd and 4th position
    ['zz--hi', false],
    ['a'.repeat(32), true],
    ['a'.repeat(33), false], // maxLength
    ['-lead', false],
    ['trail-', false],
    ['UPPER', false],
  ];

  for (const [name, expected] of names) {
    assert.equal(
      mirrorAcceptsName(name),
      expected,
      `schema/record.schema.json disagrees on ${JSON.stringify(name)}`,
    );
    assert.equal(
      validateRecord({ ...valid, name }).ok,
      expected,
      `lib/schema.js disagrees on ${JSON.stringify(name)}`,
    );
  }
});

test('the JSON Schema mirror and lib/schema.js agree on unknown owner keys', () => {
  assert.equal(mirror.properties.owner.additionalProperties, false);
  const out = validateRecord({ ...valid, owner: { github: 'zordhalo', email: 'a@b.com' } });
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes('unknown key: owner.email'));
});

test('a well-formed owner is still accepted', () => {
  assert.equal(validateRecord({ ...valid, owner: { github: 'zordhalo' } }).ok, true);
});

// A vc-domain-verify TXT gets mirrored to the apex, where it load-bears
// verification for the name. A truncated one is otherwise invisible:
// schema-valid, published to DNS, and silently never verifying.
test('rejects a truncated Vercel verification token', () => {
  const out = validateRecord({
    name: 'krishna', owner: { github: 'k' }, claimedAt: '2026-01-01T00:00:00Z',
    records: {},
    subdomains: { _vercel: { TXT: ['vc-domain-verify=krishna.runs-on.dev,70f2fede6bc7dc6f0...'] } },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('truncated Vercel verification token')));
});

test('rejects a placeholder token pasted from the docs', () => {
  const out = validateRecord({
    name: 'you', owner: { github: 'y' }, claimedAt: '2026-01-01T00:00:00Z',
    records: {},
    subdomains: { _vercel: { TXT: ['vc-domain-verify=you.runs-on.dev,PASTE-YOUR-TOKEN'] } },
  });
  assert.equal(out.ok, false);
});

test('accepts a real verification token', () => {
  const out = validateRecord({
    name: 'hussain', owner: { github: 'h' }, claimedAt: '2026-01-01T00:00:00Z',
    records: {},
    subdomains: { _vercel: { TXT: ['vc-domain-verify=hussain.runs-on.dev,696f1780aaddd44898ab'] } },
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('the guard only applies to vc-domain-verify values', () => {
  // Every other TXT string stays unconstrained beyond the length limit.
  const out = validateRecord({
    name: 'lucas', owner: { github: 'x' }, claimedAt: '2026-01-01T00:00:00Z',
    records: { TXT: ['anything at all, with commas, dots... and UPPERCASE'] },
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('the guard applies at the root too, not only under subdomains', () => {
  const out = validateRecord({
    name: 'lucas', owner: { github: 'x' }, claimedAt: '2026-01-01T00:00:00Z',
    records: { TXT: ['vc-domain-verify=lucas.runs-on.dev,nothex...'] },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('truncated Vercel verification token')));
});

test('the JSON Schema mirror declares profile with the same field set', () => {
  // Same drift-prevention contract as the name/owner mirrors above: the
  // published schema is linked from the PR template, so it must not promise
  // a shape the runtime validator rejects, or vice versa. `profile` is
  // declared as a $ref into $defs, like `records` is.
  const declared = mirror.properties.profile;
  assert.equal(declared.$ref, '#/$defs/profile');
  const def = mirror.$defs.profile;
  assert.deepEqual(Object.keys(def.properties).sort(), ['bio', 'links', 'name']);
  assert.equal(def.additionalProperties, false);
});
