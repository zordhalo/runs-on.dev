---
title: "Overlap: the first thing built on runs-on.dev"
description: "A meeting-time finder now lives at overlap.runs-on.dev. What it does, why sleep is a hard constraint, and what the registry looked like from the inside as a consumer of itself."
date: "2026-09-20"
author: "Advance Labs"
category: "engineering"
tags: ["overlap", "scheduling", "open-source", "dogfooding"]
status: "published"
---

[overlap.runs-on.dev](https://overlap.runs-on.dev) is live. It finds meeting
times for people spread across time zones, and it is the first thing we have
put on a name from this registry rather than on a `vercel.app` URL.

## The problem it solves

Coordinating across time zones costs more in negotiation than in meeting. You
propose three times, everyone converts them into their own head, somebody is
asleep for two of them, and a day is gone. The meeting was never the expensive
part.

Overlap collapses that into one link. Share it, everyone sets their hours once,
and the page already knows when you can meet.

## Sleep is a hard constraint

Most schedulers treat any unbooked hour as available. "Free at 4am" is not
free, and a tool that suggests it is wasting your time in a way that feels
like an insult.

So Overlap separates two things that are usually conflated. Sleep and existing
calendar commitments are **hard**: a slot overlapping them is never offered at
all. Hours outside your working day are **soft**: they stay on the table, but
they cost something, and the cost is named. A suggestion reads "an early start
for Matthew" rather than pretending every option is equal.

That distinction turned out to matter more than the scheduling maths. It is
the difference between a list of technically-valid times and a list you would
actually send to three people.

## What the cost scoring does and does not do

Each candidate scores zero inside everyone's working hours, two for someone
awake but off-hours, and twenty-five for anyone dragged within an hour of
sleep. Twenty-five rather than ten because at six people, two times six
outranks a lone ten, and the ranker would quietly prefer hurting one person
badly over mildly inconveniencing everyone.

What it does not do is rotate that burden between meetings. The scorer is
stateless. It spreads cost within one meeting's options and has no memory of
who took the last early call. Claiming otherwise would be a nice feature and
a lie, so the interface says the former and never the latter.

## Time zones are the whole problem

Two things worth knowing if you ever write this code yourself.

Luxon does not flag a nonexistent spring-forward local time as invalid. Ask it
for 02:30 on the transition day and it silently hands you 03:30. `isValid` is
for unsupported zone names, not gap detection. It also documents fall-back
ambiguity as undefined behaviour. So Overlap never asks whether a wall-clock
time exists; it works with real instants and lets interval merging absorb both
the gap and the repeat.

`Intl.supportedValuesOf('timeZone')` is not a valid allowlist either. On the
Node build we shipped against it enumerates 418 zones using *deprecated*
names while omitting the canonical ones: `Asia/Kolkata`, `Europe/Kyiv` and
`Asia/Kathmandu` are all absent, while `Asia/Calcutta` and `Europe/Kiev` are
present. Validating against that list rejected real people. Anyone in India
or Nepal could not join a circle. The fix is to ask the runtime whether it can
resolve a zone, not whether the zone appears in a list the runtime advertises.

## Being our own first user

A registry that nobody builds on is a directory. Putting Overlap on
`overlap.runs-on.dev` was partly a test of the claim this project keeps
making: that a name here is a real address you can run a product on, not a
novelty redirect.

It held up. The name is a record in `domains/overlap.json` like any other,
the wildcard resolved it with a valid certificate before any DNS was
configured, and pointing it at a different deployment took one change. The
registry did not need to know or care what was behind the name.

## It is open source

Overlap is [AGPL-3.0 on GitHub](https://github.com/zordhalo/overlap). It needs
Postgres and two generated secrets to run, and nothing else. Connecting a
calendar is optional: it reads free/busy only, so it learns *that* you are
busy and never *what* you are doing. There is no column for event titles,
which is a stronger guarantee than a policy about not reading them.
