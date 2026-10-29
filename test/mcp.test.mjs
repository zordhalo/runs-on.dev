// The MCP server's JSON-RPC dispatch, tested without network: handleRpc is
// pure modulo the injected getRecord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRpc, handleBatch, mcpManifest, filesToEntries, PROTOCOL_VERSION } from '../lib/mcp.js';

const fakeRecord = { name: 'shovith', owner: { github: 'Hawkay002' }, records: {} };
const deps = { getRecord: (name) => (name === 'shovith' ? fakeRecord : null) };

test('initialize returns the protocol version, capabilities, and server info', async () => {
  const out = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(out.jsonrpc, '2.0');
  assert.equal(out.id, 1);
  assert.equal(out.result.protocolVersion, PROTOCOL_VERSION);
  assert.ok(out.result.capabilities.tools);
  assert.equal(out.result.serverInfo.name, 'runs-on.dev');
});

const ALL_TOOLS = ['check_name', 'deploy_site', 'get_record', 'list_deployments', 'rollback_site', 'update_records', 'whoami'];

test('tools/list exposes every tool with a typed input schema', async () => {
  const out = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = out.result.tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ALL_TOOLS);
  for (const tool of tools) {
    assert.ok(tool.description.length > 20, `${tool.name} needs a real description`);
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.annotations, `${tool.name} needs annotations so clients know what writes`);
  }
});

test('tools/call check_name reports availability and grammar codes', async () => {
  const free = await handleRpc(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_name', arguments: { name: 'some-open-name' } } },
    deps,
  );
  assert.ok(free.result.content[0].text.includes('"available": true'));
  assert.ok(!free.result.isError);

  const taken = await handleRpc(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'check_name', arguments: { name: 'shovith' } } },
    deps,
  );
  assert.ok(taken.result.content[0].text.includes('"code": "taken"'));

  const invalid = await handleRpc(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'check_name', arguments: { name: 'x' } } },
    deps,
  );
  assert.ok(invalid.result.content[0].text.includes('invalid_length'));
});

test('tools/call get_record returns the record, or an honest miss', async () => {
  const hit = await handleRpc(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_record', arguments: { name: 'shovith' } } },
    deps,
  );
  assert.ok(hit.result.content[0].text.includes('Hawkay002'));
  assert.ok(!hit.result.isError);

  const miss = await handleRpc(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_record', arguments: { name: 'ghost' } } },
    deps,
  );
  assert.equal(miss.result.isError, true);
  assert.ok(miss.result.content[0].text.includes('not claimed'));
});

test('unknown tools and methods answer JSON-RPC errors', async () => {
  const badTool = await handleRpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(badTool.error.code, -32602);
  const badMethod = await handleRpc({ jsonrpc: '2.0', id: 9, method: 'resources/list' });
  assert.equal(badMethod.error.code, -32601);
});

test('the JSON manifest mirrors the live server facts', () => {
  const m = mcpManifest();
  assert.equal(m.name, 'runs-on.dev');
  assert.equal(m.protocolVersion, PROTOCOL_VERSION);
  assert.equal(m.transport, 'streamable-http (POST JSON-RPC 2.0)');
  assert.deepEqual(m.tools.map((x) => x.name).sort(), ALL_TOOLS);
});

// The owner tools, with every registry-touching dep faked. `calls` records
// what reached the shared actions, which is the thing worth asserting: a
// refused call must never get that far.
function ownerDeps({ scope = 'manage', account } = {}) {
  const calls = [];
  return {
    calls,
    getRecord: () => null,
    account: () => account ?? { login: 'Hawkay002', scope },
    resolveName: (acct, name) => (name && name !== 'shovith'
      ? { status: 403, body: { error: 'not_your_name' } }
      : { name: 'shovith' }),
    ownedNames: () => ['shovith'],
    editRecord: (login, body) => { calls.push(['edit', login, body]); return { status: 200, body: { updated: body.name } }; },
    publishSite: (ctx, entries) => { calls.push(['publish', ctx, entries]); return { status: 200, body: { url: 'https://shovith.runs-on.dev/' } }; },
    listDeployments: (ctx) => { calls.push(['list', ctx]); return { status: 200, body: { active: null, deployments: [] } }; },
    rollbackSite: (ctx, id) => { calls.push(['rollback', ctx, id]); return { status: 404, body: { error: 'unknown_deployment' } }; },
  };
}

