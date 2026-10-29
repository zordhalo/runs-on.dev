import { handleRpc, handleBatch, mcpManifest, PROTOCOL_VERSION } from '../../../lib/mcp.js';
import { getRecord } from '../../../lib/registry.js';
import { getOwnerIndex } from '../../../lib/owners.js';
import { authorizeBearer, resolveSiteName } from '../../../lib/site-access.js';
import { editRecord } from '../../../lib/record-edit.js';
import { publishSite, listDeployments, rollbackSite } from '../../../lib/site-actions.js';
import { storeConfigured } from '../../../lib/store.js';
import { createRateLimiter } from '../../../lib/throttle.js';

// MCP over Streamable HTTP, mounted at /.well-known/mcp via a rewrite. All
// requests are answered statelessly with a single JSON response (no SSE
// stream, no session). The public tools read registry data through the
// shared CARD_TOKEN quota inside getRecord; the owner tools authenticate the
// rod1 bearer token per request, exactly like /api/sites/*, and spend the
// same per-login allowances the HTTP routes give their actions.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TEN_MIN = 10 * 60 * 1000;
const takeRead = createRateLimiter({ windowMs: TEN_MIN, max: 30 });
const takeWrite = createRateLimiter({ windowMs: TEN_MIN, max: 12 });
const takeDeploy = createRateLimiter({ windowMs: TEN_MIN, max: 6 });

const TOKEN = () => process.env.REGISTRY_TOKEN;

// Converts a front-door { response } into the { status, body } the tools
// speak, so lib/mcp.js never touches a Response.
async function unwrap(result) {
  if (!result.response) return result;
  return { status: result.response.status, body: await result.response.json().catch(() => ({})) };
}

function rateLimited(budget) {
  return { status: 429, body: { error: 'rate_limited', retryInMs: budget.retryAfterMs } };
}

// Each tool spends its own allowance, so a client that lists tools and calls
// whoami a few times cannot starve its own deploys.
function limited(take, action) {
  return async (ctx, ...rest) => {
    const budget = take(ctx.login.toLowerCase());
    if (!budget.ok) return rateLimited(budget);
    return action(ctx, ...rest);
  };
}

function depsFor(request) {
  // Authenticate lazily and once per HTTP request: initialize and
  // tools/list never touch the token registry, and a batch shares one check.
  let account;
  const hasBearer = /^Bearer\s+\S/i.test(request.headers.get('authorization') ?? '');
  return {
    getRecord: (name) => getRecord(name, {}),
    account: () => {
      if (!hasBearer) return { status: 401, body: { error: 'auth_required' } };
      // Budget is spent per tool below, not per authentication.
      account ??= authorizeBearer(request, () => ({ ok: true })).then(unwrap);
      return account;
    },
    resolveName: async (acct, name) => {
      const budget = takeRead(acct.login.toLowerCase());
      if (!budget.ok) return rateLimited(budget);
      return unwrap(await resolveSiteName(acct, name));
    },
    ownedNames: async (login) => {
      const budget = takeRead(login.toLowerCase());
      if (!budget.ok) throw new Error('rate_limited');
      return (await getOwnerIndex(login, { token: TOKEN() }))?.names ?? [];
    },
    editRecord: (login, body) => {
      const budget = takeWrite(login.toLowerCase());
      return budget.ok ? editRecord(login, body) : rateLimited(budget);
    },
    publishSite: limited(takeDeploy, (ctx, entries) => (
      storeConfigured() ? publishSite(ctx, entries) : { status: 503, body: { error: 'storage_not_configured' } }
    )),
    listDeployments: (ctx) => listDeployments(ctx),
    rollbackSite: limited(takeDeploy, rollbackSite),
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } },
      { status: 400 },
    );
  }

  if (Array.isArray(body)) {
    const replies = await handleBatch(body, depsFor(request));
    return Response.json(replies);
  }

  // Notifications (no id) expect no response body, just acceptance.
  if (!body || typeof body !== 'object' || body.id === undefined || body.id === null) {
    if (body && typeof body === 'object' && body.jsonrpc === '2.0' && typeof body.method === 'string') {
      return new Response(null, { status: 202 });
    }
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } },
      { status: 400 },
    );
  }

  if (body.jsonrpc !== '2.0') {
    return Response.json(
      { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32600, message: 'invalid request: jsonrpc must be "2.0"' } },
      { status: 400 },
    );
  }

  const out = await handleRpc(body, depsFor(request));
  return Response.json(out);
}

// No SSE stream: this server is stateless request/response only.
// GET has two callers with different needs: an MCP client probing for an SSE
// stream (gets the protocol-correct 405 JSON refusal, plus Allow: POST), and
// a human pasting the URL into a browser (gets a small live status page:
// server, protocol version, tools, and how to connect). Content negotiation
// picks between them.
const STATUS_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>runs-on.dev MCP</title>
<style>body{background:#101010;color:#f3f3f3;font-family:ui-monospace,Consolas,monospace;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.6}
h1{font-weight:400;font-size:22px}code{color:#98ff38}a{color:#f3f3f3}hr{border:0;border-top:1px solid #212121}</style></head>
<body>
<h1>runs-on.dev MCP server · live</h1>
<p>protocol: Streamable HTTP JSON-RPC (${PROTOCOL_VERSION}) · transport: POST only</p>
<hr>
<p>public tools:</p>
<p>· <code>check_name</code> — is a subdomain available to claim?</p>
<p>· <code>get_record</code> — fetch a claimed name's public registry record</p>
<p>owner tools (Authorization: Bearer rod1… from <a href="/manage">/manage</a>):</p>
<p>· <code>whoami</code> — token login, scope, owned names</p>
<p>· <code>update_records</code> — DNS, subdomains, profile (manage scope)</p>
<p>· <code>deploy_site</code> · <code>list_deployments</code> · <code>rollback_site</code> — static hosting</p>
<hr>
<p>connect:</p>
<p><code>claude mcp add --transport http runs-on https://runs-on.dev/.well-known/mcp --header "Authorization: Bearer rod1…"</code></p>
<p>guide: <a href="/docs/mcp">/docs/mcp</a></p>
<p>full spec: <a href="/openapi.json">/openapi.json</a> · agent index: <a href="/llms.txt">/llms.txt</a></p>
</body></html>`;

// GET has three callers: an MCP client probing for the optional SSE stream
// (protocol-correct 405 JSON refusal with Allow: POST), a human in a
// browser (a small live status page at 405 with Allow: POST), and an agent
// or auditor asking for JSON (a plain-JSON manifest of the server facts).
export async function GET(request) {
  const accept = request.headers.get('accept') ?? '';

  // An MCP client probing for the optional SSE stream: refuse in protocol.
  if (accept.includes('text/event-stream')) {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'GET is not supported; POST JSON-RPC to this endpoint' } },
      { status: 405, headers: { Allow: 'POST' } },
    );
  }

  // A human in a browser: a plain status page, still carrying 405 semantics
  // via the Allow header so nobody mistakes this for a usable GET surface.
  if (accept.includes('text/html')) {
    return new Response(STATUS_PAGE, {
      status: 405,
      headers: { 'content-type': 'text/html; charset=utf-8', Allow: 'POST' },
    });
  }

  return Response.json(mcpManifest());
}
