import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChangeset, parseRecordFile, RecordParseError } from '../lib/pr.js';

const owned = {
  name: 'lucas',
  owner: { github: 'zordhalo' },
  claimedAt: '2026-08-30T19:12:04Z',
  records: { CNAME: 'lucas.vercel.app' },
};

const base = { ...owned, records: {} };

const readers = (head, baseRec = base) => ({
  readFile: async () => head,
  readBase: async () => baseRec,
});

test('accepts an owner pointing their own name', async () => {
  const out = await validateChangeset({
    files: [{ filename: 'domains/lucas.json', status: 'modified' }],
    prAuthor: 'zordhalo',
    ...readers(owned),
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('rejects editing someone else\'s name', async () => {
  const out = await validateChangeset({
    files: [{ filename: 'domains/lucas.json', status: 'modified' }],
    prAuthor: 'attacker',
    ...readers(owned),
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('owner')));
});

test('rejects changing the owner field', async () => {
  const hijack = { ...owned, owner: { github: 'attacker' } };
  const out = await validateChangeset({
    files: [{ filename: 'domains/lucas.json', status: 'modified' }],
    prAuthor: 'attacker',
    ...readers(hijack),
  });
  assert.equal(out.ok, false);
});

test('rejects touching more than one file', async () => {
  const out = await validateChangeset({
    files: [
      { filename: 'domains/lucas.json', status: 'modified' },
      { filename: 'domains/other.json', status: 'modified' },
    ],
    prAuthor: 'zordhalo',
    ...readers(owned),
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('one file')));
});

test('rejects files outside domains/', async () => {
  const out = await validateChangeset({
    files: [{ filename: '.github/workflows/validate.yml', status: 'modified' }],
    prAuthor: 'zordhalo',
    ...readers(owned),
  });
  assert.equal(out.ok, false);
});

test('rejects a filename that does not match the record name', async () => {
  const out = await validateChangeset({
    files: [{ filename: 'domains/other.json', status: 'modified' }],
    prAuthor: 'zordhalo',
    ...readers(owned),
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('filename')));
});

test('rejects a schema violation', async () => {
  const bad = { ...owned, records: { CNAME: 'x', A: ['1.2.3.4'] } };
  const out = await validateChangeset({
    files: [{ filename: 'domains/lucas.json', status: 'modified' }],
    prAuthor: 'zordhalo',
    ...readers(bad),
  });
  assert.equal(out.ok, false);
});

test('rejects a new file claiming a reserved name', async () => {
  const reserved = { ...owned, name: 'api' };
  const out = await validateChangeset({
    files: [{ filename: 'domains/api.json', status: 'added' }],
    prAuthor: 'zordhalo',
    readFile: async () => reserved,
    readBase: async () => null,
    getUser: async () => ({ created_at: '2020-01-01T00:00:00Z', public_repos: 3 }),
    countOwnedNames: async () => 0,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('reserved')));
});

test('rejects a renamed file', async () => {
  const out = await validateChangeset({
    files: [{ filename: 'domains/attacker.json', status: 'renamed', previous_filename: 'domains/lucas.json' }],
    prAuthor: 'attacker',
    readFile: async () => ({ ...owned, name: 'attacker', owner: { github: 'attacker' } }),
    readBase: async () => null,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('renam')));
});

// --- claiming a new name by pull request -------------------------------------
//
// This path is a second front door onto the same registry as /api/claim, so
// each test below pins one of the gates evaluateClaim applies. If any of them
// starts passing, opening a pull request has become the way around that gate.

const ELIGIBLE = { created_at: '2020-01-01T00:00:00Z', public_repos: 3 };
const NOW = new Date('2026-09-01T12:00:00Z');

const claim = (over = {}) => ({
  files: [{ filename: 'domains/newname.json', status: 'added' }],
  prAuthor: 'zordhalo',
  readFile: async () => ({
    name: 'newname',
    owner: { github: 'zordhalo' },
    claimedAt: '2026-09-01T11:00:00Z',
    records: {},
  }),
  readBase: async () => null,
  getUser: async () => ELIGIBLE,
  countOwnedNames: async () => 0,
  now: NOW,
  ...over,
});

test('accepts a new name claimed by pull request', async () => {
  const out = await validateChangeset(claim());
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('accepts a claim that sets records up front', async () => {
  const out = await validateChangeset(claim({
    readFile: async () => ({
      name: 'newname',
      owner: { github: 'zordhalo' },
      claimedAt: '2026-09-01T11:00:00Z',
      records: { CNAME: 'cname.vercel-dns.com' },
    }),
  }));
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('rejects a claim naming someone else as owner', async () => {
  const out = await validateChangeset(claim({
    readFile: async () => ({
      name: 'newname',
      owner: { github: 'someone-else' },
      claimedAt: '2026-09-01T11:00:00Z',
      records: {},
    }),
  }));
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('its own author')));
});

test('matches the owner case-insensitively', async () => {
  const out = await validateChangeset(claim({
    prAuthor: 'ZordHalo',
    readFile: async () => ({
      name: 'newname',
      owner: { github: 'zordhalo' },
      claimedAt: '2026-09-01T11:00:00Z',
      records: {},
    }),
  }));
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('rejects a claim on an account younger than 30 days', async () => {
  const out = await validateChangeset(claim({
    getUser: async () => ({ created_at: '2026-08-25T00:00:00Z', public_repos: 3 }),
  }));
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('30 days')));
});

test('rejects a claim from an account with no public repositories', async () => {
  const out = await validateChangeset(claim({
    getUser: async () => ({ created_at: '2020-01-01T00:00:00Z', public_repos: 0 }),
  }));
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('public repositor')));
});

test('rejects a second name for an account that already owns one', async () => {
  const out = await validateChangeset(claim({ countOwnedNames: async () => 1 }));
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('one name per account')));
});

test('rejects a claim with a future claimedAt', async () => {
  const out = await validateChangeset(claim({
    readFile: async () => ({
      name: 'newname',
      owner: { github: 'zordhalo' },
      claimedAt: '2027-01-01T00:00:00Z',
      records: {},
    }),
  }));
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('future')));
});

