import { cookies } from 'next/headers';
import ClaimForm from './claim-form.jsx';
import OwnedName from './owned-name.jsx';
import JsonLd from './components/JsonLd.jsx';
import { Section, Quote } from './components/Section.jsx';
import { Divider, StatusBadge } from './components/ui.jsx';
import HomeMap from './components/home-map.jsx';
import { CLAIM_GEO } from './components/claim-geo.js';
import { geoPlacement } from '../lib/geo-placement.js';
import { readRegistry } from '../lib/registry-files.js';
import countryCentroids from '../scripts/country-centroids.json';
import { readSession } from '../lib/session.js';
import { getOwnerIndex } from '../lib/owners.js';
import { getRecord } from '../lib/registry.js';

export const metadata = {
  title: 'runs-on.dev · free subdomains',
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
      description: 'Independent software studio; builds and operates the runs-on.dev free subdomain registry.',
      url: 'https://advancelabs.dev',
      logo: 'https://runs-on.dev/icon.svg',
      sameAs: ['https://github.com/zordhalo/runs-on.dev', 'https://advancelabs.dev'],
      contactPoint: [
        {
          '@type': 'ContactPoint',
          email: 'abuse@runs-on.dev',
          contactType: 'abuse reports and support',
          url: 'https://runs-on.dev/contact',
        },
      ],
      address: { '@type': 'PostalAddress', addressCountry: 'IN' },
    },
    {
      '@type': 'WebApplication',
      '@id': 'https://advancelabs.dev/lab/runs-on#software',
      name: 'runs-on.dev',
      url: 'https://runs-on.dev',
      applicationCategory: 'DeveloperApplication',
      license: 'https://spdx.org/licenses/AGPL-3.0-only.html',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      creator: { '@id': 'https://advancelabs.dev/#organization' },
      publisher: { '@id': 'https://advancelabs.dev/#organization' },
      sameAs: ['https://github.com/zordhalo/runs-on.dev', 'https://advancelabs.dev/lab/runs-on'],
    },
  ],
};

const LINKS = [
  { href: '/docs/quickstart', label: 'Quickstart', note: 'claim a name, end to end' },
  { href: '/docs/guides', label: 'Guides', note: 'point it at your own hosting' },
  { href: '/docs/records', label: 'Record reference', note: 'every field, every rule' },
  { href: '/openapi.json', label: 'API', note: 'OpenAPI spec for programmatic access' },
  { href: '/about', label: 'About', note: 'what this is and is not' },
  { href: '/faq', label: 'FAQ', note: 'straight answers' },
  { href: 'https://github.com/zordhalo/runs-on.dev', label: 'GitHub', note: 'the registry itself', external: true },
];

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
  // An index entry whose record cannot be read (a stale index after a swap,
  // or a transient read failure) must not render as "your name is a bare
  // card": fall back to the claim form, which answers with the truth.
  if (!record) return null;
  return { name, record };
}

// Map placement recounted against the live registry. The page renders
// dynamically (session state is in the flow), but these numbers only change
// when the registry does, i.e. on deploy, so the disk read is memoised per
// lambda instance rather than paid per request.
let registryMemo = null;
function registry() {
  if (!registryMemo) registryMemo = readRegistry();
  return registryMemo;
}

export default async function Home() {
  const raw = (await cookies()).get('session')?.value;
  const session = raw ? readSession(raw, process.env.SESSION_SECRET) : null;
  const owned = await ownedName(session);
  const registryList = registry();
  const placement = geoPlacement(registryList, CLAIM_GEO, countryCentroids);

  return (
    <main>
      <JsonLd data={websiteJsonLd} />

      <h1 className="sr-only">runs-on.dev · a free subdomain registry</h1>

      {/* Hero: the claim line IS the display headline, set at 63px weight 400
          with negative tracking. Centered stack, then the dot-map world below. */}
      <section id="claim" className="mx-auto max-w-[1200px] px-6 pt-20 pb-16 text-center sm:pt-28">
        <StatusBadge tone="live" pulse>Free forever · live in seconds</StatusBadge>

        <p className="mt-5 font-(family-name:--font-mono) text-xs tracking-[0.04em] text-(--color-muted)">
          {registryList.length} names claimed · {placement.resolved} on the public claim map ·
          one per GitHub account · open source
        </p>

        <div className="mt-8 flex justify-center">
          {owned ? (
            <OwnedName name={owned.name} record={owned.record} />
          ) : (
            <ClaimForm signedIn={Boolean(session)} />
          )}
        </div>
      </section>

      {/* Full-bleed dot-matrix world map carrying the claim heat. The base
          world is a static image (keeps ~1600 elements out of the HTML);
          selecting a continent dims it and spotlights that continent
          client-side. The split-flap frame keeps the easter egg alive. */}
      <HomeMap
        heading
        points={placement.points}
        resolved={placement.resolved}
        total={placement.total}
      />

      <div className="mx-auto max-w-[1200px] px-6">
        <Section title="What this is">
          <div className="mx-auto max-w-[600px] text-center">
            <h2 className="text-[23px] leading-[1.07] font-normal tracking-[-0.005em] text-(--color-ink)">
              A JSON file in a public repo is the whole registry.
            </h2>
            <p className="mt-5 text-[16px] leading-[1.5] text-(--color-muted)">
              That file says the name is yours, and it is the only thing that makes{' '}
              <span className="font-(family-name:--font-mono) text-[15px]">*.runs-on.dev</span>{' '}
              resolve. No hidden database, nothing you can&rsquo;t read yourself.
            </p>
            <dl className="mx-auto mt-8 max-w-[440px] space-y-3 text-left font-(family-name:--font-mono) text-[13px]">
              <div className="slit-top slit-dim pt-3">
                <dt className="meta mb-1">live</dt>
                <dd className="text-(--color-ink)">
                  seconds, with HTTPS, and your own hosting whenever you like via pull request.
                </dd>
              </div>
              <div className="slit-top slit-dim pt-3">
                <dt className="meta mb-1">free</dt>
                <dd className="text-(--color-ink)">
                  forever. No ads, no tracking, no account beyond the GitHub one you already have.
                </dd>
              </div>
              <div className="slit-top slit-dim pt-3">
                <dt className="meta mb-1">open</dt>
                <dd className="text-(--color-ink)">
                  AGPL-3.0, end to end. Every rule, every record, and the whole app are public on GitHub.
                </dd>
              </div>
            </dl>
          </div>
        </Section>

        <Section title="Where to go next">
          {/* Link grid, service-cell style: each cell outlined by its own
              fading slit (open corners), brightening on hover. */}
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 sm:gap-16 lg:grid-cols-3">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="slit-frame group rounded-lg p-6 transition-colors hover:bg-(--color-card)"
              >
                <p className="text-[14px] tracking-[0.01em] text-(--color-ink) uppercase transition-colors group-hover:text-(--color-muted)">
                  {link.label}
                  <span aria-hidden="true" className="ml-2 text-(--color-muted)">↗</span>
                </p>
                <p className="mt-2 text-[14px] leading-relaxed text-(--color-muted)">{link.note}</p>
              </a>
            ))}
          </div>
        </Section>

        <Section title="Report abuse">
          <Quote>
            If a subdomain is phishing, impersonating someone, or serving malware, email
            abuse@runs-on.dev and it will be reclaimed.
          </Quote>
        </Section>
      </div>
    </main>
  );
}
