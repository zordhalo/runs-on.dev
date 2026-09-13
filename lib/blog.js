// Blog content access: reads the generated committed module
// (lib/blog-posts.generated.js, built from content/blog/*.md by
// scripts/generate-blog-content.mjs). Blog pages never read the
// filesystem, so prerendering is hermetic on any build worker.
import { BLOG_POSTS } from './blog-posts.generated.js';

// Re-exported: pages and tests import the raw list from here so there is a
// single module path for blog content.
export { BLOG_POSTS };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function publishedPosts() {
  return BLOG_POSTS.filter((p) => p.status === 'published');
}

export function getPost(slug) {
  if (!SLUG.test(slug)) return null; // blocks traversal: no separators survive the grammar
  return BLOG_POSTS.find((p) => p.slug === slug && p.status === 'published') ?? null;
}

// Serial numbers: the newest published post is №1 and older posts shift up
// as new ones land. Computed from publish order, never stored — storage
// would go stale the moment a post is added, edited, or released.
export function postSerial(slug) {
  const idx = publishedPosts().findIndex((p) => p.slug === slug);
  return idx === -1 ? null : idx + 1;
}

export function formatSerial(n) {
  return String(n).padStart(3, '0');
}

export function renderMarkdown() {
  // Kept for callers that render raw markdown; blog posts ship pre-rendered.
  throw new Error('posts are pre-rendered at generation time');
}