test('fails closed when eligibility cannot be checked', async () => {
  const out = await validateChangeset(claim({
    getUser: async () => { throw new Error('rate limited'); },
  }));
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('could not check account eligibility')));
});

test('fails closed when the owned-name count cannot be checked', async () => {
  const out = await validateChangeset(claim({
    countOwnedNames: async () => { throw new Error('rate limited'); },
  }));
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('how many names')));
});

test('fails closed when the owned-name count is not a number', async () => {
  const out = await validateChangeset(claim({ countOwnedNames: async () => undefined }));
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('how many names')));
});

test('allows an owner to remove their own record', async () => {
  const out = await validateChangeset({
    files: [{ filename: 'domains/lucas.json', status: 'removed' }],
    prAuthor: 'zordhalo',
    readFile: async () => null,
    readBase: async () => base,
  });
  assert.deepEqual(out, { ok: true, errors: [] });
});

test('rejects a non-owner removing a record', async () => {
  const out = await validateChangeset({
    files: [{ filename: 'domains/lucas.json', status: 'removed' }],
    prAuthor: 'attacker',
    readFile: async () => null,
    readBase: async () => base,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes('owner')));
});

test('rejects a rename even when only previous_filename is set', async () => {
  const out = await validateChangeset({
    files: [{ filename: 'domains/attacker.json', status: 'modified', previous_filename: 'domains/lucas.json' }],
    prAuthor: 'attacker',
    readFile: async () => ({ ...owned, name: 'attacker', owner: { github: 'attacker' } }),
    readBase: async () => null,
  });
  assert.equal(out.ok, false);
});

// Hand-edited record files are the documented way to change a record, so a
// malformed one is a routine contributor mistake. It must arrive as a finding
// the contributor can read, not as a crash that replaces the findings.
test('parseRecordFile returns the record for valid JSON', () => {
  assert.deepEqual(parseRecordFile('domains/lucas.json', '{"name":"lucas"}'), { name: 'lucas' });
});

test('parseRecordFile names the file and the parse problem', () => {
  const bad = '{\n  "records": {}\n}\n}\n';
  assert.throws(
    () => parseRecordFile('domains/rudrakeshwani.json', bad),
    (err) => {
      assert.ok(err instanceof RecordParseError);
      assert.match(err.message, /domains\/rudrakeshwani\.json is not valid JSON/);
      return true;
    },
  );
});

test('a RecordParseError is distinguishable from any other failure', () => {
  // The script rethrows anything that is not one of these, so an unexpected
  // fault still fails loudly with its stack instead of being reported as a
  // contributor mistake.
  assert.equal(new RecordParseError('p', new Error('x')) instanceof RecordParseError, true);
  assert.equal(new TypeError('boom') instanceof RecordParseError, false);
});
