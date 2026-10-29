// Minimal Model Context Protocol server over Streamable HTTP (JSON-RPC 2.0,
// POST at /.well-known/mcp, no SSE stream: the transport answers every
// request with a single JSON response). Stateless by design: no session,
// no stored client state.
//
// Two tiers of tools. check_name and get_record read public registry data
// and need nothing. The rest act on the caller's own name and need a rod1
// bearer token on the request (minted at /manage): site tools take any
// token, update_records takes only a 'manage'-scoped one.
//
// Deps are injectable so the tests can run without network. handleRpc(body,
// deps) uses:
//   getRecord(name)               -> record | null (may throw)
//   account()                     -> { login, scope } | { status, body }
//   resolveName(account, name?)   -> { name } | { status, body }
//   ownedNames(login)             -> string[] (may throw)
//   editRecord(login, body), publishSite(ctx, entries),
//   listDeployments(ctx), rollbackSite(ctx, id) -> { status, body }

import { validateName } from './name.js';
import { isReserved } from './blocklist.js';
import { isSafeEntryName, MAX_ENTRIES } from './zip.js';
import { MANAGE_TOKEN_SCOPE } from './tokens.js';

export const PROTOCOL_VERSION = '2025-03-26';
export const SERVER_INFO = { name: 'runs-on.dev', version: '1.0.0' };

const NAME_ARG = {
  type: 'string',
  description: 'Your claimed name, without the .runs-on.dev suffix. Optional while an account holds one name.',
};

