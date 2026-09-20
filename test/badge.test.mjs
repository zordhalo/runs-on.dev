// The badge snippets an owner copies out of /manage. That page is behind a
// GitHub session, so the shapes are pinned here rather than by looking at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeSnippets, badgeHtml, badgeMarkdown, badgeImageUrl, badgeLinkUrl, BADGE_THEMES,
} from '../lib/badge.js';
import { BANNER_SIZE } from '../lib/banner-size.js';

test('the image comes off the apex, never the claimed host', () => {
  // A relative path, or one built against <name>.runs-on.dev, is rewritten by
  // proxy.js into /sites/<name>/... and 404s. The card page's share row
  // carries the same warning.
  for (const theme of BADGE_THEMES) {
    assert.ok(badgeImageUrl('lucas', theme).startsWith('https://runs-on.dev/banner/lucas'));
  }
  assert.equal(badgeImageUrl('lucas', 'dark'), 'https://runs-on.dev/banner/lucas?theme=dark');
  assert.equal(badgeImageUrl('lucas', 'light'), 'https://runs-on.dev/banner/lucas');
});

test('the badge links to the owner card, not the apex', () => {
  assert.equal(badgeLinkUrl('lucas'), 'https://lucas.runs-on.dev');
  assert.ok(badgeHtml('lucas').includes('href="https://lucas.runs-on.dev"'));
  assert.ok(badgeMarkdown('lucas').endsWith('](https://lucas.runs-on.dev)'));
});

test('the html snippet reserves the image box', () => {
  const html = badgeHtml('lucas');
  assert.ok(html.includes(`width="${BANNER_SIZE.width}"`), 'width is declared');
  assert.ok(html.includes(`height="${BANNER_SIZE.height}"`), 'height is declared');
  // No rel: an owner putting this on their own site is making an ordinary
  // editorial link, and nothing here should quietly downgrade it.
  assert.ok(!html.includes('rel='), 'no rel attribute is imposed');
});

test('both snippets carry an alt text that says what the badge is', () => {
  assert.ok(badgeHtml('lucas').includes('alt="lucas.runs-on.dev"'));
  assert.ok(badgeMarkdown('lucas').startsWith('[![lucas.runs-on.dev]'));
});

test('an unknown theme falls back to light rather than forging a url', () => {
  const s = badgeSnippets('lucas', 'neon');
  assert.equal(s.theme, 'light');
  assert.ok(!s.imageUrl.includes('theme='));
});

test('snippets carry the banner box so the preview cannot drift from them', () => {
  const s = badgeSnippets('lucas');
  assert.equal(s.width, BANNER_SIZE.width);
  assert.equal(s.height, BANNER_SIZE.height);
  assert.ok(s.html.includes(`width="${s.width}"`));
});

test('snippets agree with each other on every url', () => {
  for (const theme of BADGE_THEMES) {
    const s = badgeSnippets('lucas', theme);
    for (const snippet of [s.html, s.markdown]) {
      assert.ok(snippet.includes(s.imageUrl), `${theme}: image url matches`);
      assert.ok(snippet.includes(s.linkUrl), `${theme}: link url matches`);
    }
  }
});
