# Record format

Every claimed name is one JSON file at `domains/<name>.json`, validated
against [`schema/record.schema.json`](../schema/record.schema.json) and
`lib/schema.js`'s `validateRecord`. No key outside this shape is allowed.

```json
{
  "name": "you",
  "owner": { "github": "you" },
  "claimedAt": "2026-01-01T00:00:00.000Z",
  "records": {}
}
```

## Fields

### `name`

The subdomain, lowercase. Validated by `lib/name.js`: 2–32 characters,
`[a-z0-9]` with internal hyphens (never leading or trailing), and no
punycode (`xn--` prefixes and `--` at the third/fourth character are
rejected). Must match the filename: `domains/you.json` must contain
`"name": "you"`.

### `owner`

Exactly one key, `github`, the GitHub login that owns the record. Set once
at claim time and immutable afterward. `lib/edit.js` rejects any change to
it, and both write paths that can edit a record — the site and a pull
request — go through it.

### `claimedAt`

An ISO 8601 timestamp, set once when the name is claimed. Also immutable,
by either path.

### `records`

An object holding zero or more record types. An empty `records` object is
valid. It's the default state right after claiming, and it means the name
serves the built-in profile card instead of pointing anywhere else.

| Type | Shape | Notes |
| --- | --- | --- |
| `CNAME` | a single hostname string | Cannot appear alongside `A`, `TXT`, or `MX`. |
| `A` | a non-empty array of IPv4 addresses | One DNS record is created per address. |
| `TXT` | a non-empty array of strings, each up to 255 characters | One DNS record per string. |
| `MX` | a non-empty array (max 5) of `{ "priority": 0-65535, "value": "<hostname>" }` | Cannot appear alongside `CNAME`; may coexist with `A` and `TXT`. |
| `URL` | a single absolute `http://` or `https://` string | Cannot appear alongside any other record type. No DNS record is created; see [URL redirects](#url-redirects) below. |

### `subdomains`

An optional object, keyed by label, letting an owner set records at a
subdomain of their claimed name instead of at the name itself, for example
`_atproto.you` for a Bluesky handle or `_discord.you` for Discord
verification.

```json
"subdomains": {
  "_atproto": { "TXT": ["did=did:plc:abc123"] }
}
```

- At most 10 entries.
- Each label matches `^_?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, the same
  grammar as `name`, plus one optional leading underscore, and no dots (a
  subdomain is exactly one level deep).
- Each value holds `A`, `TXT`, `CNAME`, or `MX` under the same coexistence
  rules as the root `records` object. `URL` is not allowed on a
  subdomain. The app only ever looks up the claimed name itself, so a
  redirect record there could never be served.
- The resulting full name (`<label>.<name>.runs-on.dev`) must stay within
  the 253-character DNS name limit.

`lib/dns.js`'s `planDnsChanges` emits these as `<label>.<name>` DNS entries,
so `_atproto` under `you` becomes `_atproto.you`.

### The `_vercel` zone mirror

`_vercel` is the one label with a second life. Vercel reads its ownership
challenge for `<name>.runs-on.dev` from `_vercel.runs-on.dev` — zone level,
one label ABOVE every claim — because the apex itself sits in a Vercel
account. No claim file can express that host: `subdomains` records are
always children of the claim's own name. So `sync-dns` mirrors every
claim's `_vercel` TXT values to the zone-level host as well; TXT values
coexist on one host, so each claim's `vc-domain-verify=…` string sits there
alongside everyone else's. Reconciliation only ever deletes zone-level TXTs
whose value starts `vc-domain-verify=` and is claimed by nobody — anything
an operator places at that host by hand survives every sync.

## `profile`

An optional object controlling what the profile card shows at
`<name>.runs-on.dev` when the name has no DNS records pointing it
elsewhere. Every field is optional and falls back to the owner's GitHub
profile; `links` exist only here.

```json
"profile": {
  "name": "Your Display Name",
  "bio": "A line about what you build",
  "links": [
    { "label": "Portfolio", "url": "https://your-site.example.com" },
    { "label": "GitHub", "url": "https://github.com/your-login" }
  ]
}
```

- `name`: 1–60 characters, replaces the GitHub display name.
- `bio`: 1–200 characters, replaces the GitHub bio.
- `links`: 1–8 entries of `{ "label": 1–40 chars, "url": absolute
  http(s) URL }`. Links render as rows on the card, so each URL is held to
  the same scheme rules as a `URL` record: `javascript:`, `data:`, and
  protocol-relative forms are rejected.
- No other keys. The card art also feeds a shareable banner at
  `https://runs-on.dev/banner/<name>` (add `?theme=dark` for GitHub
  READMEs) and the social preview when the link is shared.

