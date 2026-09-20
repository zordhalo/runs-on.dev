import { getPost, markdownTwin, publishedPosts } from '../../../../lib/blog.js';

// The .md twin of a blog post, served at /blog/<slug>.md (proxy.js rewrites
// the extension form here). A distinct URL with its own content type, so no
// Vary negotiation games the way the llms.txt index needs. Prerendered like
// the post page itself: agents get a static file, not a rendered-on-demand
// response.
export const dynamic = 'force-static';

export function generateStaticParams() {
  return publishedPosts().map((p) => ({ slug: p.slug }));
}

export async function GET(_request, { params }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return new Response('not found', { status: 404 });

  return new Response(markdownTwin(post), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
    },
  });
}
