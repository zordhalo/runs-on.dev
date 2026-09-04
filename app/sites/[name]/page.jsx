import { notFound, redirect } from 'next/navigation';
import { getRecord } from '../../../lib/registry.js';
import { isValidRedirectUrl } from '../../../lib/schema.js';
import { cardMetadata } from '../../../lib/metadata.js';
import { REPO_URL } from '../../../lib/repo.js';

// Record freshness, not the GitHub profile's: a name claimed just now must
// stop serving a cached 404 within seconds, not up to an hour.
export const revalidate = 30;

// Wildcard DNS makes every grammar-valid hostname live, so an anonymous curl
// loop over a few thousand names can exhaust the shared registry quota. A
// dedicated card-read token keeps that failure mode from taking down claiming.
const CARD_TOKEN = process.env.CARD_TOKEN ?? process.env.REGISTRY_TOKEN;

async function githubProfile(login) {
  const res = await fetch(`https://api.github.com/users/${login}`, {
    // Authorization only when a token actually exists: `Bearer undefined`
    // is a malformed credential GitHub answers with 401, not an anonymous
    // request — the same trap lib/claim-banner.jsx guards against.
    headers: CARD_TOKEN
      ? { Accept: 'application/vnd.github+json', Authorization: `Bearer ${CARD_TOKEN}` }
      : { Accept: 'application/vnd.github+json' },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchRecord(name) {
  const fetchImpl = (url, init) => fetch(url, { ...init, next: { revalidate: 30 } });
  return getRecord(name, { token: CARD_TOKEN, fetchImpl });
}

// Both this and the page below read the record and the GitHub profile. Next
// memoises identical fetches across generateMetadata and the render for one
// request, and both calls go through the same helpers with the same options,
// so a card still costs one registry read and one profile read, not two of
// each. That matters here specifically: these reads come out of CARD_TOKEN's
// hourly quota, which the wildcard makes trivially easy to exhaust.
export async function generateMetadata({ params }) {
  const { name } = await params;
  const record = await fetchRecord(name);
  if (!record) return { title: { absolute: 'Not found' }, robots: { index: false } };

  const profile = await githubProfile(record.owner.github);
  // Field-by-field merge, same as the page below: record.profile wins where
  // set, GitHub fills the rest, so title/description and the rendered card
  // can never disagree.
  const merged = {
    ...profile,
    name: record.profile?.name ?? profile?.name,
    bio: record.profile?.bio ?? profile?.bio,
  };
  return cardMetadata({ name, record, profile: merged });
}

export default async function Site({ params }) {
  const { name } = await params;
  const record = await fetchRecord(name);
  if (!record) notFound();

  const records = record.records ?? {};
  if (records.URL && Object.keys(records).length === 1) {
    // Re-validate at render time, not just at CI review time: the record
    // could have been merged before this rule existed or before it
    // tightened, and this is an open-redirect surface on a trusted domain.
    // Plain redirect() (not permanentRedirect) answers with a 307 here,
    // preserving method and intent and telling browsers not to cache the
    // redirect permanently, unlike a 301/308.
    if (!isValidRedirectUrl(records.URL)) notFound();
    redirect(records.URL);
  }

  const profile = await githubProfile(record.owner.github);

  // The record's profile block overrides what GitHub reports, field by
  // field: an owner who set profile.name keeps their chosen display name
  // even when the GitHub profile says something else, and an unset field
  // falls back rather than blanking the card. cardMetadata receives the
  // merged view so the page and its meta tags can never disagree.
  const overrides = record.profile ?? {};
  const displayName = overrides.name ?? profile?.name;
  const bio = overrides.bio ?? profile?.bio;
  const links = Array.isArray(overrides.links) ? overrides.links : [];

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
      <p className="font-(family-name:--font-mono) text-xs tracking-[0.14em] text-(--color-muted) uppercase">
        domains/{name}.json
      </p>

      <div className="mt-4 border border-(--color-rule) bg-(--color-card) p-6 sm:p-8">
        <div className="flex items-center gap-4">
          {profile?.avatar_url && (
            <img
              src={profile.avatar_url}
              alt=""
              width={56}
              height={56}
              className="border border-(--color-rule)"
            />
          )}
          <div>
            <div className="flex items-center gap-2">
              <a
                href={`https://${name}.runs-on.dev`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-(family-name:--font-display) text-2xl font-medium tracking-tight text-(--color-ink) underline decoration-(--color-muted) underline-offset-4 transition-colors hover:text-(--color-signal) hover:decoration-(--color-signal) sm:text-3xl"
              >
                {name}.runs-on.dev
              </a>
              <a
                href="/manage"
                className="flex items-center justify-center border border-(--color-rule) px-2.5 py-1 font-(family-name:--font-mono) text-xs text-(--color-muted) transition-colors hover:border-(--color-signal) hover:text-(--color-signal)"
              >
                manage
              </a>
            </div>
            {displayName && <p className="text-sm text-(--color-muted)">{displayName}</p>}
          </div>
        </div>

        {bio && <p className="mt-4 text-sm leading-relaxed">{bio}</p>}

        {links.length > 0 && (
          <ul className="mt-6 space-y-2">
            {links.map((link) => (
              <li key={`${link.label}-${link.url}`}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between border border-(--color-rule) px-4 py-3 font-(family-name:--font-mono) text-sm text-(--color-ink) transition-colors hover:border-(--color-signal)"
                >
                  <span className="truncate">{link.label}</span>
                  <span aria-hidden className="ml-3 shrink-0 text-(--color-muted)">↗</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-6 space-y-1 border-t border-(--color-rule) pt-4 font-(family-name:--font-mono) text-xs sm:text-[13px]">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-(--color-muted)">owner</dt>
            <dd>
              <a
                className="text-(--color-signal) underline"
                href={`https://github.com/${record.owner.github}`}
              >
                @{record.owner.github}
              </a>
            </dd>
          </div>
          {record.claimedAt && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-(--color-muted)">claimedAt</dt>
              <dd className="text-(--color-ink)">{record.claimedAt}</dd>
            </div>
          )}
          {/* The banner links must be absolute to the apex: this page renders
              on <name>.runs-on.dev hosts, where a relative /banner/<name>
              would be rewritten by proxy.js into /sites/<name>/banner/... and
              404. The banner route lives on runs-on.dev itself. */}
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-(--color-muted)">share</dt>
            <dd>
              <a
                className="text-(--color-signal) underline"
                href={`https://runs-on.dev/banner/${name}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                banner
              </a>
              {' / '}
              <a
                className="text-(--color-signal) underline"
                href={`https://runs-on.dev/banner/${name}?theme=dark`}
                target="_blank"
                rel="noopener noreferrer"
              >
                dark
              </a>
            </dd>
          </div>
        </dl>
      </div>

      <p className="mt-6 text-sm text-(--color-muted)">
        This name is registered on{' '}
        <a className="text-(--color-signal) underline" href="https://runs-on.dev">
          runs-on.dev
        </a>
        . Claim your own.
      </p>

      <p className="mt-2 font-(family-name:--font-mono) text-xs text-(--color-muted)">
        The record above is{' '}
        <a
          className="text-(--color-signal) underline"
          href={`${REPO_URL}/blob/main/domains/${name}.json`}
          target="_blank"
          rel="noopener noreferrer"
        >
          domains/{name}.json
        </a>
        , in a public repo you can read without asking anyone.{' '}
        <a
          className="text-(--color-signal) underline"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          ★ Star the registry
        </a>
      </p>
    </main>
  );
}
