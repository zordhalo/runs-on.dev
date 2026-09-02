import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecord, putRecord, putRecordUpdate } from '../lib/registry.js';

const record = {
  name: 'lucas',
  owner: { github: 'zordhalo' },
  claimedAt: '2026-08-30T19:12:04Z',
  records: {},
};

function stubFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    return { ok: next.status < 400, status: next.status, json: async () => next.body ?? {} };
  };
  impl.calls = calls;
  return impl;
}

test('getRecord returns null for a 404', async () => {
  const fetchImpl = stubFetch([{ status: 404 }]);
  assert.equal(await getRecord('nobody', { fetchImpl }), null);
});

test('getRecord decodes base64 content', async () => {
  const content = Buffer.from(JSON.stringify(record)).toString('base64');
  const fetchImpl = stubFetch([{ status: 200, body: { content, encoding: 'base64' } }]);
  assert.deepEqual(await getRecord('lucas', { fetchImpl }), record);
});

test('putRecord refuses to overwrite an existing name', async () => {
  const content = Buffer.from(JSON.stringify(record)).toString('base64');
  const fetchImpl = stubFetch([{ status: 200, body: { content, encoding: 'base64' } }]);
  assert.deepEqual(await putRecord(record, { token: 't', fetchImpl }), { ok: false, reason: 'exists' });
});

test('putRecord reports ratelimited on a 403', async () => {
  const fetchImpl = stubFetch([{ status: 404 }, { status: 403 }]);
  assert.deepEqual(await putRecord(record, { token: 't', fetchImpl }), { ok: false, reason: 'ratelimited' });
});

test('putRecord writes with a bearer token', async () => {
  const fetchImpl = stubFetch([{ status: 404 }, { status: 201 }]);
  assert.deepEqual(await putRecord(record, { token: 'secret-token', fetchImpl }), {
    ok: true,
    commit: null,
  });
  const write = fetchImpl.calls[1];
  assert.equal(write.init.method, 'PUT');
  assert.match(write.init.headers.Authorization, /^Bearer /);
});

test('putRecord surfaces the commit sha of the write', async () => {
  const fetchImpl = stubFetch([
    { status: 404 },
    { status: 201, body: { commit: { sha: 'a1b2c3d4e5f6' } } },
  ]);
  assert.deepEqual(await putRecord(record, { token: 't', fetchImpl }), {
    ok: true,
    commit: 'a1b2c3d4e5f6',
  });
});

test('putRecord still succeeds when the write response body is unreadable', async () => {
  // The commit landed; a body we cannot parse is a cosmetic loss, not a
  // failed claim.
  const fetchImpl = async () => ({
    ok: true,
    status: 201,
    json: async () => {
      throw new Error('unparseable');
    },
  });
  const first = stubFetch([{ status: 404 }]);
  let call = 0;
  const combined = async (url, init) => (call++ === 0 ? first(url, init) : fetchImpl());
  assert.deepEqual(await putRecord(record, { token: 't', fetchImpl: combined }), {
    ok: true,
    commit: null,
  });
});

test('putRecord rejects a record failing schema validation before any network call', async () => {
  const fetchImpl = stubFetch([]);
  const out = await putRecord({ ...record, name: 'BAD' }, { token: 't', fetchImpl });
  assert.deepEqual(out, { ok: false, reason: 'error' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('putRecord reports ratelimited when the existence check is rate limited', async () => {
  const fetchImpl = stubFetch([{ status: 403 }]);
  assert.deepEqual(await putRecord(record, { token: 't', fetchImpl }), { ok: false, reason: 'ratelimited' });
});

test('putRecord reports error when the existence check fails otherwise', async () => {
  const fetchImpl = stubFetch([{ status: 500 }]);
  assert.deepEqual(await putRecord(record, { token: 't', fetchImpl }), { ok: false, reason: 'error' });
});

test('putRecordUpdate sends the sha so a moved record is not clobbered', async () => {
  const fetchImpl = stubFetch([{ status: 200, body: { commit: { sha: 'abc123' } } }]);
  const out = await putRecordUpdate(record, { token: 't', sha: 'base-sha', editor: 'zordhalo', fetchImpl });
  assert.deepEqual(out, { ok: true, commit: 'abc123' });

  const [write] = fetchImpl.calls;
  assert.equal(write.init.method, 'PUT');
  const body = JSON.parse(write.init.body);
  assert.equal(body.sha, 'base-sha');
  assert.equal(body.message, 'records: lucas by @zordhalo');
});

test('putRecordUpdate reports stale when the sha no longer matches', async () => {
  const fetchImpl = stubFetch([{ status: 409 }]);
  assert.deepEqual(
    await putRecordUpdate(record, { token: 't', sha: 'old', fetchImpl }),
    { ok: false, reason: 'stale' },
  );
});

test('putRecordUpdate treats a 422 as stale too', async () => {
  const fetchImpl = stubFetch([{ status: 422 }]);
  assert.equal((await putRecordUpdate(record, { token: 't', sha: 'old', fetchImpl })).reason, 'stale');
});

test('putRecordUpdate refuses to write without a sha', async () => {
  // No stubbed response: reaching the network here would throw, which is the
  // point -- a missing sha must be caught before it can become a blind write.
  const fetchImpl = stubFetch([]);
  assert.deepEqual(await putRecordUpdate(record, { token: 't', fetchImpl }), { ok: false, reason: 'error' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('putRecordUpdate rejects a record failing schema validation before any network call', async () => {
  const fetchImpl = stubFetch([]);
  const bad = { ...record, records: { CNAME: 'not a hostname' } };
  assert.deepEqual(await putRecordUpdate(bad, { token: 't', sha: 's', fetchImpl }), { ok: false, reason: 'error' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('putRecordUpdate reports ratelimited on a 429', async () => {
  const fetchImpl = stubFetch([{ status: 429 }]);
  assert.equal((await putRecordUpdate(record, { token: 't', sha: 's', fetchImpl })).reason, 'ratelimited');
});
