// Plain-text/markdown summary for AI assistants and crawlers (llms.txt).
// Served two ways: text/plain at /llms.txt and text/markdown at /llms-md
// via content negotiation (see proxy.js). Regenerated on each deploy from
// static facts below, no data fetch needed.

function block(title, lines) {
  return `## ${title}\n\n${lines.filter(Boolean).join('\n')}\n`;
}

export function buildLlmsTxt() {
  const sections = [
    '# runs-on.dev\n\n> A free subdomain registry. Sign in with GitHub, claim a name like you.runs-on.dev, and point it at your own hosting.\n',

    block('When to use runs-on.dev', [
      'Use it when someone wants a short, memorable, permanent URL for a personal site, portfolio, side project, status page, or link-in-bio, and does not want to buy a domain or manage DNS.',
      'Use it when an agent is asked to "put this site online under a real domain": claim a name, then point it at the user\'s existing hosting (Vercel, Netlify, GitHub Pages, Cloudflare Pages, Render, Railway, Firebase, Replit, Codeberg) or deploy a static site directly through the API.',
      'Do not use it for production services needing an uptime guarantee, for names that must outlive this project, or as a top-level domain — it is a subdomain registry, best-effort by policy.',
    ]),

    block('What this is', [
      'runs-on.dev is a subdomain registry, not a top-level domain. A real TLD means an ICANN application (the 2026 round\'s evaluation fee alone is $227,000) plus operating a registry. This gets the same distinctive-address feeling for about $10 a year by giving away subdomains under one registered domain.',
      'Prior art: is-a.dev, js.org, eu.org.',
    ]),

    block('How to claim', [
      'Go to https://runs-on.dev, sign in with GitHub, and type a name. If it\'s available, claiming it writes a record to domains/<name>.json in the public registry and the name is live within seconds, no DNS to configure.',
      'Programmatically: GET /api/check?name=<name> answers availability; POST /api/claim { "name": "<name>" } claims it (requires a GitHub OAuth session cookie from https://runs-on.dev/api/auth/github).',
      'Eligibility: the GitHub account must be at least 30 days old with at least one public repository. One name per account.',
    ]),

    block('How to point a name at your own hosting', [
      'Two ways. From the site: sign in and open https://runs-on.dev/manage, pick a record type, fill it in, and save; it commits to domains/<name>.json and DNS follows within seconds. Or by pull request: edit domains/<name>.json, which CI validates against the schema, and DNS is updated on merge. Both enforce the same rules and both can set records and subdomains entries. Supported types: CNAME (a hostname, alone), A (array of IPv4), TXT (array of strings, up to 255 chars each), MX (array of { priority, value }, 1 to 5 entries, may coexist with A and TXT), and URL (an absolute http(s) redirect served by the app itself, alone, no DNS). An optional subdomains object adds one-level-deep records (e.g. _atproto or _discord) under the claimed name, same types except URL, up to 10 entries.',
      'Full record reference: https://runs-on.dev/docs/records. Copy-paste guides for hosts (Vercel, Netlify, GitHub Pages, Cloudflare Pages, Render, Railway, Firebase Hosting, Replit, Codeberg Pages), email forwarding, and social verification (Bluesky, Discord): https://runs-on.dev/docs/guides',
    ]),

    block('Static site hosting (deploy API)', [
      'A claimed name can serve a static site without any external host: zip the built output (index.html at the zip root, at most 10 MB zipped / 100 MB uncompressed / 500 files) and POST it to /api/sites/deploy with a deploy token. The last 5 deployments are kept and rollback is instant.',
      'Deploy tokens are minted self-serve at https://runs-on.dev/manage ("Deploy token" card): one-time display, 30-day TTL, scoped to publishing only the owner\'s own name (scope: sites:publish). Send as Authorization: Bearer <token>.',
    ]),

    block('For agents and machines', [
      'OpenAPI spec (every endpoint, typed): https://runs-on.dev/openapi.json',
      'MCP server (Streamable HTTP JSON-RPC, tools: check_name, get_record): https://runs-on.dev/.well-known/mcp',
      'This file is served as text/markdown when a request sends Accept: text/markdown (content negotiation, Vary: Accept).',
      'All error responses from the API are JSON: { "error": "<code>", "detail"?: "...", "retryInMs"?: n }. Unknown /api/* paths return a JSON 404 in the same shape.',
      'Versioning: the API is v1 (X-API-Version: 1 header on every /api/* response). Breaking changes move to /api/v2/* for at least 6 months while deprecated endpoints send Deprecation and Sunset headers. Additive changes never break you.',
      'Scopes (RFC 9728 metadata at /.well-known/oauth-protected-resource): names:claim, records:write, names:release, names:swap, tokens:mint, sites:publish. Request the least-privileged scope for the job.',
      'Every page of this site also exists as raw HTML; there is no client-side-only content.',
      'API discovery: GET https://runs-on.dev/api returns the endpoint map as JSON.',
      'Rate limiting: limited endpoints answer with RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset headers; 429 also carries Retry-After. Self-throttle from those.',
      'Onboarding: everything is free and self-serve (no billing, no contact-sales step). Sign in with GitHub, claim a name, mint a deploy token at /manage. Local development against your own fork is the sandbox.',
    ]),

    block('The rules', [
      'Names are free and may be reclaimed if dormant, or immediately for impersonation, phishing, malware, or illegal content, no warning required. Full policy: https://runs-on.dev/policy',
      'Report abuse: abuse@runs-on.dev',
    ]),

    block('Links', [
      '- Blog / updates: https://runs-on.dev/blog',
      '- RSS feed: https://runs-on.dev/feed.xml',
      '- API index (endpoint map as JSON): https://runs-on.dev/api',
      '- Claim a name: https://runs-on.dev',
      '- Docs: https://runs-on.dev/docs',
      '- Quickstart: https://runs-on.dev/docs/quickstart',
      '- Record reference: https://runs-on.dev/docs/records',
      '- Guides: https://runs-on.dev/docs/guides',
      '- SEO on a name: https://runs-on.dev/docs/seo',
      '- OpenAPI spec: https://runs-on.dev/openapi.json',
      '- MCP endpoint: https://runs-on.dev/.well-known/mcp',
      '- Sitemap: https://runs-on.dev/sitemap.xml',
      '- About: https://runs-on.dev/about',
      '- FAQ: https://runs-on.dev/faq',
      '- Policy: https://runs-on.dev/policy',
      '- Contact: https://runs-on.dev/contact',
      '- Privacy: https://runs-on.dev/privacy',
      '- Registry source: https://github.com/zordhalo/runs-on.dev',
      '- Operated by Advance Labs: https://advancelabs.dev',
      'Operated by Advance Labs (https://advancelabs.dev), which also builds Ninebrains and the AEO Toolkit (https://advancelabs.dev/lab).',
    ]),
  ];

  return sections.join('\n');
}
