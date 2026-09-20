// Blog content access: the generated module is the source of truth, so these
// tests read the real committed data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPost, publishedPosts, postSerial } from '../lib/blog.js';

test('publishedPosts lists the launch posts, published only, newest first', () => {
  const posts = publishedPosts();
  assert.ok(posts.length >= 3, `expected the launch posts, got ${posts.length}`);
  for (const p of posts) {
    assert.equal(p.status, 'published');
    assert.ok(p.title.length > 0);
    assert.ok(p.html.includes('<'), 'posts ship pre-rendered html');
  }
  for (let i = 1; i < posts.length; i++) {
    assert.ok(posts[i - 1].date >= posts[i].date, 'sorted newest first');
  }
});

test('getPost returns a post by slug with rendered html', () => {
  const post = getPost('2026-09-12-a-new-look-for-runs-on-dev');
  assert.equal(post.title, 'A new look for runs-on.dev');
  assert.ok(post.html.includes('<h2>'), 'markdown rendered to headings');
  assert.ok(post.html.includes('<p>'), 'paragraphs rendered');
});

test('unknown, invalid, and draft slugs resolve to null', () => {
  assert.equal(getPost('no-such-post'), null);
  // Traversal attempts: the slug grammar admits no separators, so getPost
  // cannot be walked out of the generated content.
  for (const slug of ['../secret', 'a/b', '..', 'UPPER', '']) {
    assert.equal(getPost(slug), null, slug);
  }
});

test('the redesign post carries its featured cover', () => {
  const post = getPost('2026-09-12-a-new-look-for-runs-on-dev');
  assert.equal(post.image, '/blog-media/redesign-cover.png');
});


test('the redesign post carries its featured cover', () => {
  const post = getPost('2026-09-12-a-new-look-for-runs-on-dev');
  assert.equal(post.image, '/blog-media/redesign-cover.png');
});


test('serial numbers count newest-first from 1', () => {
  const posts = publishedPosts();
  assert.equal(postSerial(posts[0].slug), 1, 'newest post is №1');
  assert.equal(postSerial(posts[posts.length - 1].slug), posts.length, 'oldest post has the highest serial');
  assert.equal(postSerial('no-such-post'), null);
});

// The .md twin (served at /blog/<slug>.md and copied by the post toolbar)
// must round-trip: gray-matter parses it back into the same fields.
test('markdownTwin rebuilds a parseable markdown file', async () => {
  const { default: matter } = await import('gray-matter');
  const { markdownTwin } = await import('../lib/blog.js');
  const post = getPost('2026-09-12-a-new-look-for-runs-on-dev');
  const twin = markdownTwin(post);
  const { data, content } = matter(twin);
  assert.equal(data.title, post.title);
  assert.equal(data.date, post.date);
  assert.equal(data.category, post.category);
  assert.ok(content.includes('darker, quieter'), 'body content rides along');
  for (const post of publishedPosts()) {
    assert.ok(post.markdown.length > 0, `${post.slug} carries markdown`);
  }
});