const call = (name, args, deps) => handleRpc(
  { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  deps,
);

test('owner tools without a token answer auth_required with a hint, and do nothing', async () => {
  const deps = ownerDeps({ account: { status: 401, body: { error: 'auth_required' } } });
  for (const tool of ['whoami', 'update_records', 'list_deployments']) {
    const out = await call(tool, { records: {} }, deps);
    assert.equal(out.result.isError, true);
    assert.ok(out.result.content[0].text.includes('auth_required'));
    assert.ok(out.result.content[0].text.includes('/manage'));
  }
  // No deps at all (the public-only test harness) behaves the same.
  assert.equal((await call('whoami', {}, {})).result.isError, true);
  assert.deepEqual(deps.calls, []);
});

test('update_records needs a manage-scoped token; a sites token is refused', async () => {
  const deps = ownerDeps({ scope: 'sites' });
  const out = await call('update_records', { records: { CNAME: 'example.github.io' } }, deps);
  assert.equal(out.result.isError, true);
  assert.ok(out.result.content[0].text.includes('insufficient_scope'));
  assert.deepEqual(deps.calls, []);

  // ...but a sites token still deploys and lists.
  assert.ok(!(await call('list_deployments', {}, deps)).result.isError);
});

test('update_records forwards only the fields sent, under the resolved name', async () => {
  const deps = ownerDeps();
  const out = await call('update_records', { records: { CNAME: 'example.github.io' }, profile: null }, deps);
  assert.ok(!out.result.isError);
  assert.deepEqual(deps.calls, [['edit', 'Hawkay002', { name: 'shovith', records: { CNAME: 'example.github.io' }, profile: null }]]);
});

test('a name the token does not own is refused before any action', async () => {
  const deps = ownerDeps();
  const out = await call('update_records', { name: 'someone-else', records: {} }, deps);
  assert.equal(out.result.isError, true);
  assert.ok(out.result.content[0].text.includes('not_your_name'));
  assert.deepEqual(deps.calls, []);
});

test('whoami reports login, scope, and names', async () => {
  const out = await call('whoami', {}, ownerDeps());
  assert.deepEqual(JSON.parse(out.result.content[0].text), { login: 'Hawkay002', scope: 'manage', names: ['shovith'] });
});

test('deploy_site decodes files and rejects bad file lists before authenticating', async () => {
  const deps = ownerDeps();
  const ok = await call('deploy_site', {
    files: [
      { path: 'index.html', content: '<h1>hi</h1>' },
      { path: 'a/b.bin', content: Buffer.from([1, 2, 3]).toString('base64'), encoding: 'base64' },
    ],
  }, deps);
  assert.ok(!ok.result.isError);
  const [, ctx, entries] = deps.calls[0];
  assert.deepEqual(ctx, { login: 'Hawkay002', name: 'shovith' });
  assert.equal(entries[0].data.toString(), '<h1>hi</h1>');
  assert.deepEqual([...entries[1].data], [1, 2, 3]);

  const noAuth = ownerDeps({ account: { status: 401, body: { error: 'auth_required' } } });
  const bad = await call('deploy_site', { files: [{ path: 'about.html', content: 'x' }] }, noAuth);
  assert.ok(bad.result.content[0].text.includes('index.html is required'));
});

test('filesToEntries holds MCP uploads to the zip path rules', () => {
  const html = { path: 'index.html', content: 'x' };
  for (const path of ['../etc/passwd', '/abs.html', 'a//b', 'a\\b', 'C:/x']) {
    assert.equal(filesToEntries([html, { path, content: 'x' }]).ok, false, path);
  }
  assert.equal(filesToEntries([html, html]).ok, false);
  assert.equal(filesToEntries([{ ...html, encoding: 'hex' }]).ok, false);
  assert.equal(filesToEntries([]).ok, false);
  assert.equal(filesToEntries('index.html').ok, false);
});

test('action failures come back as isError results carrying the code', async () => {
  const out = await call('rollback_site', { deploymentId: 'deadbeef' }, ownerDeps());
  assert.equal(out.result.isError, true);
  assert.ok(out.result.content[0].text.includes('unknown_deployment'));
});

test('batches answer each request and skip notifications', async () => {
  const replies = await handleBatch([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'initialize' },
  ]);
  assert.equal(replies.length, 2);
  assert.ok(replies[0].result.tools);
  assert.equal(replies[1].error.code, -32600);
});

test('owner tools report auth failures to the HTTP layer; public tools never do', async () => {
  const seen = [];
  const noToken = { ...ownerDeps({ account: { status: 401, body: { error: 'auth_required' } } }), onAuthFailure: (f) => seen.push(f) };
  await call('check_name', { name: 'some-open-name' }, noToken);
  assert.deepEqual(seen, []);
  await call('whoami', {}, noToken);
  assert.deepEqual(seen, [{ status: 401, error: 'auth_required' }]);

  const narrow = { ...ownerDeps({ scope: 'sites' }), onAuthFailure: (f) => seen.push(f) };
  await call('update_records', { records: {} }, narrow);
  assert.equal(seen[1].status, 403);
  assert.equal(seen[1].error, 'insufficient_scope');
  assert.match(seen[1].scope, /records:write/);
});
