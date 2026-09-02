# Provider guides

Every guide below ends in a record that has to reach `domains/<name>.json`.
Two ways to get it there: paste it into [runs-on.dev/manage](https://runs-on.dev/manage),
which commits it for you, or open a pull request as the steps describe. The
form handles `subdomains` too, so the Bluesky, Discord, and Vercel
verification records can be set there as well.

One record type or another gets a name pointed at nine hosting providers,
a redirect, email forwarding, a Bluesky handle, and Discord verification.
Every JSON block below is a drop-in value for the `records` (or
`subdomains`) key in `domains/<name>.json`, verified against
[`lib/schema.js`](../lib/schema.js).

This file is the compact, copy-paste reference for reading on GitHub. Each
entry below also has a fuller walkthrough on the site at
`/docs/guides/<provider>` (linked per section), with the same record and
steps laid out on its own page. Start here; follow the link if you want
more detail on a specific provider.

See [docs/records.md](./records.md) for the full record format, the
CNAME-exclusivity rule, and how a merged record reaches DNS.

## URL redirect

No hosting, no DNS to configure. Visiting `you.runs-on.dev` sends the
browser to any absolute URL you choose. The redirect is served by the app
itself, not DNS. `URL` must be the only key under `records`.

```json
"records": { "URL": "https://github.com/you" }
```

Fork the registry, edit `domains/you.json` to the block above with your
own target, and open a pull request. Once merged, visiting
`https://you.runs-on.dev` should 307-redirect to your target URL within a
few seconds. Full walkthrough: [`/docs/guides/url-redirect`](https://runs-on.dev/docs/guides/url-redirect).

## Vercel

```json
"records": { "CNAME": "cname.vercel-dns.com" }
```

Add `you.runs-on.dev` as a custom domain on the Vercel project (Project →
Settings → Domains), then set the record to whatever target the Domains tab
shows you. Most projects get `cname.vercel-dns.com`; some accounts get a
project-specific `<hash>.vercel-dns-017.com` instead. Leave off any trailing
dot. Once the CNAME syncs, the Domains tab issues its own certificate.

If Vercel also shows a TXT record starting `vc-domain-verify=`, it goes at
`_vercel`, one label below your name, not beside the CNAME:

```json
{
  "records": { "CNAME": "cname.vercel-dns.com" },
  "subdomains": { "_vercel": { "TXT": ["vc-domain-verify=you.runs-on.dev,abc123"] } }
}
```

`CNAME` cannot coexist with `TXT` at the same name, so putting it in
`records` is rejected. Full walkthrough:
[`/docs/guides/vercel`](https://runs-on.dev/docs/guides/vercel).

## Netlify

```json
"records": { "CNAME": "apex-loadbalancer.netlify.com" }
```

Add `you.runs-on.dev` as a custom domain in the Netlify site's settings so
it issues a certificate for it. Full walkthrough: [`/docs/guides/netlify`](https://runs-on.dev/docs/guides/netlify).

## GitHub Pages

```json
"records": { "CNAME": "you.github.io" }
```

Replace `you` with your GitHub username or org. Add a `CNAME` file to the
Pages repo itself containing `you.runs-on.dev`, GitHub's standard
custom-domain setup, independent of this registry. Full walkthrough:
[`/docs/guides/github-pages`](https://runs-on.dev/docs/guides/github-pages).

## Cloudflare Pages

```json
"records": { "CNAME": "you-project.pages.dev" }
```

Replace `you-project` with your Pages project's own `*.pages.dev`
subdomain, then add `you.runs-on.dev` as a custom domain in the Pages
project's settings. Full walkthrough: [`/docs/guides/cloudflare-pages`](https://runs-on.dev/docs/guides/cloudflare-pages).

## Render

```json
"records": { "CNAME": "you-service.onrender.com" }
```

Replace `you-service` with your service's own `*.onrender.com` hostname,
shown at the top of the service page in the Render dashboard. In the
Render dashboard: Settings → Custom Domains → Add Custom Domain →
`you.runs-on.dev`; Render verifies the CNAME and issues a certificate on
its own. Full walkthrough: [`/docs/guides/render`](https://runs-on.dev/docs/guides/render).

## Railway

```json
"records": { "CNAME": "abcd12.up.railway.app" }
```

Railway generates a unique `*.up.railway.app` target per custom domain
(Settings → Networking → Custom Domain); copy the exact value shown, not
the stand-in above. Railway also asks for a verification TXT record at the
same hostname as the CNAME, which this registry cannot express: `CNAME`
cannot coexist with `TXT` at the same name, a DNS constraint, not a choice
this registry made. If Railway shows that TXT record at a *different*
hostname instead, add it under `subdomains` at that label. Full
walkthrough: [`/docs/guides/railway`](https://runs-on.dev/docs/guides/railway).

## Firebase Hosting

```json
"records": { "A": ["199.36.158.100"] }
```

Firebase's Quick Setup (Hosting → Add custom domain → Quick Setup) shows
this same IP for every project; Firebase can change it, so use whatever
value the console actually shows you. Verification and certificate
issuance can take a few hours. Full walkthrough: [`/docs/guides/firebase`](https://runs-on.dev/docs/guides/firebase).

## Replit

```json
"records": {
  "A": ["192.0.2.1"],
  "TXT": ["replit-verify=abc123"]
}
```

Both values are generated per domain in Replit's manual-setup flow
(your deployment → Publishing → Domains → Manual Setup), so copy the exact
values Replit shows rather than the stand-ins above. `A` and `TXT` coexist
at the same name, which is what Replit needs: the TXT record stays in
place permanently, since Replit reuses it for certificate renewal. Full
walkthrough: [`/docs/guides/replit`](https://runs-on.dev/docs/guides/replit).

## Codeberg Pages

```json
"records": { "CNAME": "codeberg.page" }
```

Codeberg's own docs write this target with a trailing dot
(`codeberg.page.`); the schema validates `CNAME` as a plain hostname and
rejects the trailing dot, so leave it off. The DNS record created is
equivalent either way. The current Pages server treats the CNAME itself as
authorization, so there's no separate `.domains` file to add to the Pages
repo. Full walkthrough: [`/docs/guides/codeberg-pages`](https://runs-on.dev/docs/guides/codeberg-pages).

## Email forwarding

```json
"records": {
  "MX": [
    { "priority": 10, "value": "mx1.improvmx.com" },
    { "priority": 20, "value": "mx2.improvmx.com" }
  ]
}
```

`mx1.improvmx.com` and `mx2.improvmx.com` at priorities 10 and 20 are
[ImprovMX](https://improvmx.com)'s standard mail servers, the same for
every domain; the [records](./records.md#fields) doc also shows
[ForwardEmail](https://forwardemail.net)'s equivalent. `MX` coexists with
`A` and `TXT` at the same name, so this is safe to add even if
`you.runs-on.dev` already points at a site. Add `you.runs-on.dev` as a
domain at your forwarding provider and set up an alias before opening the
pull request. Full walkthrough: [`/docs/guides/email-forwarding`](https://runs-on.dev/docs/guides/email-forwarding).

## Bluesky handle

```json
"subdomains": {
  "_atproto": { "TXT": ["did=did:plc:abc123"] }
}
```

Bluesky verifies a custom domain as your handle by checking for a TXT
record at `_atproto.you.runs-on.dev` containing your account's DID
(Settings → Advanced → your DID, in the Bluesky app). Replace the DID
above with your own, then in Bluesky: Settings → Account → Handle → I have
my own domain → enter `you.runs-on.dev` → No DNS Panel → Verify DNS
Record. Full walkthrough: [`/docs/guides/bluesky-handle`](https://runs-on.dev/docs/guides/bluesky-handle).

## Discord verification

```json
"subdomains": {
  "_discord": { "TXT": ["dh=0f817e9945292eb7eaba294fbba9b6f50d74a885"] }
}
```

Discord verifies domain ownership (for a linked-role application, or a
domain attached to your profile) by checking for a TXT record at
`_discord.you.runs-on.dev`. The `dh=...` value is generated per domain by
Discord when you start verification; replace the example above with your
own, then click Verify back in Discord. Full walkthrough:
[`/docs/guides/discord-verification`](https://runs-on.dev/docs/guides/discord-verification).
