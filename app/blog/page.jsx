import { publishedPosts, postSerial, formatSerial } from '../../lib/blog.js';
import { Divider } from '../components/ui.jsx';

export const metadata = {
  title: 'Blog',
  description: 'Updates from runs-on.dev: new features, registry changes, and engineering notes.',
  alternates: { canonical: 'https://runs-on.dev/blog' },
  openGraph: { title: 'Blog · runs-on.dev' },
};

const CATEGORY_LABEL = { announcement: 'Announcement', feature: 'Feature', engineering: 'Engineering', guide: 'Guide' };

function PostRow({ post, serial }) {
  const d = new Date(post.date);
  const date = `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}, ${d.getFullYear()}`;
  return (
    <li className="slit-top slit-dim first:border-t-0">
      <a href={`/blog/${post.slug}`} className="group block py-6 no-underline">
        {post.image && (
          <img
            src={post.image}
            alt=""
            className="mb-4 aspect-video w-full rounded-lg border border-(--color-rule) object-cover"
          />
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="font-(family-name:--font-mono) text-xs text-(--color-blue)">№ {formatSerial(serial)}</span>
            <h2 className="text-[23px] leading-[1.07] font-normal tracking-[-0.004em] text-(--color-ink) underline decoration-(--color-iron) decoration-1 underline-offset-[5px] transition-colors group-hover:decoration-(--color-blue)">
              {post.title}
            </h2>
          </div>
          <time className="font-(family-name:--font-mono) text-xs text-(--color-muted)" dateTime={post.date}>
            {date}
          </time>
        </div>
        <p className="mt-2 max-w-[640px] text-sm leading-relaxed text-(--color-muted)">{post.description}</p>
        <p className="meta mt-3">
          {CATEGORY_LABEL[post.category] ?? post.category}
          {post.tags.length > 0 && <span className="normal-case"> · {post.tags.join(' · ')}</span>}
          {post.video && <span className="ml-2 text-(--color-blue)">video</span>}
        </p>
      </a>
    </li>
  );
}

export default function Blog() {
  const posts = publishedPosts();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <p className="meta">Blog</p>
      <h1 className="mt-3 text-[34px] leading-[1.03] font-normal tracking-[-0.005em] text-(--color-ink) sm:text-[44px] sm:tracking-[-0.007em]">
        Updates
      </h1>
      <p className="mt-4 max-w-[600px] text-[16px] leading-[1.5] text-(--color-muted)">
        New features, registry changes, and engineering notes. Also available as{' '}
        <a className="text-(--color-ink) underline" href="/feed.xml">RSS</a>.
      </p>

      <Divider className="mt-10" />
      {posts.length > 0 ? (
        <ul className="!list-none !p-0">
          {posts.map((post, i) => (
            <PostRow key={post.slug} post={post} serial={i + 1} />
          ))}
        </ul>
      ) : (
        <p className="mt-10 text-sm text-(--color-muted)">No posts yet.</p>
      )}
    </main>
  );
}
