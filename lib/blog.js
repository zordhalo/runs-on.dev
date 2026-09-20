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

// The .md twin of a post: the same file a contributor would have committed,
// rebuilt from the baked fields so there is one source of truth per field.
// Served at /blog/<slug>.md for agents and the copy-page menu's "view as
// markdown"; gray-matter parses it back into exactly the same fields.
export function markdownTwin(post) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = ['---', `title: "${esc(post.title)}"`];
  if (post.description) lines.push(`description: "${esc(post.description)}"`);
  lines.push(`date: "${post.date}"`);
  if (post.updated) lines.push(`updated: "${post.updated}"`);
  lines.push(`author: "${esc(post.author)}"`);
  if (post.category) lines.push(`category: "${post.category}"`);
  if (post.tags?.length) lines.push(`tags: [${post.tags.map((t) => `"${esc(t)}"`).join(', ')}]`);
  if (post.image) lines.push(`image: ${post.image}`);
  if (post.video) lines.push(`video: ${post.video}`);
  lines.push('---');
  return `${lines.join('\n')}\n\n${post.markdown ?? ''}\n`;
}

export function renderMarkdown() {
  // Kept for callers that render raw markdown; blog posts ship pre-rendered.
  throw new Error('posts are pre-rendered at generation time');
}
