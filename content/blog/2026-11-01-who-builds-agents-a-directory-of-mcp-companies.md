---
title: "Who Builds Agents: a directory of the companies shipping MCP servers"
description: "whobuildsagents.com ranks 16,990 companies by the MCP servers they publish to the Official MCP Registry. Why it lists companies and never people, how a registry name becomes a company, and what we learned about counting."
date: "2026-11-01"
author: "Advance Labs"
category: "engineering"
tags: ["mcp", "directory", "agents", "open-data"]
status: "published"
---

[whobuildsagents.com](https://whobuildsagents.com) is live. It answers one
question: which companies are actually building for AI agents? Today that is
16,990 companies publishing 21,739 MCP servers, ranked by how many each one
ships, refreshed every day from the
[Official MCP Registry](https://registry.modelcontextprotocol.io).

## Why build another directory

It started with a scraped LinkedIn profile. A people directory had copied a
teammate's profile onto a page about our company, and the only way to fix it
was to sign up with a company email it would not accept. Directories of
people are built on data the people never gave them.

A directory of companies does not have that problem if the data is already
public and published by the company itself. The MCP Registry is exactly that:
every server in it was put there by someone who proved control of a domain.
So the rule for Who Builds Agents was set before any code: **companies only,
never people**, and every fact on a page comes from the registry or the
company's own homepage.

## A registry name is a verified domain

Registry names are reverse DNS. `com.example/mcp` can only be published by
someone who proved they control `example.com`. That makes the namespace a
free, already-verified company identity, so the directory rolls every server
up to its registrable domain: `com.example.docs/mcp` lands on `example.com`
too.

Two kinds of name are skipped on purpose. `io.github.<user>` is usually one
person, and listing people is the thing we do not do. Platform subdomains
(the kind the Public Suffix List marks as private, like `x.workers.dev`) are
somebody's side project, not a company.

## Claim and remove without emailing anyone

A company can claim its page or remove it outright. Both work the same way:
enter an address at your own domain, get a code, done. Owning a mailbox at
`example.com` is cheap to check and expensive to fake at scale, which is
also why it is the identity we plan to build votes and submissions on.
Removal is permanent: the daily ingest never re-adds a suppressed domain.

## Written for agents as much as people

Most of the traffic a directory like this earns will come through answer
engines, so the machine surfaces are first class. There is a live
[llms.txt](https://whobuildsagents.com/llms.txt) with the current numbers,
every page carries JSON-LD (Organization, ItemList, FAQPage, Dataset), the
data is CC0 like the registry it comes from, and pages are submitted to
search engines through IndexNow. Crawlers, AI ones
included, are allowed everywhere.

## 22 categories, no model call

Every company is filed into up to three of
[22 categories](https://whobuildsagents.com/categories), from
[payments](https://whobuildsagents.com/category/payments) to developer tools,
using keyword rules over its server descriptions and homepage. It is free,
deterministic and reruns in about three seconds after each daily ingest. A
model would be more accurate, and it would also spend shared credit every
night on a job that is already roughly 80% right. The rules are tested
against the false positives we found by hand, like "stock footage" landing
in finance.

## Counting is the hard part

Ranking by servers published is objective, and it is also easy to game. Two
things surfaced in the first week.

**Hosts are not builders.** Smithery and usefulapi publish hundreds of
servers that wrap other companies' products. They keep their place in the
ranked list, but their pages say "hosts" rather than "publishes", and they
are left out of categories and of any "who builds the most" answer.

**Listed is not shipped.** Anyone can publish a hundred concept entries to
the registry for free. Rather than keep a hand-made list of noisy publishers,
which would make the ranking an editorial opinion, the next step is to count
only servers that are real: a remote endpoint that answers an MCP handshake,
a package that resolves on npm or PyPI, or a repository that exists. Pages
will show both numbers. Paid placement, when it comes, sits in its own
labelled slot and never changes rank.

If your company publishes MCP servers, it is probably already listed.
[Look it up](https://whobuildsagents.com) and claim the page.
