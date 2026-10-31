# MCP server and agent sign-in

How `/.well-known/mcp` lets an agent manage a claimed name, and how it signs in.
User-facing guide: https://runs-on.dev/docs/mcp

## Map

| Path | File | What |
|---|---|---|
| `/.well-known/mcp` | `app/api/mcp/route.js` (rewrite) | JSON-RPC transport, auth challenges, rate limits |
| | `lib/mcp.js` | tool list and dispatch, network-free (deps injected) |
| | `lib/record-edit.js` | record edit, shared with `/api/records` |
| | `lib/site-actions.js` | deploy/list/rollback, shared with `/api/sites/*` |
| `/.well-known/oauth-authorization-server` | `app/api/oauth/metadata` (rewrite) | RFC 8414 metadata |
| `/.well-known/oauth-protected-resource/.well-known/mcp` | `app/api/oauth/resource` (rewrite) | RFC 9728 metadata for the MCP URL |
| `/api/oauth/register` | | RFC 7591 dynamic registration |
| `/api/oauth/authorize` | | consent page (GET) and approval (POST) |
| `/api/oauth/token` | | code + PKCE verifier in, rod1 token out |
| | `lib/oauth.js` | all OAuth logic as pure functions |

## Tools

`check_name` and `get_record` are public. `whoami`, `deploy_site`,
`list_deployments` and `rollback_site` need any rod1 token. `update_records`
needs a `manage`-scoped one.

## Tokens and scopes

Every credential the MCP server accepts is a `rod1` token (`lib/tokens.js`),
recorded in `tokens/<login>.json` by `mintRecordedToken`
(`lib/token-registry.js`). That holds whether the token was minted on /manage
or came from OAuth, so every agent login is listed on /manage and stops
working the moment it is deleted there.

| token scope | OAuth scopes | can |
|---|---|---|
| `sites` | `sites:publish` | deploy, list, roll back |
| `manage` | `sites:publish records:write` | all of that plus `update_records` |

`manage` is opt-in on purpose: deploy tokens already sitting in CI must never
gain the power to repoint DNS.

## Sign-in flow

1. The client calls an owner tool with no token. The route answers **401**
   with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/.well-known/mcp"`.
   A deploy-only token calling `update_records` gets **403**
   `error="insufficient_scope"` instead. Public tools never challenge, so
   anonymous lookups keep working.
2. The client reads both metadata documents and registers at
   `/api/oauth/register`. The client id is the HMAC-signed registration
   itself (`roc1.…`), so nothing is stored.
3. The browser opens `/api/oauth/authorize`. Without a session it detours
   through GitHub sign-in and comes back. The only allowed return target is
   `SIGNIN_RETURN_PREFIX` in `lib/session.js`.
4. The consent page offers deploy-only or deploy + DNS. Approving POSTs a
   signed consent blob and gets a 5-minute authorization code back on the
   client's redirect URI, with `state` and `iss`.
5. `/api/oauth/token` checks the code, client, redirect URI and PKCE S256,
   then mints a 30-day rod1 token. There are no refresh tokens: after 30 days
   the user approves again.

## Security invariants (each has a test)

- **No stored state.** Client ids, consent blobs and codes are HMAC'd with
  keys derived per kind from `SITE_TOKEN_SECRET`, so one can never pass as
  another.
- **Errors never redirect to an https client.** Registration is open, so a
  registered https redirect proves nothing about who owns it. Authorize errors
  go back only to loopback redirects; everything else gets a local error page
  (RFC 9700 §4.11.2).
- **CSRF on approve.** The approval POST needs the `SameSite=Lax` session
  cookie *and* a consent blob minted for the same login. The page refuses to
  be framed.
- **Redirect URIs** are http on loopback, or exactly the hosted callbacks of
  clients trusted by name: `https://claude.ai/api/mcp/auth_callback`,
  `https://chatgpt.com/connector_platform_oauth_redirect` and
  `https://chatgpt.com/connector/oauth/{id}` (`lib/oauth.js`). Registration is
  open, so this list is the only thing deciding who can receive a code; a new
  hosted client is added on purpose. It is checked at authorize as well as at
  registration, because client ids are stateless and older ones would
  otherwise keep their redirect forever. A loopback redirect may come back on
  any port (RFC 8252 §7.3); nothing else may change.
- **Shared gates.** Edits go through `validateEdit`, the same check CI runs on
  pull requests, and every tool spends the same per-login rate limits as the
  HTTP routes.
- **Known corner.** Single-use codes are enforced in memory per instance (see
  the `ponytail:` note in `lib/oauth.js`). A cross-instance replay still needs
  the PKCE verifier.

## Tests

- `test/mcp.test.mjs`: tools, scopes, auth challenges, file rules.
- `test/oauth.test.mjs`: the OAuth chain and every refusal.
- `test/oauth-routes.test.mjs`: the real handlers against a faked GitHub
  contents API, from consent to an accepted token to revocation.
