// The embeddable claim badge: the snippets an owner copies to put their name
// on a page they control. Pure string building, no fs and no fetch, so the
// shapes below are unit-tested rather than eyeballed behind a login.
//
// The two surfaces are not equivalent, and the wording in the UI says so.
// A badge on a site the owner controls is an ordinary link. GitHub rewrites
// every link in rendered user content with rel="nofollow" and proxies the
// image through camo, so a README badge earns visibility and nothing more.
// Both are offered anyway: visibility is a real reason to want one.
import { BANNER_SIZE } from './banner-size.js';

const APEX = 'runs-on.dev';

export const BADGE_THEMES = ['light', 'dark'];

// The banner route lives on the apex, never on the claimed host: a relative
// path would be rewritten by proxy.js on a <name>.runs-on.dev render and
// 404, the same trap the card page's share row documents.
export function badgeImageUrl(name, theme = 'light') {
  return `https://${APEX}/banner/${name}${theme === 'dark' ? '?theme=dark' : ''}`;
}

// The badge points at the owner's own card rather than the apex. It reads as
// theirs, which is the only reason anyone embeds it, and an inbound link to a
// subdomain credits the root domain just the same.
export function badgeLinkUrl(name) {
  return `https://${name}.${APEX}`;
}

export function badgeAlt(name) {
  return `${name}.${APEX}`;
}

// width/height ride along so a page embedding the badge reserves its box
// before the image lands instead of reflowing around it.
export function badgeHtml(name, theme = 'light') {
  const { width, height } = BANNER_SIZE;
  return [
    `<a href="${badgeLinkUrl(name)}">`,
    `<img src="${badgeImageUrl(name, theme)}"`,
    ` alt="${badgeAlt(name)}"`,
    ` width="${width}" height="${height}">`,
    `</a>`,
  ].join('');
}

export function badgeMarkdown(name, theme = 'light') {
  return `[![${badgeAlt(name)}](${badgeImageUrl(name, theme)})](${badgeLinkUrl(name)})`;
}

export function badgeSnippets(name, theme = 'light') {
  const t = BADGE_THEMES.includes(theme) ? theme : 'light';
  return {
    theme: t,
    // The preview in /manage draws the same box the snippets declare.
    width: BANNER_SIZE.width,
    height: BANNER_SIZE.height,
    imageUrl: badgeImageUrl(name, t),
    linkUrl: badgeLinkUrl(name),
    html: badgeHtml(name, t),
    markdown: badgeMarkdown(name, t),
  };
}
