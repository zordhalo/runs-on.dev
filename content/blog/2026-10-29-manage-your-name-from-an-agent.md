---
title: "Manage your runs-on.dev name from Claude Code, Codex, or any MCP agent"
description: "The runs-on.dev MCP server can now edit your DNS, deploy a static site, and roll it back. Add one line to your agent, sign in once in the browser, and ask in plain words."
date: "2026-10-29"
author: "Advance Labs"
category: "announcement"
tags: ["agents", "mcp", "dns", "hosting"]
status: "published"
---

Until now the [MCP server](/.well-known/mcp) could only look things up: is a
name free, and what does a claimed name point at. Today it can change things
too. Connect your coding agent and it can repoint your name, add verification
records, publish a site, and roll it back, without you opening /manage.

## Set it up: one command, one browser click

Add the server to your agent.

Claude Code:

```
claude mcp add --transport http runs-on https://runs-on.dev/.well-known/mcp
```

Codex:

```
codex mcp add runs-on --url https://runs-on.dev/.well-known/mcp
```

Then sign in: `/mcp` → **Authenticate** in Claude Code, or
`codex mcp login runs-on` in Codex. A browser opens on runs-on.dev, you sign
in with GitHub as usual, and you pick what the agent gets: deploys only, or
deploys plus your DNS. That's it. No token to copy anywhere.

Then ask for what you want: "point my name at my Vercel project", "add the
`_discord` TXT record Discord gave me", "deploy `dist/` and give me the URL",
"the last deploy broke the homepage, roll it back". The full walkthrough is in
the [MCP guide](/docs/mcp).

## What the agent gets

| tool | token | does |
|---|---|---|
| `whoami` | any | your login, the token scope, the names you own |
| `update_records` | manage | apex records, subdomains, profile card |
| `deploy_site` | any | publish static files to your name |
| `list_deployments` | any | history, and which deployment is live |
| `rollback_site` | any | instantly re-point at an earlier deployment |

`check_name` and `get_record` are still there and still need no token.

## Same rules, one more front door

The agent does not get a separate code path. A record edit over MCP runs the
same validation as the /manage editor and as CI on a pull request, lands as
the same public commit in the registry, and syncs to DNS the same way. Deploys
and rollbacks share code with the HTTP deploy API, and each tool spends the
same per-account rate limit the website does. If an agent sends a CNAME
alongside an A record, it gets the same error you would.

## Signing in, without a new account system

The login is standard MCP OAuth: your agent discovers runs-on.dev's
authorization server, registers itself, and sends you to an approval page
with PKCE guarding the handoff. Behind it is the GitHub sign-in the site
already uses, and what comes out is the same kind of token /manage hands
out. So every agent login shows up in your key list, expires after 30 days,
and stops working the moment you delete it.

For CI or anywhere without a browser, you can still generate a token on
/manage and pass it as an `Authorization: Bearer` header. The
[MCP guide](/docs/mcp) has both.

## Why DNS is a separate permission

Deploy tokens already live in people's CI. Quietly letting every existing token
edit DNS would have handed new power to keys minted for something narrower. So
editing DNS is a separate choice, made on the approval page or with the
**also edit DNS** box at mint time, and the key list on /manage shows which
kind each key is.

Three things stay out of reach on purpose: claiming, swapping, and releasing a
name. Those are hard to undo, so they stay behind your GitHub sign-in in the
browser.
