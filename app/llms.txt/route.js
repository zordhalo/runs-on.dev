// Plain-text summary for AI assistants and crawlers. Regenerated on each
// deploy from static facts below, no data fetch needed.
export const dynamic = 'force-static';

function block(title, lines) {
  return `## ${title}\n\n${lines.filter(Boolean).join('\n')}\n`;
}

function buildLlmsTxt() {
  const sections = [
    '# runs-on.dev\n\n> A free subdomain registry. Sign in with GitHub, claim a name like you.runs-on.dev, and point it at your own hosting.\n',

    block('What this is', [
      'runs-on.dev is a subdomain registry, not a top-level domain. A real TLD means an ICANN application (the 2026 round\'s evaluation fee alone is $227,000) plus operating a registry. This gets the same distinctive-address feeling for about $10 a year by giving away subdomains under one registered domain.',
      'Prior art: is-a.dev, js.org, eu.org.',
    ]),

    block('How to claim', [
      'Go to https://runs-on.dev, sign in with GitHub, and type a name. If it\'s available, claiming it writes a record to domains/<name>.json in the public registry and the name is live within seconds, no DNS to configure.',
      'Eligibility: the GitHub account must be at least 30 days old with at least one public repository. One name per account.',
    ]),

    block('How to point a name at your own hosting', [
      'Two ways. From the site: sign in and open https://runs-on.dev/manage, pick a record type, fill it in, and save; it commits to domains/<name>.json and DNS follows within seconds. Or by pull request: edit domains/<name>.json, which CI validates against the schema, and DNS is updated on merge. Both enforce the same rules and both can set records and subdomains entries. Supported types: CNAME (a hostname, alone), A (array of IPv4), TXT (array of strings, up to 255 chars each), MX (array of { priority, value }, 1 to 5 entries, may coexist with A and TXT), and URL (an absolute http(s) redirect served by the app itself, alone, no DNS). An optional subdomains object adds one-level-deep records (e.g. _atproto or _discord) under the claimed name, same types except URL, up to 10 entries.',
      'Full record reference: https://runs-on.dev/docs/records. Copy-paste guides for hosts (Vercel, Netlify, GitHub Pages, Cloudflare Pages, Render, Railway, Firebase Hosting, Replit, Codeberg Pages), email forwarding, and social verification (Bluesky, Discord): https://runs-on.dev/docs/guides',
    ]),

    block('The rules', [
      'Names are free and may be reclaimed if dormant, or immediately for impersonation, phishing, malware, or illegal content, no warning required. Full policy: https://runs-on.dev/policy',
      'Report abuse: abuse@runs-on.dev',
    ]),

    block('Links', [
      '- Claim a name: https://runs-on.dev',
      '- Docs: https://runs-on.dev/docs',
      '- Quickstart: https://runs-on.dev/docs/quickstart',
      '- Record reference: https://runs-on.dev/docs/records',
      '- Guides: https://runs-on.dev/docs/guides',
      '- SEO on a name: https://runs-on.dev/docs/seo',
      '- About: https://runs-on.dev/about',
      '- FAQ: https://runs-on.dev/faq',
      '- Policy: https://runs-on.dev/policy',
      '- Registry source: https://github.com/zordhalo/runs-on.dev',
      '- Operated by Advance Labs: https://advancelabs.dev',
    ]),
  ];

  return sections.join('\n');
}

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
