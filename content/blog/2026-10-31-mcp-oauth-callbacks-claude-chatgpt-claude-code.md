---
title: "The OAuth callbacks an MCP server has to allow for Claude, ChatGPT and Claude Code"
description: "The exact redirect URIs Claude, ChatGPT and Claude Code send to a remote MCP server, why an allowlist matters when registration is open, and how two of our servers handle it today."
date: "2026-10-31"
author: "Advance Labs"
category: "engineering"
tags: ["mcp", "oauth", "agents", "security"]
status: "published"
---

If you are building a remote MCP server with OAuth, the first thing that
fails is usually the redirect URI. Claude, ChatGPT and Claude Code each send
users back to a different place, and your authorization server has to decide
which of those it trusts. Here is what each one sends, why the decision
matters, and what we did on two servers we run.

## What each client sends

**Hosted Claude apps** (claude.ai on the web, Desktop, mobile, Cowork) use
exactly one callback:

```
https://claude.ai/api/mcp/auth_callback
```

**Claude Code** is a CLI, so it uses an RFC 8252 loopback redirect on an
ephemeral port. Its Client ID Metadata Document declares
`http://localhost/callback` and `http://127.0.0.1/callback`, and the port
changes every login. Match loopback with the port ignored, for both
hostnames.

**ChatGPT** gives each app its own callback, shown on the app management
page:

```
https://chatgpt.com/connector/oauth/{callback_id}
```

The older `https://chatgpt.com/connector_platform_oauth_redirect` is still
valid for published apps.

A few more things from Claude's connector docs that bite people. Claude
supports both Dynamic Client Registration (DCR) and Client ID Metadata
Documents (CIMD) by default, and picks CIMD only when your authorization
server metadata advertises `client_id_metadata_document_supported: true` and
`"none"` in `token_endpoint_auth_methods_supported`. It starts sign-in only if
your MCP endpoint answers 401 with a `WWW-Authenticate` header carrying
`resource_metadata`, and ignores that header on a 200. It uses only the first
entry in `authorization_servers`, requires S256 PKCE, and gives discovery,
registration and token calls 10 seconds (refresh gets 30).

## Why have an allowlist at all

With open Dynamic Client Registration, anyone can register a client with any
redirect URI. PKCE does not fix that. PKCE stops someone redeeming a code they
did not start, but an attacker who registers their own server as the redirect
is the party that started the flow. They send a victim an authorize link, the
victim approves, and the code lands on the attacker's server along with the
verifier they chose.

So something has to decide which redirect URIs are acceptable. Every hosted
entry you allow is a party you trust with your users' authorization codes, so
keep the list short and exact.

## What our search MCP server allows

The Advance Labs AEO Toolkit search MCP server (changed 2026-10-31) accepts
loopback on any port, plus exactly three hosted entries. A sketch of the
logic:

```ts
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function allowed(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || u.username || u.password) return false;

  // Claude Code: http loopback, any port, nothing else
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  if (u.protocol !== "https:" || u.port) return false;
  if (u.search) return false;

  // Hosted entries: exact host, exact path
  if (u.hostname === "claude.ai") {
    return u.pathname === "/api/mcp/auth_callback";
  }
  if (u.hostname === "chatgpt.com") {
    return (
      u.pathname === "/connector_platform_oauth_redirect" ||
      /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname)
    );
  }
  return false;
}
```

The interesting part is the refusals. We have tests for each of these near
misses, and all of them are rejected:

- `http` instead of `https` on a hosted entry
- an extra path segment after the callback
- any query string
- any non-default port
- subdomains, such as `evil.claude.ai`
- lookalike hosts, such as `claude.ai.evil.example`
- two path segments, or an empty one, after `/connector/oauth/`
- encoded traversal like `..%2F`
- fragments

The ChatGPT per-app pattern is the one to be careful with. It has to accept
whatever `callback_id` OpenAI generates, so it allows one segment of
`[A-Za-z0-9_-]+` and nothing else. That is still a wildcard, and it is a
wildcard on a host you decided to trust.

## What runs-on.dev had, and what we changed

runs-on.dev has its own MCP server (`claude mcp add --transport http runs-on
https://runs-on.dev/.well-known/mcp`, then sign in with GitHub). Writing this
post is how we noticed it had the open variant: registration accepted any
`https` redirect URI, plus `http` on loopback. The claude.ai and chatgpt.com
callbacks worked because Claude and ChatGPT register them, but so did any other
`https` address, on a server whose codes can change a user's DNS records.

It had mitigations. Protocol errors only redirected back to loopback, so the
authorize endpoint was never an open redirect. The consent page showed the
signed-in GitHub login and the host you were being sent to. PKCE with S256 was
required. None of that stops a user who clicks Approve on a page naming a host
they do not recognise.

So the same day, runs-on.dev got the same allowlist as above: loopback, the
Claude callback, and the two ChatGPT ones. Registering any other redirect now
returns 400. The code is in `lib/oauth.js`.

One detail is worth copying if your client ids are stateless. runs-on.dev
issues a client id that is the signed registration itself, with no database.
That means a client registered before the change still carries its old
redirect, and its signature still verifies. Checking the allowlist only at
`/register` would have left every earlier registration working forever. The
check now runs again at `/authorize`, and there is a test that builds a
pre-change client id with an arbitrary `https` redirect and confirms it is
refused.

## The short version

- Claude web, Desktop, mobile: `https://claude.ai/api/mcp/auth_callback`.
- Claude Code: loopback on `localhost` and `127.0.0.1`, port ignored.
- ChatGPT: `https://chatgpt.com/connector/oauth/{callback_id}`, plus the legacy
  `connector_platform_oauth_redirect`.
- Compare scheme, host, port, path and query exactly. Do not use prefix or
  suffix matching on hostnames.
- Return a 401 with `WWW-Authenticate` and `resource_metadata`, advertise S256,
  and keep your discovery and token endpoints fast.

On 2026-10-31 we published the AEO Toolkit servers to the official MCP Registry
as `dev.advancelabs/aeo-search`, `aeo-visibility` and `aeo-backlink`. Directory
reviewers also want every tool to carry a title and
`readOnlyHint`/`destructiveHint` annotations, so we made that field required
in our shared tool type. The sources for the client behavior above are
[Claude's connector authentication docs](https://claude.com/docs/connectors/building/authentication)
and [OpenAI's Apps SDK auth guide](https://developers.openai.com/apps-sdk/build/auth).
