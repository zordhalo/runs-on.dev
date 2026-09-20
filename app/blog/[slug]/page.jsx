import { notFound } from 'next/navigation';
import { getPost, publishedPosts, postSerial, formatSerial } from '../../../lib/blog.js';
import PostToolbar from './post-toolbar.jsx';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return publishedPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: 'Not found' };

  // Optional featured media from frontmatter, absolute-ized for crawlers.
  const media = {};
  if (post.image) media.images = [{ url: new URL(post.image, 'https://runs-on.dev').toString() }];
  if (post.video) media.videos = [{ url: new URL(post.video, 'https://runs-on.dev').toString() }];

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `https://runs-on.dev/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [post.author],
      tags: post.tags,
      ...media,
    },
    twitter: {
      card: post.image ? 'summary_large_image' : 'summary',
      title: post.title,
      description: post.description,
      images: media.images,
    },
  };
}

const CATEGORY_LABEL = { announcement: 'Announcement', feature: 'Feature', engineering: 'Engineering', guide: 'Guide' };

export default async function BlogPost({ params }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const html = post.html;
  const d = new Date(post.date);
  const date = `${d.toLocaleString('en-US', { month: 'long' })} ${d.getDate()}, ${d.getFullYear()}`;
  const updated = post.updated ? new Date(post.updated).toISOString() : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: updated ?? post.date,
    author: { '@type': 'Organization', name: post.author, url: 'https://advancelabs.dev' },
    mainEntityOfPage: `https://runs-on.dev/blog/${post.slug}`,
    keywords: post.tags.join(', '),
  };

  const serial = postSerial(slug);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mb-8">
        <PostToolbar slug={post.slug} title={post.title} description={post.description} markdown={post.markdown} />
      </div>

      <p className="meta">
        <span className="text-(--color-blue)">№ {formatSerial(serial)}</span>
        {' · '}
        {CATEGORY_LABEL[post.category] ?? post.category} · {post.date}
      </p>
      <h1 className="mt-3 text-[34px] leading-[1.08] font-normal tracking-[-0.005em] text-(--color-ink) sm:text-[44px] sm:tracking-[-0.007em]">
        {post.title}
      </h1>
      <p className="mt-4 text-[16px] leading-[1.5] text-(--color-muted)">{post.description}</p>
      <p className="meta mt-5">
        by {post.author} · published {date}
        {updated && ` · updated ${new Date(updated).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
      </p>

      {post.image && (
        <img
          src={post.image}
          alt={post.title}
          className="mt-8 w-full rounded-lg border border-(--color-rule)"
        />
      )}
      {post.video && (
        <video
          src={post.video}
          controls
          preload="metadata"
          className="mt-8 w-full rounded-lg border border-(--color-rule)"
        />
      )}

      <article
        className="post-prose mt-10"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <div className="slit-top mt-16 pt-8">
        <p className="meta">More</p>
        <p className="mt-3 text-sm">
          <a className="text-(--color-ink) underline" href="/blog">All updates</a>
          {' · '}
          <a className="text-(--color-ink) underline" href="/feed.xml">RSS</a>
          {' · '}
          <a className="text-(--color-ink) underline" href="/stats">Registry stats</a>
        </p>
      </div>
    </main>
  );
}
