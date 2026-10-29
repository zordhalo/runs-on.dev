// Static pages plus published blog posts. Claimed subdomains live on their
// own hosts (or the built-in profile card at their own origin) and are not
// part of this site's route tree, so they don't belong in its sitemap.
import { publishedPosts } from '../lib/blog.js';

export default function sitemap() {
  const now = new Date();
  const routes = [
    '', '/about', '/blog', '/contact', '/faq', '/policy', '/privacy', '/stats',
    '/docs', '/docs/quickstart', '/docs/records', '/docs/seo', '/docs/mcp', '/docs/resources',
    '/docs/guides',
    '/docs/guides/url-redirect',
    '/docs/guides/vercel',
    '/docs/guides/netlify',
    '/docs/guides/github-pages',
    '/docs/guides/cloudflare-pages',
    '/docs/guides/render',
    '/docs/guides/railway',
    '/docs/guides/firebase',
    '/docs/guides/replit',
    '/docs/guides/codeberg-pages',
    '/docs/guides/email-forwarding',
    '/docs/guides/bluesky-handle',
    '/docs/guides/discord-verification',
  ];

  // The pages that actually change. /stats is regenerated from the registry on
  // every claim, so a monthly hint understates it by the widest margin of any
  // route here; the rest are prose that changes when someone edits it.
  const fresh = new Set(['', '/stats', '/blog']);

  const pages = routes.map((route) => ({
    url: `https://runs-on.dev${route}`,
    lastModified: now,
    changeFrequency: fresh.has(route) ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : 0.6,
  }));

  // Published posts with their real dates; drafts are excluded by the lib.
  const posts = publishedPosts().map((p) => ({
    url: `https://runs-on.dev/blog/${p.slug}`,
    lastModified: p.updated ? new Date(p.updated) : new Date(p.date),
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  return [...pages, ...posts];
}
