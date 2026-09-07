import { getRecord } from './registry.js';
import { REPO_URL } from './repo.js';

// The per-claim banner artwork, rendered by next/og from two places:
// app/banner/[name]/route.js (the downloadable/shareable image, both themes)
// and app/sites/[name]/opengraph-image.js (the light card, as the social
// preview for a claimed name's own page). One component so the two can never
// drift apart — the same contract lib/banner-card.jsx holds for the
// registry's own artwork.
//
// Satori (what next/og renders with) supports a subset of CSS: flexbox only,
// no shorthand, explicit sizes on images. Everything here stays inside that
// subset on purpose.

export const BANNER_SIZE = { width: 1200, height: 630 };

const THEMES = {
  light: {
    ground: '#F4F5F3',
    muted: '#5E6668',
    ink: '#14181B',
    rule: '#D8DBD7',
    signal: '#1B4DFF',
  },
  dark: {
    ground: '#18140F',
    muted: '#A89C89',
    ink: '#EFE7D9',
    rule: '#3A342B',
    signal: '#8399FF',
  },
};

// One registry read + one GitHub read, shared by both render sites, with the
// same short revalidate the card page uses so a banner reflects a fresh
// claim within minutes rather than an hour.
export async function claimBannerData(name) {
  const token = process.env.CARD_TOKEN ?? process.env.REGISTRY_TOKEN;
  const fetchImpl = (url, init) => fetch(url, { ...init, next: { revalidate: 300 } });

  const record = await getRecord(name, { token, fetchImpl }).catch(() => null);
  if (!record) return null;

  const res = await fetch(`https://api.github.com/users/${record.owner.github}`, {
    // Authorization only when a token actually exists: `Bearer undefined`
    // is a malformed credential GitHub answers with 401, not an anonymous
    // request. registry.js's headers() plays the same trick.
    headers: token
      ? { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }
      : { Accept: 'application/vnd.github+json' },
    next: { revalidate: 3600 },
  }).catch(() => null);
  const profile = res && res.ok ? await res.json().catch(() => null) : null;

  // The ?s= parameter asks GitHub for a square render at a size worth
  // putting on a 1200px-wide card. The avatar is fetched here and embedded
  // as a data: URL rather than handed to <img src> as a remote link, because
  // satori's own remote-image fetching depends on the runtime it runs in —
  // an avatar that silently renders as an empty circle in one environment
  // is exactly the failure a shareable banner cannot afford.
  let avatarUrl = profile?.avatar_url ?? null;
  if (avatarUrl) {
    const sized = new URL(avatarUrl);
    sized.searchParams.set('s', '256');
    const imgRes = await fetch(sized.href, { next: { revalidate: 3600 } }).catch(() => null);
    if (imgRes?.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = (imgRes.headers.get('content-type') ?? 'image/png').split(';')[0];
      avatarUrl = `data:${mime};base64,${buf.toString('base64')}`;
    } else {
      avatarUrl = null;
    }
  }

  const overrides = record.profile ?? {};
  return {
    name,
    login: record.owner.github,
    displayName: overrides.name ?? profile?.name ?? null,
    bio: overrides.bio ?? profile?.bio ?? null,
    claimedYear: (record.claimedAt ?? '').slice(0, 4) || null,
    avatarUrl,
  };
}

export function ClaimBanner({ name, login, displayName, bio, claimedYear, avatarUrl, theme = 'light' }) {
  const t = THEMES[theme] ?? THEMES.light;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: t.ground,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            width={96}
            height={96}
            style={{ borderRadius: 96, border: `2px solid ${t.rule}` }}
          />
        ) : (
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 96,
              border: `2px solid ${t.rule}`,
              display: 'flex',
            }}
          />
        )}
        <div style={{ marginLeft: 28, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 30, color: t.ink, display: 'flex' }}>
            {displayName ?? `@${login}`}
          </span>
          <span style={{ fontSize: 22, color: t.muted, marginTop: 6, display: 'flex' }}>
            {claimedYear ? `claimed ${claimedYear}` : `@${login}`}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 88, fontWeight: 600, color: t.ink, display: 'flex' }}>
          {name}
          <span style={{ fontSize: 88, fontWeight: 600, color: t.muted, display: 'flex' }}>.runs-on.dev</span>
        </span>
        {bio ? (
          <span style={{ fontSize: 26, color: t.muted, marginTop: 20, display: 'flex', maxWidth: 900 }}>
            {bio.length > 120 ? `${bio.slice(0, 117)}…` : bio}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 22,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: t.muted,
            display: 'flex',
          }}
        >
          A FREE SUBDOMAIN REGISTRY
        </span>
        <span style={{ fontSize: 24, color: t.signal, display: 'flex' }}>{REPO_URL.replace('https://', '')}</span>
      </div>
    </div>
  );
}
