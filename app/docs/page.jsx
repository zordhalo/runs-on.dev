import { Section } from '../components/Section.jsx';
import { Eyebrow, DocTitle, Lede, DocList } from './components.jsx';

export const metadata = {
  title: 'Docs',
  description: 'Documentation for runs-on.dev: quickstart, the full record reference, provider guides, and where to find the source.',
  alternates: { canonical: 'https://runs-on.dev/docs' },
  openGraph: { title: 'Docs — runs-on.dev' },
};

export default function Docs() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs</Eyebrow>
      <DocTitle>Documentation</DocTitle>
      <Lede>
        A claimed name serves a profile card until you point it somewhere else. Pointing it
        anywhere, including nowhere, is one JSON file, changed from the site or by pull request.
      </Lede>

      <Section title="Start here">
        <DocList
          items={[
            { href: '/docs/quickstart', label: 'Quickstart', note: 'claim a name and get it working, end to end' },
            { href: '/docs/records', label: 'Record reference', note: 'every field, every record type, the rules' },
            { href: '/docs/guides', label: 'Guides', note: 'copy-paste walkthroughs for hosts, email, and verification' },
            { href: '/docs/seo', label: 'SEO', note: 'how search engines treat a name, and what is per host' },
            { href: '/docs/resources', label: 'Resources', note: 'the repo, the schema, abuse reporting, the policy' },
          ]}
        />
      </Section>

      <Section title="Guides">
        <DocList
          items={[
            { href: '/docs/guides/url-redirect', label: 'URL redirect', note: 'no hosting needed' },
            { href: '/docs/guides/vercel', label: 'Vercel' },
            { href: '/docs/guides/netlify', label: 'Netlify' },
            { href: '/docs/guides/github-pages', label: 'GitHub Pages' },
            { href: '/docs/guides/cloudflare-pages', label: 'Cloudflare Pages' },
            { href: '/docs/guides/render', label: 'Render' },
            { href: '/docs/guides/railway', label: 'Railway' },
            { href: '/docs/guides/firebase', label: 'Firebase Hosting' },
            { href: '/docs/guides/replit', label: 'Replit' },
            { href: '/docs/guides/codeberg-pages', label: 'Codeberg Pages' },
            { href: '/docs/guides/email-forwarding', label: 'Email forwarding', note: 'MX, with ImprovMX' },
            { href: '/docs/guides/bluesky-handle', label: 'Bluesky handle', note: '_atproto TXT' },
            { href: '/docs/guides/discord-verification', label: 'Discord verification', note: '_discord TXT' },
          ]}
        />
      </Section>
    </main>
  );
}
