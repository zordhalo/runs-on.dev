import { cookies } from 'next/headers';
import ClaimForm from './claim-form.jsx';
import OwnedName from './owned-name.jsx';
import JsonLd from './components/JsonLd.jsx';
import { Section, Quote } from './components/Section.jsx';
import { readSession } from '../lib/session.js';
import { getOwnerIndex } from '../lib/owners.js';
import { getRecord } from '../lib/registry.js';

export const metadata = {
  title: 'runs-on.dev — free subdomains',
  description: 'Claim your own name.runs-on.dev in seconds. Free, forever.',
  alternates: { canonical: 'https://runs-on.dev' },
};

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://runs-on.dev/#website',
      url: 'https://runs-on.dev',
      name: 'runs-on.dev',
      description: 'A free subdomain registry. Claim your own name.runs-on.dev in seconds.',
      publisher: { '@id': 'https://advancelabs.dev/#organization' },
    },
    {
      '@type': 'Organization',
      '@id': 'https://advancelabs.dev/#organization',
      name: 'Advance Labs',
      url: 'https://advancelabs.dev',
    },
  ],
};

// Only for a signed-in visitor: this page is the highest-traffic route on the
// site and these reads come out of REGISTRY_TOKEN's quota, the same one
// claiming depends on. It already renders dynamically because it reads
// cookies, so nothing is being given up on caching. Fails soft -- a lookup
// that cannot run falls back to the claim form, which is what every visitor
// saw before.
async function ownedName(session) {
  if (!session?.login) return null;
  const token = process.env.REGISTRY_TOKEN;
  const index = await getOwnerIndex(session.login, { token }).catch(() => null);
  const name = index?.names?.[0];
  if (!name) return null;
  const record = await getRecord(name, { token }).catch(() => null);
  return { name, record };
}

export default async function Home() {
  const raw = (await cookies()).get('session')?.value;
  const session = raw ? readSession(raw, process.env.SESSION_SECRET) : null;
  const owned = await ownedName(session);

  return (
    <main className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
      <JsonLd data={websiteJsonLd} />

      <h1 className="sr-only">runs-on.dev — a free subdomain registry</h1>

      <p className="font-(family-name:--font-mono) text-xs tracking-[0.14em] text-(--color-muted) uppercase">
        A free subdomain registry
      </p>

      <div className="mt-3">
        {owned ? (
          <OwnedName name={owned.name} record={owned.record} />
        ) : (
          <ClaimForm signedIn={Boolean(session)} />
        )}
      </div>

      <Section title="What this is">
        <p className="text-sm leading-relaxed sm:text-base">
          Claiming a name writes a JSON file to a public repo. That file is the record: it says
          the name is yours, and it is the only thing that makes <span className="font-(family-name:--font-mono)">*.runs-on.dev</span> resolve.
          No hidden database, nothing you can't read yourself.
        </p>
        <dl className="space-y-1.5 font-(family-name:--font-mono) text-xs sm:text-[13px]">
          <div>
            <dt className="inline text-(--color-muted) uppercase tracking-[0.1em]">live —</dt>{' '}
            <dd className="inline text-(--color-ink)">
              seconds, with HTTPS, and your own hosting whenever you like via pull request.
            </dd>
          </div>
          <div>
            <dt className="inline text-(--color-muted) uppercase tracking-[0.1em]">free —</dt>{' '}
            <dd className="inline text-(--color-ink)">
              forever. No ads, no tracking, no account beyond the GitHub one you already have.
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Important links">
        <ul className="space-y-1.5 text-sm sm:text-base">
          <li><a className="text-(--color-signal) underline" href="/docs/quickstart">Quickstart</a></li>
          <li><a className="text-(--color-signal) underline" href="/docs/guides">Guides: point your name at your own hosting</a></li>
          <li><a className="text-(--color-signal) underline" href="/about">About runs-on.dev</a></li>
          <li><a className="text-(--color-signal) underline" href="/faq">FAQ</a></li>
          <li><a className="text-(--color-signal) underline" href="/policy">Policy</a></li>
          <li><a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">Registry on GitHub</a></li>
        </ul>
      </Section>

      <Section title="Report abuse">
        <Quote>
          If a subdomain is phishing, impersonating someone, or serving malware, email
          abuse@runs-on.dev and it will be reclaimed.
        </Quote>
      </Section>
    </main>
  );
}
