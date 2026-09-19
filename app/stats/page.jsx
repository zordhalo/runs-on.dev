import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Section } from '../components/Section.jsx';
import { summarize } from '../../lib/stats.js';
import { readRegistry } from '../../lib/registry-files.js';
import { geoPlacement } from '../../lib/geo-placement.js';
import { CLAIM_GEO } from '../components/claim-geo.js';
import countryCentroids from '../../scripts/country-centroids.json';
import { GrowthChart } from './growth-chart.jsx';
import ConfettiStat from './confetti-stat.jsx';
import ClaimMap from '../components/claim-map.jsx';

export const metadata = {
  title: 'Stats',
  description:
    'How many names have been claimed on runs-on.dev, by whom, and what people point them at. Counted straight from the public registry.',
  alternates: { canonical: 'https://runs-on.dev/stats' },
  openGraph: { title: 'Stats · runs-on.dev' },
};

// Read at build time, never per request. Deploys run from GitHub Actions on
// merge to main, so a claim and this page's rebuild are the same event -- the
// numbers are never more than one merge stale. Reading `domains/` off disk
// also keeps the page off the GitHub API entirely, which matters because the
// wildcard makes that quota trivially easy to exhaust (see app/sites).
export const dynamic = 'force-static';

const USAGE_LABELS = {
  card: 'Profile card',
  cname: 'Pointed at a host',
  url: 'Redirect to a URL',
  advanced: 'Custom DNS records',
};

// Stat cell: no fill, just the number set large at weight 400 with a mono
// caption underneath, the cell outlined by its own fading slit.
function Stat({ label, value }) {
  return (
    <div className="slit-frame rounded-lg p-6 sm:p-8">
      <div className="text-[34px] leading-[1.03] font-normal tracking-[-0.005em] text-(--color-ink) sm:text-[44px] sm:tracking-[-0.007em]">
        {value}
      </div>
      <div className="meta mt-3">{label}</div>
    </div>
  );
}

function day(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

// Shared row-list look: a slit frame around the list, rows separated by dim
// slits instead of hard dividers.
function RowList({ children }) {
  return (
    <ul className="slit-frame slit-rows rounded-lg">
      {children}
    </ul>
  );
}

export default function Stats() {
  const registry = readRegistry();
  const stats = summarize(registry);
  const placement = geoPlacement(registry, CLAIM_GEO, countryCentroids);
  const usage = Object.entries(stats.usage).filter(([, count]) => count > 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <h1 className="text-[34px] leading-[1.03] font-normal tracking-[-0.005em] text-(--color-ink) sm:text-[44px] sm:tracking-[-0.007em]">
        Stats
      </h1>
      <p className="mt-5 max-w-[600px] text-[16px] leading-[1.5] text-(--color-muted)">
        Every name here is a file in a public repo, so these numbers are just that repo
        counted. Nothing is estimated and nothing is tracked about visitors.
      </p>

      <Section title="Where things stand">
        <div className="grid grid-cols-1 gap-12 sm:gap-16 sm:grid-cols-3">
          <ConfettiStat label="Names claimed" value={stats.total} />
          <Stat label="People" value={stats.owners} />
          <Stat label="Claimed this week" value={stats.claimedThisWeek} />
        </div>
      </Section>

      {stats.cumulative.length > 1 && (
        <Section title="Names claimed over time">
          <GrowthChart series={stats.cumulative} />
        </Section>
      )}

      {placement.resolved > 0 && (
        <Section title="Where claims come from">
          <ClaimMap points={Object.values(placement.points)} total={placement.total} />
          <p className="text-xs leading-relaxed text-(--color-muted)">
            {placement.resolved} of {placement.total} owners resolved: coordinates come from the
            country captured at claim time and the public location field on GitHub profiles,
            recounted against the live registry on every rebuild (scripts/geocode-owners.mjs
            enriches the map for claims older than the country field). Blank or unplaceable
            locations count toward nothing, and everything here is approximate.
          </p>
        </Section>
      )}

      {usage.length > 0 && (
        <Section title="What people do with them">
          <RowList>
            {usage
              .sort((a, b) => b[1] - a[1])
              .map(([mode, count]) => (
                <li key={mode} className="flex items-baseline justify-between px-5 py-3.5">
                  <span className="text-sm text-(--color-ash)">{USAGE_LABELS[mode]}</span>
                  <span className="font-(family-name:--font-mono) text-sm text-(--color-muted)">
                    {count}
                  </span>
                </li>
              ))}
          </RowList>
        </Section>
      )}

      {stats.hosts.length > 0 && (
        <Section title="Where the sites are hosted">
          <RowList>
            {stats.hosts.map((host) => (
              <li
                key={host.provider}
                className="flex items-baseline justify-between px-5 py-3.5"
              >
                <span className="text-sm text-(--color-ash)">{host.provider}</span>
                <span className="font-(family-name:--font-mono) text-sm text-(--color-muted)">
                  {host.count}
                </span>
              </li>
            ))}
          </RowList>
          <p className="text-xs leading-relaxed text-(--color-muted)">
            Counted from CNAME targets. Anything self-hosted or unrecognised is
            &ldquo;Other&rdquo;. The hostname stays out of it.
          </p>
        </Section>
      )}

      {stats.recent.length > 0 && (
        <Section title="Recently claimed">
          <RowList>
            {stats.recent.map((claim) => (
              <li
                key={claim.name}
                className="flex flex-wrap items-baseline justify-between gap-x-3 px-5 py-3.5"
              >
                <a
                  className="font-(family-name:--font-mono) text-sm text-(--color-ink) underline"
                  href={`https://${claim.name}.runs-on.dev`}
                >
                  {claim.name}.runs-on.dev
                </a>
                <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
                  @{claim.github} · {day(claim.claimedAt)}
                </span>
              </li>
            ))}
          </RowList>
        </Section>
      )}
    </main>
  );
}
