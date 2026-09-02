# Architecture

## From request to rendered card

1. A browser requests `you.runs-on.dev`.
2. DNS resolves it via the wildcard `*.runs-on.dev` record (see below),
   landing on the same Vercel project as `runs-on.dev` itself.
3. `proxy.js` (Next's middleware) reads the `Host` header, strips the
   `.runs-on.dev` suffix, validates the remaining label with
   `lib/name.js`'s `validateName`, and rewrites the request internally to
   `/sites/<name>`.
4. `app/sites/[name]/page.jsx` reads `domains/<name>.json` from this repo
   via the GitHub Contents API (`lib/registry.js`'s `getRecord`), then
   fetches the owner's public GitHub profile, and renders the card.

If the name fails `validateName` (bad characters, wrong length, punycode),
`proxy.js` returns 404 before any GitHub request happens. If the name is
valid but has no record, `getRecord` returns `null` and the page calls
`notFound()`.

`/sites/*` is also a real Next.js route, so `proxy.js` explicitly 404s any
direct external request to it. The rewrite target must only be reachable
through the internal rewrite, not from the outside on any host.

## The wildcard

One DNS record, `*.runs-on.dev` pointed at the Vercel project, is enough
for every grammar-valid subdomain to resolve with a valid HTTPS certificate
the moment it's requested: Vercel issues wildcard TLS for domains it
manages. That means claiming a name is a git commit against this repo, not
a DNS write: nothing has to be provisioned in DNS at all for the default
profile-card behavior. This single record, set up once outside this repo's
automation, is what the whole "no DNS to configure" claim in the README
rests on.

When a record does carry a `CNAME`, `A`, or `TXT` entry, `scripts/sync-dns.mjs`
creates an exact-name DNS record for that one subdomain. Vercel's resolver
prefers an exact match over the wildcard, so that specific name now routes
to the owner's own hosting instead of the app, while every other name keeps
falling through to the wildcard and the profile card. See
[docs/records.md](./records.md#how-a-record-reaches-dns) for the sync
mechanics.

## The three write paths into `domains/`

There are exactly three ways a `domains/<name>.json` file gets created or
changed. All three end in a commit to this repository, because the file is
the registry; they differ in what they check first.

- **Claiming a new name** goes through `POST /api/claim`
  (`app/api/claim/route.js`), which checks a live GitHub session,
  eligibility (`lib/eligibility.js`), the reserved-name lists
  (`lib/blocklist.js`), and the per-account claim limit (`lib/claim.js`'s
  `evaluateClaim`, backed by the `owners/<login>.json` index in
  `lib/owners.js`) before writing with `lib/registry.js`'s `putRecord`.
- **Changing an existing record from the site** goes through
  `POST /api/records` (`app/api/records/route.js`), which reads the record
  with its blob `sha`, applies `lib/edit.js`'s `validateEdit`, and writes
  with `putRecordUpdate`. This is what `/manage` posts to.
- **Changing or removing a record by pull request**, which is also a
  first-class way to claim a new name, is validated by `lib/pr.js`'s
  `validateChangeset` in
  [`.github/workflows/validate.yml`](../.github/workflows/validate.yml).
  That workflow checks out the PR's *base* branch before running the
  validator, so a PR cannot rewrite `lib/pr.js` to approve itself. The
  same consequence is worth knowing when you change a validation rule: an
  open PR only picks the new rule up on its next push, because a re-run
  replays the original event payload and with it the original `base.sha`.

The second and third paths reach the same files with the same consequences,
so they must not enforce different rules: whichever front door checks less
is the only one anyone would use. Both call `validateEdit`, which is the
single definition of what an edit may do — only the recorded owner may
change a record, and `owner`, `claimedAt`, and `name` are immutable once
set. A pull request that *creates* a record instead runs `validateNewClaim`,
which re-applies the same gates `evaluateClaim` applies on the site.

### Rationing the site's write path

`POST /api/records` is the one write path a signed-in visitor can call in a
loop, and every call spends `REGISTRY_TOKEN` quota — the same pool claiming
draws on — while every successful one is a commit, a `sync-dns` run, and a
DNS API write. Two limits apply, in `app/api/records/route.js`:

- A save that would produce a file identical to the one already committed
  returns without writing (`lib/edit.js`'s `isUnchanged`). This is the
  deterministic half: a no-op has nothing to commit, so it cannot be
  evaded by spreading requests around.
- A per-account window (`lib/throttle.js`) caps the rest at 12 writes per
  10 minutes, checked *ahead of the registry read* rather than just the
  write, because reads spend the same quota.

The window is held in memory. Instances are not shared, so a caller
spreading requests across cold starts gets a fresh allowance: it is not an
authorization boundary and is not the only thing guarding anything. What it
reliably stops is one client looping against one warm instance, which is
what a stuck retry or a leaned-on button actually looks like. Ownership
checks, schema validation, and the `sha` compare-and-swap are the durable
protections.

### Why `putRecord` and `putRecordUpdate` treat `sha` oppositely

Both write through the GitHub contents API, and the difference between them
is one field. `putRecord` omits `sha`, so GitHub refuses a write over a path
that already exists — that refusal is what makes claiming safe against two
people racing for the same name. `putRecordUpdate` must send the `sha` it
read, so GitHub refuses a write over a file that has changed since — which
is what stops a stale editor tab clobbering an edit made somewhere else.
Same field, inverted guarantee, and getting it backwards in either direction
is silent data loss rather than a visible error.

## Why `CARD_TOKEN` is separate from `REGISTRY_TOKEN`

`REGISTRY_TOKEN` has `contents:write` on this repo and is what `/api/claim`
and `/api/check` use to read and write records. It's the token the whole
claim flow's rate-limit budget depends on. But `*.runs-on.dev` is a
wildcard: every grammar-valid hostname resolves and triggers a GitHub read
in `app/sites/[name]/page.jsx`, on every request, from anyone. An anonymous
curl loop over a few thousand candidate names would burn through
`REGISTRY_TOKEN`'s quota just rendering cards, and push real claims into
the `503 busy` path (`lib/registry.js` treats `403`/`429` from GitHub as
`ratelimited`, and `app/claim-form.jsx` retries those with backoff, but
only up to a point).

`CARD_TOKEN` is a separate, read-only token used only for profile-card
renders (`app/sites/[name]/page.jsx` and, indirectly, every
`<name>.runs-on.dev` request). It falls back to `REGISTRY_TOKEN` if unset,
but setting it means the two workloads draw from different rate-limit
budgets, so enumerating hostnames can't starve the claim flow.
