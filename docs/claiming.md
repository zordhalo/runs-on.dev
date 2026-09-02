# Claiming a name

## The flow

1. Go to [runs-on.dev](https://runs-on.dev).
2. Sign in with GitHub (`app/api/auth/github/route.js` starts the OAuth
   flow; `.../callback/route.js` completes it and sets a signed session
   cookie).
3. Type a name. The form checks availability against `GET /api/check` as
   you type (debounced, see `app/claim-form.jsx`).
4. If it's available, click "Claim it". That calls `POST /api/claim`,
   which:
   - reads your session cookie (`lib/session.js`),
   - validates the name's grammar (`lib/name.js`) and checks it against the
     reserved-name lists (`lib/blocklist.js`),
   - checks eligibility (below),
   - and writes `domains/<name>.json` directly to this repo via the GitHub
     Contents API (`lib/registry.js`), with no pull request involved.

The write is an atomic create: no `sha` is sent, so GitHub itself refuses
to overwrite a file that already exists. That's what stops two people
claiming the same name in a race: whoever's request lands first wins, and
the second gets `409 taken`. See `putRecord` in `lib/registry.js`.

Once the file exists, the name resolves immediately: `*.runs-on.dev` is a
wildcard DNS record, so there's nothing to provision. You get a profile
card built from your GitHub account until you point the name at your own
hosting (see the main [README](../README.md#point-it-at-your-own-hosting)).

## Claiming by pull request

The site is the quick path; a pull request does the same thing by hand.
Add `domains/<name>.json` naming yourself as owner and open a PR:

```json
{
  "name": "yourname",
  "owner": { "github": "your-github-login" },
  "claimedAt": "2026-01-01T00:00:00.000Z",
  "records": {}
}
```

You can set `records` in the same PR rather than claiming empty and
pointing the name in a second one.

`validateChangeset` (`lib/pr.js`) holds this to the same gates
`evaluateClaim` applies on the site, in the same order: the record must
name its own author as owner, the name must not be reserved, `claimedAt`
may not be in the future, the account must be 30 days old with a public
repository, and it must not already hold a name. Eligibility is read from
`GET /users/<login>` and the owned-name count from `domains/` at the base
commit; if either lookup fails, the check fails with it rather than
guessing.

The one thing the site gives you that a PR cannot is the atomic create.
Two PRs claiming the same name will both pass CI, and the second to merge
produces a conflict rather than a clean `409 taken`.

## Eligibility

Claiming requires, checked by `lib/eligibility.js`:

- **Your GitHub account is at least 30 days old.**
- **Your account has at least one public repository.**

Both are enforced server-side in `POST /api/claim` via `evaluateClaim`
(`lib/claim.js`), not just in the UI.

### Why these limits exist

Names cannot be un-given once claimed except by the owner releasing them or
a maintainer pulling one under [POLICY.md](../POLICY.md). Without any
barrier to entry, a script that mints fresh GitHub accounts could sweep
every short, memorable name in the registry within the first hour of
launch, and there would be no way to get any of them back short of manual
takedowns. A 30-day-old account with at least one public repo is cheap for
a real developer and expensive for a bot farm to fake at scale, which is
the actual goal: keep the barrier low for genuine users and high for a
land-grab.

### The one-name-per-account limit

Each GitHub account may hold one claimed name at a time, enforced by
`evaluateClaim` in `lib/claim.js`: `MAX_NAMES_PER_ACCOUNT` is `1`, and a
claim past that returns `403 limit_reached`. `POST /api/claim`
(`app/api/claim/route.js`) tracks how many names an account owns in a
per-account index file, `owners/<login>.json`, read with `getOwnerIndex`
and written with `putOwnerIndex` (both in `lib/owners.js`). A successful
claim appends the new name to that account's index right after the record
itself is written.

That index is a cache, not the registry — `domains/` is. A name claimed by
pull request never runs `putOwnerIndex`, so the index would undercount and
hand the account a second name; `scripts/sync-owners.mjs` therefore
rebuilds `owners/` from `domains/` after every merge that touches a record
(`.github/workflows/sync-owners.yml`), and CI counts owned names by
scanning `domains/` directly rather than trusting the index.

This closes the same land-grab door the eligibility rules open partway:
even a 30-day-old account with a real repo could otherwise sweep a long
list of short names. The index write happens after the record write and is
not atomic with it, so a claim that races the same account twice in a
narrow window can, in the worst case, leave that account owning one name
more than the limit. The record write itself stays safe either way, since
GitHub's Contents API refuses to create a file that already exists.

## Reserved names

`GET /api/check` and `POST /api/claim` both reject a name that
`lib/blocklist.js` flags as reserved, before eligibility is even checked.
Three lists back this, documented in [`data/README.md`](../data/README.md):
infrastructure names the registry itself needs, brands actually
impersonated in the wild, and an English profanity/slur list. Matching is
exact (case-insensitive, trimmed), no substring matching, so a reserved
word appearing inside a longer valid name is fine.

## Releasing a name

Delete `domains/<name>.json` in a pull request. `lib/pr.js` requires the PR
author's GitHub login to match the record's `owner.github` for a removal to
pass CI. Once merged, `scripts/sync-dns.mjs` clears any DNS records that
had been synced for that name.

## Changing a record after claiming

Claiming leaves `records` empty, which means the name serves a profile
card. Pointing it somewhere is a separate operation with its own rules,
enforced by `lib/edit.js` for both the site (`POST /api/records`, what
`/manage` posts to) and a pull request (`lib/pr.js`): only the recorded
owner may change a record, and `owner`, `claimedAt`, and `name` never
change once set. See [records.md](./records.md) for the field reference and
[architecture.md](./architecture.md) for how the write paths differ.