## Why CNAME can't coexist with other record types

This isn't a rule the registry invented. It's a DNS protocol constraint.
A CNAME record aliases a name to another name entirely, and the DNS spec
doesn't allow a name that has a CNAME to have any other record type
alongside it (an A record at the same name, for instance, would leave a
resolver with two contradictory answers for what the name actually is).
`lib/schema.js` enforces this at the record level, `records.CNAME` cannot
appear next to `records.A`, `records.TXT`, or `records.MX`, so a change
that would produce invalid DNS is rejected in CI before it ever reaches
`scripts/sync-dns.mjs`. The same rule applies inside each `subdomains`
entry.

If you need both a routing target and a TXT record (a domain-verification
string, for example), use `A` with your host's IP addresses instead of
`CNAME`, since `A` and `TXT` may coexist.

## Hosting worked examples

All four are drop-in `records` values, verified against the schema above.

### Vercel

```json
"records": { "CNAME": "cname.vercel-dns.com" }
```

The Vercel dashboard shows this exact value when you add a custom domain to
a project (Project → Settings → Domains).

### GitHub Pages

```json
"records": { "CNAME": "you.github.io" }
```

Replace `you` with your GitHub username or org. You'll also need a `CNAME`
file in the Pages repo itself containing `you.runs-on.dev`, which is
GitHub's standard custom-domain setup, independent of this registry.

### Netlify

```json
"records": { "CNAME": "apex-loadbalancer.netlify.com" }
```

Then add `you.runs-on.dev` as a custom domain in the Netlify site's
settings so it can issue a TLS certificate for it.

### Cloudflare Pages

```json
"records": { "CNAME": "you-project.pages.dev" }
```

Replace `you-project` with your Pages project's own `*.pages.dev`
subdomain, then add `you.runs-on.dev` as a custom domain in the Pages
project's settings.

### URL redirect

```json
"records": { "URL": "https://github.com/you" }
```

The only record type that needs no hosting at all: a plain short link to a
profile, project, or anything else. See [URL redirects](#url-redirects)
below for how this is served and what's rejected.

### Email forwarding

```json
"records": {
  "MX": [
    { "priority": 10, "value": "mx1.forwardemail.net" },
    { "priority": 20, "value": "mx2.forwardemail.net" }
  ]
}
```

Point `you@you.runs-on.dev` at a forwarding provider's MX hosts (the values
above are [ForwardEmail](https://forwardemail.net)'s; use whatever your
provider gives you). `MX` may coexist with `A` and `TXT` at the same name.

### Bluesky handle verification

```json
"subdomains": {
  "_atproto": { "TXT": ["did=did:plc:abc123"] }
}
```

Bluesky verifies a custom handle by looking up a TXT record at
`_atproto.<handle>`. With this in place, `you.runs-on.dev` can be set as
the Bluesky handle directly, and `did:plc:abc123` should be your account's
actual DID (Settings → Advanced → your DID, in the Bluesky app).

## URL redirects

A `URL` record has no DNS representation. A `CNAME`, `A`, or `TXT` record
is a DNS-level pointer, but a `URL` redirect is served by the app itself.
The wildcard `*.runs-on.dev` record already routes every claimed name to
the app, so when a record's `records` object holds only `URL`,
`app/sites/[name]/page.jsx` issues a 307 redirect to that URL instead of
rendering the profile card. `lib/dns.js`'s `planDnsChanges` ignores `URL`
entirely; it plans no DNS change for it.

Because this makes a `runs-on.dev` name an open redirector for whatever URL
is in the file, the target is validated as an absolute `http://` or
`https://` URL and nothing else. `javascript:`, `data:`, `vbscript:`, and
protocol-relative (`//evil.com`) values are all rejected. This is enforced
twice: in `lib/schema.js`'s `validateRecord` (so CI refuses a bad value at
review time) and again at render time in `page.jsx` (so a record merged
before a validation rule tightened can't slip through).

## How a record reaches DNS

Merging a PR that changes `domains/<name>.json` triggers
[`.github/workflows/sync-dns.yml`](../.github/workflows/sync-dns.yml),
which runs `scripts/sync-dns.mjs`. It computes the desired DNS records from
your file via `lib/dns.js`'s `planDnsChanges`, deletes whatever was synced
for that name before, and creates the new set through Vercel's domains API.
If you remove your record instead of editing it, the same workflow clears
any DNS it had created for that name. You never touch DNS directly.
