---
title: "One thousand names"
description: "The registry crossed a thousand claimed names. Congratulations to everyone who claimed one, pointed it somewhere, or sent a fix."
date: "2026-09-19"
author: "Advance Labs"
category: "announcement"
tags: ["milestone", "community", "stats"]
image: /blog-media/thousand-names.png
status: "published"
---

The registry crossed a thousand claimed names. At the time of writing, 1,183
`*.runs-on.dev` names belong to 1,182 people, and more than half of every
claim ever made arrived in the last week alone.

Every name here is a JSON file in a public repo. Nothing about this milestone
is estimated or tracked; the curve above is just that repository, counted.

## Congratulations

Congratulations to the 1,182 of you. You claimed the name, got a working
subdomain over HTTPS in seconds, and most of you went further: you pointed it
at something you built.

Some of you shipped a portfolio on Vercel the same evening. Some of you put
up a GitHub Pages site, a Netlify project, a Cloudflare Pages deploy, a
Render service, or a plain URL redirect. A few of you wrote custom DNS
records by hand, which is the kind of stubbornness this registry respects.

And to everyone keeping the profile card as-is: that card is the registry's
front porch. It looks good on you.

## Where you are

Claims have come from six continents. Asia leads by a wide margin, Europe and
North America follow, and there are claims scattered across Africa, Oceania,
and South America. The map on the [stats page](/stats) is drawn from
claim-time countries and public GitHub profiles, so it is approximate by
design, but the spread is real.

![The claim map on the stats page: a dot-matrix world map with blue blooms over claim clusters, above per-continent counts](/blog-media/where-claims-come-from.png)

## The part you fixed

A registry that runs on pull requests gets better the same way. The DNS
verification guides, the two-label subdomain fix, the sync reconciliation
that makes a failed write unable to take a name offline, the spam filters,
the stats page itself: much of that came from outside the core team, sent as
ordinary pull requests that CI validated like any other change.

Thank you. Keep them coming.

## What is next

The pipeline ahead is already visible: hosted sites that serve real files
from your name, a status page, and deeper tooling for the one DNS step that
trips people up. If you want a name, [the claim form](/#claim) is one field
and one click. One per GitHub account, free forever.

See you at two thousand.
