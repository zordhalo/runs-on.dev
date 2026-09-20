/**
 * The shared banner artwork, rendered by both image routes.
 *
 * `app/opengraph-image.js` serves the light card as the social preview, matching the site's
 * own identity. `app/banner-dark/route.js` serves the dark variant, which the README uses as
 * its default because most people read GitHub on a dark theme and a bright card glares there.
 *
 * Both come from this one function so the two can never drift apart. Theme values follow
 * the site's Hyperstudio language: obsidian/carbon grounds, chalk type, hairline accents,
 * weight 400 at display sizes.
 */

// Re-exported so existing importers keep working; the number lives in
// lib/banner-size.js.
export { BANNER_SIZE } from './banner-size.js';

const THEMES = {
  light: {
    ground: '#101010',
    muted: '#9C9C9C',
    ink: '#F3F3F3',
    signal: '#F3F3F3',
  },
  dark: {
    ground: '#080808',
    muted: '#9C9C9C',
    ink: '#F3F3F3',
    signal: '#8A8172',
  },
};

export function BannerCard({ theme = 'light' }) {
  const t = THEMES[theme] ?? THEMES.light;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '100px',
        background: t.ground,
      }}
    >
      <span
        style={{
          fontFamily: 'monospace',
          fontSize: 22,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: t.muted,
        }}
      >
        A FREE SUBDOMAIN REGISTRY
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 28 }}>
        <span style={{ fontSize: 84, color: t.muted }}>[</span>
        <span
          style={{
            fontSize: 84,
            fontWeight: 400,
            letterSpacing: -0.9,
            color: t.ink,
            borderBottom: `4px solid ${t.signal}`,
            padding: '0 12px',
          }}
        >
          yourname
        </span>
        <span style={{ fontSize: 84, fontWeight: 400, letterSpacing: -0.9, color: t.muted }}>]</span>
        <span style={{ fontSize: 84, fontWeight: 400, letterSpacing: -0.9, color: t.muted }}>.runs-on.dev</span>
      </div>
    </div>
  );
}
