import dns from 'node:dns/promises';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { validateName } from '../../../lib/name.js';
import { getRecord } from '../../../lib/registry.js';
import { classifyClaim, diagnoseStuck } from '../../../lib/health.js';
import { probe } from '../../../lib/dns-probe.js';
import { REPO_URL } from '../../../lib/repo.js';

// A public, shareable diagnosis for one name: what the record declares, what
// DNS actually answers, what the name serves, and — when it is stuck — which
// specific step is missing. The point is self-serve triage: the answer to
// "why is my name still the card" becomes a link instead of an issue.
//
// Live DNS, so dynamic and noindex: this is a debug tool, not a page anyone
// should land on from a search engine.

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Debug',
  robots: { index: false },
};

const ZONE = 'runs-on.dev';
const TOKEN = () => process.env.CARD_TOKEN ?? process.env.REGISTRY_TOKEN;

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function flattenTxt(records) {
  return (records ?? []).map((chunks) => chunks.join(''));
}

// What each stuck diagnosis should tell a person, in the same words the fix
// takes. Kept page-side rather than in lib/health.js because the issue
// bodies there are issue-shaped (markdown, @mentions); this is a page.
const STUCK_ADVICE = {
  'vercel-app-url': (name) => ({
    title: 'The CNAME points at a deployment URL',
    body: `Vercel decides what to serve from the hostname, and a .vercel.app address is not registered as serving ${name}.runs-on.dev. Add ${name}.runs-on.dev as a domain on your Vercel project, then use the custom-domain target it shows you instead of the deployment URL.`,
  }),
  'vercel-no-challenge': (name) => ({
    title: 'The Vercel ownership challenge is missing',
    body: `runs-on.dev belongs to the registry, not to you, so Vercel needs proof you control this specific name before it will serve it. In your project's domain settings, copy the vc-domain-verify TXT value it offers and add it on /manage as a subdomain record with label _vercel and type TXT.`,
  }),
  'vercel-awaiting-verification': (name) => ({
    title: 'DNS is right, Vercel just has not re-checked',
    body: `The CNAME and the _vercel TXT are both published, which means everything on this side is done. Vercel often needs one nudge: remove and re-add ${name}.runs-on.dev in your project's domain settings to force a fresh verification check.`,
  }),
  'platform-default-host': (name) => ({
    title: 'The platform does not know about this hostname',
    body: `DNS points at your platform, but nothing there is configured to answer for ${name}.runs-on.dev. Add it as a custom domain where your site is hosted — GitHub Pages puts it under repo Settings → Pages, Netlify and Cloudflare Pages under domain settings.`,
  }),
  unknown: (name) => ({
    title: 'Your host is not answering for this name yet',
    body: `The name resolves and holds a certificate, but the registry's own page is still what visitors get, which means the provider has not taken ownership of the hostname. Add ${name}.runs-on.dev as a custom domain wherever the site is hosted.`,
  }),
};

const VERDICT = {
  ok: { label: 'Serving your site', color: '#22c55e' },
  redirect: { label: 'Redirecting', color: '#3b82f6' },
  card: { label: 'Serving the profile card', color: '#9ca3af' },
  stuck: { label: 'Stuck on the profile card', color: '#eab308' },
  down: { label: 'No answer', color: '#ef4444' },
  unknown: { label: 'Unclassified', color: '#9ca3af' },
};

