<p align="center">
  <a href="https://runs-on.dev">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="https://runs-on.dev/opengraph-image">
      <img src="https://runs-on.dev/banner-dark" alt="runs-on.dev" width="820">
    </picture>
  </a>
</p>

<h1 align="center">runs-on.dev</h1>

<p align="center">
  Free subdomains for developers. Claim <code>yourname.runs-on.dev</code> in seconds,
  then point it wherever you like.
</p>

<p align="center">
  <a href="https://runs-on.dev"><b>Claim a name</b></a>
  &nbsp;·&nbsp;
  <a href="https://runs-on.dev/docs/quickstart">Quickstart</a>
  &nbsp;·&nbsp;
  <a href="https://runs-on.dev/docs/guides">Guides</a>
  &nbsp;·&nbsp;
  <a href="https://runs-on.dev/docs/records">Records</a>
  &nbsp;·&nbsp;
  <a href="https://runs-on.dev/policy">Policy</a>
</p>

<p align="center">
  <a href="https://github.com/zordhalo/runs-on.dev/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/zordhalo/runs-on.dev?label=stars&color=1b4dff"></a>
  <a href="https://github.com/zordhalo/runs-on.dev/tree/main/domains"><img alt="names claimed" src="https://img.shields.io/github/directory-file-count/zordhalo/runs-on.dev/domains?type=file&extension=json&label=names%20claimed&color=1b4dff"></a>
  <a href="https://github.com/zordhalo/runs-on.dev/actions/workflows/test.yml"><img alt="tests" src="https://github.com/zordhalo/runs-on.dev/actions/workflows/test.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-informational"></a>
</p>

---

Claiming a name writes one file to this repository. That file is the record. It is the only
thing that makes the name resolve, and you can read it without asking anyone.

```json
{
  "name": "yourname",
  "owner": { "github": "yourname" },
  "claimedAt": "2026-01-01T00:00:00.000Z",
  "records": {}
}
```

There is no hidden database. The registry is this directory, the history is the git log, and
the rules are in `lib/`.

## Why this exists

A real top-level domain means an ICANN application. The 2026 round's
evaluation fee alone is $227,000, before you've built or run a registry to
back it. That's not a plausible way to get a custom-looking address for a
side project.