const TOOLS = [
  {
    name: 'check_name',
    annotations: { readOnlyHint: true },
    description:
      'Check whether a runs-on.dev subdomain name is available to claim. Returns { available: true } or why it is not (taken, reserved, or an invalid_* grammar code). Free, no auth.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name to check, without the .runs-on.dev suffix. 2-32 chars, lowercase letters, numbers, hyphens, no leading/trailing hyphen.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_record',
    annotations: { readOnlyHint: true },
    description:
      'Fetch a claimed name\'s public registry record (owner, claimedAt, DNS records, subdomains, profile overrides) as JSON. Returns an isError result for names that are not claimed. Free, no auth.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The claimed name, without the .runs-on.dev suffix.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'whoami',
    annotations: { readOnlyHint: true },
    description:
      'Which GitHub login the bearer token belongs to, its scope (sites or manage), and the runs-on.dev names it owns. Call this first to orient. Needs a token.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_records',
    annotations: { destructiveHint: true, idempotentHint: true },
    description:
      'Change the DNS and profile card of a name you own. Send only the fields to replace. records (the apex): { CNAME: "host" } alone, or { URL: "https://..." } alone (a redirect), or any of { A: ["ip"], TXT: ["string"], MX: [{ priority, value: "host" }] }; {} puts the name back on its profile card. subdomains: { "<label>": { CNAME | A | TXT | MX } }, null removes them all. profile: { name?, bio?, links?: [{ label, url }] }, null removes it. Same validation as the /manage editor and pull-request CI; DNS syncs within minutes. Read the current record with get_record first. Needs a manage-scoped token.',
    inputSchema: {
      type: 'object',
      properties: {
        name: NAME_ARG,
        records: { type: 'object', description: 'Apex DNS records, replacing the current set.' },
        subdomains: { type: ['object', 'null'], description: 'Subdomain records keyed by label, replacing the current set. null removes all.' },
        profile: { type: ['object', 'null'], description: 'Profile card overrides. null removes them.' },
      },
    },
  },
  {
    name: 'deploy_site',
    annotations: { destructiveHint: false },
    description:
      `Publish a static site to https://<name>.runs-on.dev/ from a list of files. index.html is required at the root. Paths are plain relative (no leading /, no ..). Text files go as utf8, binaries as base64. At most ${MAX_ENTRIES} files; keep the request under ~4 MB (use the zip upload at POST /api/sites/deploy for bigger sites). The last 5 deployments are kept for rollback. Needs a token.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: NAME_ARG,
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'e.g. index.html, assets/app.css' },
              content: { type: 'string' },
              encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Default utf8.' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'list_deployments',
    annotations: { readOnlyHint: true },
    description: 'List the hosted site\'s deployments (newest last) and which one is live. Needs a token.',
    inputSchema: { type: 'object', properties: { name: NAME_ARG } },
  },
  {
    name: 'rollback_site',
    annotations: { destructiveHint: false, idempotentHint: true },
    description: 'Instantly re-point the live site at an earlier deployment still in history (ids from list_deployments). No re-upload. Needs a token.',
    inputSchema: {
      type: 'object',
      properties: {
        name: NAME_ARG,
        deploymentId: { type: 'string', description: '8 hex characters.' },
      },
      required: ['deploymentId'],
    },
  },
];

const AUTH_HINT =
  'Mint a token at https://runs-on.dev/manage (choose the "manage" scope to also edit DNS) and send it as an Authorization: Bearer rod1... header on every request to this server.';

const envelope = (id, patch) => ({ jsonrpc: '2.0', id, ...patch });

function textResult(text, isError = false) {
  const out = { content: [{ type: 'text', text }] };
  if (isError) out.isError = true;
  return out;
}

// An HTTP-shaped { status, body } from the shared actions, as a tool result.
function actionResult(out) {
  return textResult(JSON.stringify(out.body, null, 2), out.status >= 400);
}

// The MCP form of the zip: [{ path, content, encoding }] -> the same
// [{ name, data }] entries lib/zip.js produces, under the same path rules.
export function filesToEntries(files) {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, reason: 'files must be a non-empty array' };
  if (files.length > MAX_ENTRIES) return { ok: false, reason: `at most ${MAX_ENTRIES} files` };
  const entries = [];
  const seen = new Set();
  for (const f of files) {
    if (!f || typeof f.content !== 'string' || !isSafeEntryName(f.path)) {
      return { ok: false, reason: `invalid file: ${JSON.stringify(f?.path ?? null)} (need a plain relative path and string content)` };
    }
    if (seen.has(f.path)) return { ok: false, reason: `duplicate path: ${f.path}` };
    seen.add(f.path);
    const encoding = f.encoding ?? 'utf8';
    if (encoding !== 'utf8' && encoding !== 'base64') return { ok: false, reason: `unknown encoding for ${f.path}` };
    entries.push({ name: f.path, data: Buffer.from(f.content, encoding) });
  }
  if (!seen.has('index.html')) return { ok: false, reason: 'index.html is required at the root' };
  return { ok: true, entries };
}

// Token, then (optionally) scope, then the name. Returns { account, name }
// to act with, or { result } to answer with as-is.
async function authorizeTool(deps, args, { needScope } = {}) {
  const account = deps.account ? await deps.account() : { status: 401, body: { error: 'auth_required' } };
  if (account.status) {
    return { result: textResult(JSON.stringify({ ...account.body, hint: AUTH_HINT }, null, 2), true) };
  }
  if (needScope && account.scope !== needScope) {
    return {
      result: textResult(JSON.stringify({ error: 'insufficient_scope', scope: account.scope, need: needScope, hint: AUTH_HINT }, null, 2), true),
    };
  }
  const resolved = await deps.resolveName(account, args.name);
  if (resolved.status) return { result: actionResult(resolved) };
  return { account, name: resolved.name };
}

async function callAuthedTool(tool, args, deps) {
  if (tool === 'whoami') {
    const account = deps.account ? await deps.account() : { status: 401, body: { error: 'auth_required' } };
    if (account.status) return textResult(JSON.stringify({ ...account.body, hint: AUTH_HINT }, null, 2), true);
    let names;
    try {
      names = await deps.ownedNames(account.login);
    } catch {
      return textResult(JSON.stringify({ error: 'busy' }, null, 2), true);
    }
    return textResult(JSON.stringify({ login: account.login, scope: account.scope, names }, null, 2));
  }

  if (tool === 'deploy_site') {
    // Check the files before spending a registry read on the name.
    const decoded = filesToEntries(args.files);
    if (!decoded.ok) return textResult(JSON.stringify({ error: 'invalid_files', reason: decoded.reason }, null, 2), true);
    const auth = await authorizeTool(deps, args);
    if (auth.result) return auth.result;
    return actionResult(await deps.publishSite({ login: auth.account.login, name: auth.name }, decoded.entries));
  }

  const auth = await authorizeTool(deps, args, {
    needScope: tool === 'update_records' ? MANAGE_TOKEN_SCOPE : undefined,
  });
  if (auth.result) return auth.result;
  const ctx = { login: auth.account.login, name: auth.name };

  if (tool === 'update_records') {
    const body = { name: auth.name };
    for (const key of ['records', 'subdomains', 'profile']) if (key in args) body[key] = args[key];
    return actionResult(await deps.editRecord(ctx.login, body));
  }
  if (tool === 'list_deployments') return actionResult(await deps.listDeployments(ctx));
  return actionResult(await deps.rollbackSite(ctx, args.deploymentId));
}

const AUTHED_TOOLS = new Set(['whoami', 'update_records', 'deploy_site', 'list_deployments', 'rollback_site']);

async function checkName(name, deps) {
  if (typeof name !== 'string') return textResult('invalid params: name must be a string', true);
  const grammar = validateName(name);
  if (!grammar.ok) {
    return textResult(JSON.stringify({ name, available: false, code: `invalid_${grammar.reason}` }, null, 2));
  }
  if (isReserved(name).reserved) {
    return textResult(JSON.stringify({ name, available: false, code: 'reserved' }, null, 2));
  }
  let existing = null;
  let readFailed = false;
  try {
    existing = await deps.getRecord(name);
  } catch {
    // A failed registry read must not read as "available": a taken name
    // during an outage would hand agents a false go-ahead.
    readFailed = true;
  }
  if (readFailed) {
    return textResult(
      JSON.stringify({ name, available: false, code: 'check_failed' }, null, 2),
      true,
    );
  }
  return textResult(
    JSON.stringify(
      existing
        ? { name, available: false, code: 'taken', owner: existing.owner?.github ?? null }
        : { name, available: true },
      null,
      2,
    ),
  );
}

async function getRecordTool(name, deps) {
  if (typeof name !== 'string') return textResult('invalid params: name must be a string', true);
  if (!validateName(name).ok) return textResult(`no record for "${name}": not a valid name`, true);
  let record = null;
  try {
    record = await deps.getRecord(name);
  } catch {
    record = null;
  }
  if (!record) return textResult(`no record for "${name}": not claimed (or unavailable right now)`, true);
  return textResult(JSON.stringify(record, null, 2));
}

// A plain-JSON manifest for GET probes with Accept: application/json (not
// part of the MCP wire protocol): agents and auditors hitting the endpoint
// in a browser or curl get the server facts without speaking JSON-RPC.
export function mcpManifest() {
  return {
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: 'mcp',
    protocolVersion: PROTOCOL_VERSION,
    transport: 'streamable-http (POST JSON-RPC 2.0)',
    capabilities: { tools: {} },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    spec: 'https://runs-on.dev/openapi.json',
  };
}

// JSON-RPC 2.0 dispatch. Returns the response envelope for requests; the
// route handles notifications (no id) with a bare 202 before calling in.
// The injected read is aliased getRecordDep: it must not shadow the module
// wrapper below, or tools/call would return raw records without the MCP
// content envelope (a bug the route tests caught).
export async function handleRpc(body, deps = {}) {
  const getRecordDep = deps.getRecord ?? (() => Promise.resolve(null));

  if (body.method === 'initialize') {
    return envelope(body.id, {
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      },
    });
  }
  if (body.method === 'tools/list') {
    return envelope(body.id, { result: { tools: TOOLS } });
  }
  if (body.method === 'tools/call') {
    const name = body.params?.name;
    const args = body.params?.arguments ?? {};
    let result;
    if (name === 'check_name') result = await checkName(args.name, { getRecord: getRecordDep });
    else if (name === 'get_record') result = await getRecordTool(args.name, { getRecord: getRecordDep });
    else if (AUTHED_TOOLS.has(name)) result = await callAuthedTool(name, args, deps);
    else return envelope(body.id, { error: { code: -32602, message: `unknown tool: ${String(name)}` } });
    return envelope(body.id, { result });
  }
  return envelope(body.id, {
    error: { code: -32601, message: `method not found: ${String(body.method)}` },
  });
}

// JSON-RPC batches (2025-03-26): every entry is processed, replies come back
// as an array with one envelope per request entry and none for
// notifications. initialize is forbidden inside a batch.
export async function handleBatch(batch, deps = {}) {
  const replies = [];
  for (const entry of batch) {
    if (!entry || typeof entry !== 'object' || entry.jsonrpc !== '2.0' || typeof entry.method !== 'string') {
      replies.push(envelope(entry?.id ?? null, { error: { code: -32600, message: 'invalid request' } }));
      continue;
    }
    if (entry.id === undefined || entry.id === null) continue; // notification
    if (entry.method === 'initialize') {
      replies.push(envelope(entry.id, { error: { code: -32600, message: 'initialize cannot be batched' } }));
      continue;
    }
    replies.push(await handleRpc(entry, deps));
  }
  return replies;
}
