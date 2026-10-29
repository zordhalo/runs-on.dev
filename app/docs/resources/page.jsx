import { Section, Quote } from '../../components/Section.jsx';
import { C, Eyebrow, DocTitle, Lede, DocList } from '../components.jsx';

export const metadata = {
  title: 'Resources',
  description: 'Where to find the runs-on.dev registry, the record schema, how to report abuse, and where the policy lives.',
  alternates: { canonical: 'https://runs-on.dev/docs/resources' },
  openGraph: { title: 'Resources · runs-on.dev' },
};

export default function Resources() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Resources</Eyebrow>
      <DocTitle>Resources</DocTitle>
      <Lede>The source, the schema, and where to go if something is wrong.</Lede>

      <Section title="The registry">
        <p className="text-sm leading-relaxed sm:text-base">
          Every claimed name is a JSON file in a public GitHub repo. There is no hidden database:
          what you see in the repo is what resolves.
        </p>
        <DocList
          items={[
            { href: 'https://github.com/zordhalo/runs-on.dev', label: 'zordhalo/runs-on.dev', note: 'the registry, the app, and this site' },
            { href: 'https://github.com/zordhalo/runs-on.dev/tree/main/domains', label: 'domains/', note: 'every claimed record, one file per name' },
          ]}
        />
      </Section>

      <Section title="The schema">
        <p className="text-sm leading-relaxed sm:text-base">
          What CI actually checks on every pull request. See{' '}
          <a className="text-(--color-signal) underline" href="/docs/records">the record reference</a>{' '}
          for the readable version.
        </p>
        <DocList
          items={[
            { href: 'https://github.com/zordhalo/runs-on.dev/blob/main/lib/schema.js', label: 'lib/schema.js', note: 'validateRecord, the source of truth' },
            { href: 'https://github.com/zordhalo/runs-on.dev/blob/main/schema/record.schema.json', label: 'schema/record.schema.json', note: 'the JSON Schema mirror' },
          ]}
        />
      </Section>

      <Section title="For machines and agents">
        <p className="text-sm leading-relaxed sm:text-base">
          Everything an agent or script needs is a plain file or a JSON endpoint. Send
        <C>Accept: text/markdown</C> on any page of this site and you get the agent index as
          markdown instead of HTML.
        </p>
        <DocList
          items={[
            { href: '/openapi.json', label: '/openapi.json', note: 'the full API spec: every endpoint, typed, with auth scopes' },
            { href: '/.well-known/mcp', label: '/.well-known/mcp', note: 'MCP server: public lookups, plus DNS and deploys with a token (guide: /docs/mcp)' },
            { href: '/llms.txt', label: '/llms.txt', note: 'agent index: when to use this site, how to claim and deploy' },
            { href: '/sitemap.xml', label: '/sitemap.xml', note: 'every page' },
            { href: '/docs/records', label: '/docs/records', note: 'the record format the API writes' },
          ]}
        />
      </Section>

      <Section title="Report abuse">
        <Quote>
          If a subdomain is phishing, impersonating someone, or serving malware, email{' '}
          <a className="text-(--color-signal) underline" href="mailto:abuse@runs-on.dev">abuse@runs-on.dev</a>{' '}
          and it will be reclaimed.
        </Quote>
      </Section>

      <Section title="Policy">
        <p className="text-sm leading-relaxed sm:text-base">
          What names cost, what forfeits one, and what happens if runs-on.dev shuts down.
        </p>
        <DocList items={[{ href: '/policy', label: 'Policy' }]} />
      </Section>
    </main>
  );
}