export default async function DebugPage({ params }) {
  const { name } = await params;
  if (!validateName(name).ok) notFound();

  // Distinguish "no record" from "could not read": a registry hiccup must
  // not render a claimed name as unclaimed — this page's whole value is
  // being trusted, and getRecord returns null only for 404, throwing for
  // everything else.
  let record = null;
  let readFailed = false;
  try {
    record = await getRecord(name, {
      token: TOKEN(),
      fetchImpl: (u, i) => fetch(u, { ...i, next: { revalidate: 30 } }),
    });
  } catch {
    readFailed = true;
  }

  if (readFailed) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="font-(family-name:--font-mono) text-xs tracking-[0.14em] text-(--color-muted) uppercase">Debug</p>
        <h1 className="mt-2 font-(family-name:--font-display) text-2xl font-medium text-(--color-ink)">{name}.runs-on.dev</h1>
        <p className="mt-4 text-sm leading-relaxed text-(--color-muted)">
          The registry could not be read just now, so there is nothing trustworthy to
          report. Reload in a moment — a claimed name is not "not claimed" because a
          read failed.
        </p>
      </main>
    );
  }

  if (!record) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="font-(family-name:--font-mono) text-xs tracking-[0.14em] text-(--color-muted) uppercase">Debug</p>
        <h1 className="mt-2 font-(family-name:--font-display) text-2xl font-medium text-(--color-ink)">{name}.runs-on.dev</h1>
        <p className="mt-4 text-sm leading-relaxed text-(--color-muted)">
          This name is not claimed, so there is no record to check: the wildcard serves a
          claim page for it and DNS points nowhere in particular.
        </p>
        <Link href={`/?claim=${encodeURIComponent(name)}`} className="mt-4 inline-block font-(family-name:--font-mono) text-sm text-(--color-signal) underline">
          claim {name}.runs-on.dev →
        </Link>
      </main>
    );
  }

  const records = record.records ?? {};
  const wantedCname = typeof records.CNAME === 'string' ? records.CNAME : null;
  const wantedTxt = (record.subdomains?._vercel?.TXT ?? []).filter((v) => typeof v === 'string');

  const [cname, a, txtVercelLabel, txtVercelZone, servingProbe] = await Promise.all([
    safe(() => dns.resolveCname(`${name}.${ZONE}`), []),
    safe(() => dns.resolve4(`${name}.${ZONE}`), []),
    safe(() => dns.resolveTxt(`_vercel.${name}.${ZONE}`), []),
    safe(() => dns.resolveTxt(`_vercel.${ZONE}`), []),
    probe(name),
  ]);

  const status = classifyClaim(record, servingProbe);
  const verdict = VERDICT[status] ?? VERDICT.unknown;
  const advice = status === 'stuck' ? STUCK_ADVICE[diagnoseStuck(record)]?.(name) : null;

  const rows = [];
  if (wantedCname) {
    const live = (cname ?? []).some((r) => r.toLowerCase() === wantedCname.toLowerCase());
    rows.push({ ok: live, text: live ? `CNAME → ${cname[0]}` : `CNAME not visible yet (want ${wantedCname})` });
  }
  if (wantedTxt.length > 0) {
    // The challenge has to be live at the claim's own _vercel label before
    // the zone mirror copies it up, so this row names which half is lagging
    // when the zone row below is still red.
    const atName = flattenTxt(txtVercelLabel);
    const liveAtName = wantedTxt.some((v) => atName.includes(v));
    rows.push({ ok: liveAtName, text: liveAtName ? '_vercel TXT live at the name' : `_vercel TXT not live at _vercel.${name} yet` });
    const zone = flattenTxt(txtVercelZone);
    const published = wantedTxt.some((v) => zone.includes(v));
    rows.push({ ok: published, text: published ? '_vercel TXT published at the zone' : '_vercel TXT not at the zone yet' });
  }
  if (status === 'ok' && servingProbe.title) {
    rows.push({ ok: true, text: `serving: ${servingProbe.title}` });
  }
  if (status === 'redirect') {
    rows.push({ ok: true, text: `redirecting to ${servingProbe.finalUrl}` });
  }
  if (status === 'card') {
    rows.push({ ok: true, text: 'no DNS records, wildcard serves the profile card (as picked)' });
  }
  if (status === 'stuck') {
    rows.push({ ok: false, text: `still serving the registry's own page (${servingProbe.title || 'profile card'})` });
  }
  if (status === 'down') {
    rows.push({ ok: false, text: `nothing answered https://${name}.${ZONE}/ when probed` });
  }

  const recordTypes = Object.keys(records);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-(family-name:--font-mono) text-xs tracking-[0.14em] text-(--color-muted) uppercase">Debug</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-(family-name:--font-display) text-2xl font-medium tracking-tight text-(--color-ink)">
          {name}.runs-on.dev
        </h1>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-(family-name:--font-mono) text-xs"
          style={{ borderColor: verdict.color, color: verdict.color }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: verdict.color }} />
          {verdict.label}
        </span>
      </div>

      <div className="mt-6 border border-(--color-rule) bg-(--color-card) px-5 py-4">
        <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">{'// live check'}</p>
        <ul className="mt-2 space-y-1 font-(family-name:--font-mono) text-xs">
          {rows.length === 0 && <li className="text-(--color-muted)">nothing to check yet</li>}
          {rows.map((row, i) => (
            <li key={i} className={row.ok ? 'text-(--color-ink)' : 'text-(--color-muted)'}>
              {row.ok ? '✓' : '…'} {row.text}
            </li>
          ))}
        </ul>
        <p className="mt-3 font-(family-name:--font-mono) text-xs text-(--color-muted)">
          record on file: {recordTypes.length > 0 ? recordTypes.join(', ') : 'no records (card)'}
          {(cname ?? []).length === 0 && (a ?? []).length === 0 ? ' · nothing resolves at the name yet' : ''}
        </p>
      </div>

      {advice && (
        <div className="mt-4 border border-(--color-signal)/50 bg-(--color-signal)/5 px-5 py-4">
          <p className="font-(family-name:--font-mono) text-xs text-(--color-signal)">{'// what is missing'}</p>
          <p className="mt-2 text-sm font-medium text-(--color-ink)">{advice.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-(--color-muted)">{advice.body}</p>
        </div>
      )}

      <p className="mt-6 text-sm text-(--color-muted)">
        Owner? Fix any of this on{' '}
        <Link href="/manage" className="text-(--color-signal) underline">/manage</Link>
        {'. '}The record itself is{' '}
        <a href={`${REPO_URL}/blob/main/domains/${name}.json`} target="_blank" rel="noopener noreferrer" className="text-(--color-signal) underline">
          domains/{name}.json
        </a>
        . DNS changes take up to a minute to publish after a save.
      </p>
    </main>
  );
}