`runs-on.dev` gets the same feeling: a distinctive ending instead of
`vercel.app` or `github.io`, for the price of one domain, about $10 a
year, by giving away subdomains under it. This is a subdomain registry,
not a TLD. Every name you claim lives under `runs-on.dev`, which Advance
Labs registered and is responsible for. Saying that plainly, instead of
dressing it up as something bigger, is the whole basis for trusting it.
There's prior art doing exactly this: [is-a.dev](https://www.is-a.dev),
[js.org](https://js.org), [eu.org](https://eu.org).

## Claim a name

Go to [runs-on.dev](https://runs-on.dev), sign in with GitHub, and type
the name you want. If it's available, claiming it writes a record to
`domains/<name>.json` in this repo, as shown above, and the name is live
within seconds. One name per GitHub account. See
[docs/claiming.md](./docs/claiming.md) for eligibility rules, the
per-account limit, and why they exist.

## Point it at your own hosting

By default a claimed name serves a small profile card built from your
GitHub account. To point it at your own site, forward email, or a plain
redirect instead, there are two ways to change its record.

**From the site.** Sign in and open
[runs-on.dev/manage](https://runs-on.dev/manage). Pick a record type, fill
it in, and save. That writes a commit to `domains/<name>.json` in this
repository, exactly as a merged pull request would, and DNS follows within
seconds. The form offers the record types in the combinations DNS actually
permits, so it cannot build a record the schema would reject.

**By pull request.** Still supported, and the right choice when you want the
change reviewed before it lands:

1. Fork this repo.
2. Edit `domains/<name>.json`, adding a record under `records` (and
   optionally `subdomains`, for a one-level-deep entry like `_atproto`).
3. Open a pull request. CI validates the change against
   [`schema/record.schema.json`](./schema/record.schema.json); once it's
   green and merged, a workflow pushes the record to DNS automatically.

Both paths enforce the same rules, from the same code in
[`lib/edit.js`](./lib/edit.js): only the owner may change a record, and
`owner`, `claimedAt`, and `name` are immutable once set.

| Type | Shape | Coexistence |
| --- | --- | --- |
| `CNAME` | a hostname string | Alone: cannot sit next to `A`, `TXT`, or `MX`. |
| `A` | 1+ IPv4 addresses | With `TXT`, `MX`. |
| `TXT` | 1+ strings, up to 255 chars each | With `A`, `MX`. |
| `MX` | 1 to 5 `{ priority, value }` entries | With `A`, `TXT`. |
| `URL` | one absolute `http(s)://` string | Alone: cannot sit next to anything, not allowed under `subdomains`. |

Nine hosting providers, a URL redirect, email forwarding, a Bluesky
handle, and Discord verification, each with the exact record to copy, are
in [docs/guides.md](./docs/guides.md). The same walkthroughs render on the
site at `/docs/guides/<provider>` with more detail per provider; the
markdown file is the compact version for reading here.

Once a name serves your own site, [docs/seo.md](./docs/seo.md) covers what
changes when that site lives on a subdomain: `robots.txt` and sitemaps are
per host rather than per domain, redirect names cannot rank, and a name
needs its own Search Console property.

<details>
<summary>Two worked examples</summary>

Vercel, the shortest path from claim to a live custom domain:

```json
"records": { "CNAME": "cname.vercel-dns.com" }
```

Add `you.runs-on.dev` as a custom domain on the Vercel project; it shows
you this same CNAME target.

A Bluesky handle, which needs no hosting at all, just a subdomain entry:

```json
"subdomains": {
  "_atproto": { "TXT": ["did=did:plc:abc123"] }
}
```

Full record reference, the `subdomains` grammar, and why `CNAME` can't
coexist with anything else: [docs/records.md](./docs/records.md).

</details>

## How it works

A single wildcard `*.runs-on.dev` DNS record points every possible
subdomain at one Vercel project, so an unclaimed or record-less name still
resolves with a valid HTTPS certificate and gets served the profile-card
page. Claiming a name is therefore a git commit, not a DNS write. Pointing
a name at your own hosting merges a record into `domains/<name>.json`, and
a GitHub Actions workflow pushes that exact record to Vercel's DNS API on
merge, which then takes priority over the wildcard for that one name. More
detail, including the two write paths and the token split, in
[docs/architecture.md](./docs/architecture.md).

## The rules

Everything CI checks on a `domains/**` pull request, so you can verify a
PR yourself before opening it:

- One file per pull request.
- The path must match `domains/<name>.json`, matching
  `^domains/([a-z0-9-]+)\.json$`.
- Renaming a record is refused outright. Claim a new name instead.
- `owner` and `claimedAt` are immutable once set; only the recorded owner
  may edit or remove a record.
- New names may be claimed either on the site or by pull request. Both
  paths apply the same gates: the record must name its own author as
  owner, the name must not be reserved, the account must be at least 30
  days old with one public repository, and it must not already hold a
  name.
- An owner may delete their own record by pull request; a maintainer can
  do the same under [POLICY.md](./POLICY.md).

See [`lib/pr.js`](./lib/pr.js) for the implementation CI actually runs,
and [docs/contributing.md](./docs/contributing.md) for the full breakdown
of what it checks.

<details>
<summary>Self-hosting</summary>

This is an open registry, not a hosted product with a private backend.
Running your own copy under a domain you own means:

- Fork this repo and rename it; `REGISTRY_REPO` in `.env.example` points
  at wherever the fork lives.
- Register your own domain, point a wildcard record at your deployment,
  and add it to Vercel (or adapt `scripts/sync-dns.mjs` and `lib/dns.js`
  for a different DNS provider).
- Change `ROOT` in `proxy.js` and the hostname literals in `app/page.jsx`
  and `app/sites/[name]/page.jsx` from `runs-on.dev` to your domain.
- Create your own GitHub OAuth app and set `GITHUB_CLIENT_ID` /
  `GITHUB_CLIENT_SECRET`.
- Review `data/reserved-*.json` and adjust `lib/eligibility.js` for your
  own abuse tolerance.

</details>

<details>
<summary>Local development</summary>

```bash
npm install
npm run dev
```

The claim flow needs a signed-in GitHub session, and the session and
OAuth cookies are set `Secure` (see `app/api/auth/github/route.js` and
`.../callback/route.js`). A `Secure` cookie is dropped by the browser over
plain HTTP, so the GitHub sign-in flow cannot be exercised on
`http://localhost`. This is correct for production: `runs-on.dev` is on
the HSTS preload list, so it's always HTTPS there, and a cookie that only
ever travels over HTTPS shouldn't get a `Secure`-free code path just for
local convenience.

To exercise sign-in locally, serve the app over HTTPS with a
locally-trusted certificate,
[mkcert](https://github.com/FiloSottile/mkcert) being the simplest way:

```bash
mkcert -install
mkcert localhost
```

Then run `next dev` behind a TLS-terminating proxy pointed at it, and set
`APP_ORIGIN` to the `https://` URL you're serving from so the OAuth
redirect URI matches. Everything that doesn't touch sign-in, name
validation, schema checks, the blocklist, the record UI, works over plain
`http://localhost` without any of this. See
[.env.example](./.env.example) for every variable the app reads.

</details>

## Star the registry

Every name claimed here is one commit in this repo, authored under the
claimant's own GitHub account. If you have a name, you're already in the log —
a star keeps the registry easy for the next person to find.

## Contributing

Bug fixes, blocklist additions, and doc improvements are welcome. See
[docs/contributing.md](./docs/contributing.md) for how to add to the
blocklists, run the tests, and what CI checks.

```bash
npm install
npm test
```

## License

The code in this repository is [MIT licensed](./LICENSE). The bundled
profanity blocklist (`data/reserved-words.json`) is seeded from
[LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
(English list) and keeps its own
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license; see
[data/README.md](./data/README.md).

## Credits

The idea of giving away free subdomains under one registered domain isn't
new; credit to [is-a.dev](https://www.is-a.dev) for the prior art, and to
[js.org](https://js.org) and [eu.org](https://eu.org) for more of it.

---

Operated by [Advance Labs](https://advancelabs.dev), which registered
`runs-on.dev` and is the party responsible for what runs under it. See
[POLICY.md](./POLICY.md).
