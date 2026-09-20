'use client';

import { useEffect, useRef, useState } from 'react';

// The blog post toolbar, the chanhdai.com pattern rebuilt in this repo's
// language: a back link, a copy-page dropdown fed by the post's raw
// markdown, share and forward, and links that hand the post's .md twin to
// AI agents. No dropdown dependency — the menu is a small client component
// with outside-click and Escape handling, styled from the same tokens as
// the rest of the site.

function icon(children) {
  return function Icon({ size = 16 }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    );
  };
}

const ArrowLeftIcon = icon(
  <>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </>,
);
const CopyIcon = icon(
  <>
    <rect width="14" height="14" x="8" y="8" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>,
);
const FileTextIcon = icon(
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </>,
);
const LinkIcon = icon(
  <>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>,
);
const ShareIcon = icon(
  <>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="m16 6-4-4-4 4" />
    <path d="M12 2v13" />
  </>,
);
const ForwardIcon = icon(
  <>
    <path d="m15 17 5-5-5-5" />
    <path d="M20 12H9a4 4 0 0 0-4 4v2" />
  </>,
);
const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);
const CheckIcon = icon(<path d="M20 6 9 17l-5-5" />);

// Plain-text view of a post: markdown stripped down to readable lines.
// Deliberately small — this is clipboard text, not a renderer.
function markdownToText(md) {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context or a permission grant; the
    // execCommand path covers the stragglers.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

const AI_PROMPT = 'Read this article and give me a summary: ';
const AI_AGENTS = [
  { label: 'ChatGPT', build: (u) => `https://chatgpt.com/?q=${encodeURIComponent(AI_PROMPT + u)}` },
  { label: 'Claude', build: (u) => `https://claude.ai/new?q=${encodeURIComponent(AI_PROMPT + u)}` },
  { label: 'Perplexity', build: (u) => `https://www.perplexity.ai/search?q=${encodeURIComponent(AI_PROMPT + u)}` },
];

const ghostButton =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-(--color-muted) no-underline transition-colors hover:bg-(--color-card) hover:text-(--color-ink) outline-none focus-visible:ring-2 focus-visible:ring-(--color-signal)';
const menuItem =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-(--color-ink) no-underline transition-colors hover:bg-(--color-card)';

export default function PostToolbar({ slug, title, description, markdown }) {
  const url = `https://runs-on.dev/blog/${slug}`;
  const mdUrl = `${url}.md`;

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(null);
  const menuRef = useRef(null);

  // Close on outside click and Escape while the menu is open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Transient "copied" check on whichever control fired, menu or share.
  const flashCopied = (key) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  const copyAndClose = async (key, text) => {
    if (await copyText(text)) flashCopied(key);
    setOpen(false);
  };

  const share = async () => {
    // Web Share where it exists; everywhere else the share IS a copy link.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: description, url });
        return;
      } catch {
        return; // dismissed by the user
      }
    }
    if (await copyText(url)) flashCopied('share');
  };

  const menuLabel = (key, label, icon) =>
    copied === key ? (
      <>
        <CheckIcon size={15} />
        <span className="text-(--color-signal)">Copied</span>
      </>
    ) : (
      <>
        {icon}
        {label}
      </>
    );

  return (
    <div className="flex items-center justify-between gap-4">
      <a
        href="/blog"
        className={`${ghostButton} -ml-2.5`}
        aria-label="Back to all posts"
        onClick={(e) => {
          if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
            e.preventDefault();
            history.back();
          }
        }}
      >
        <ArrowLeftIcon size={15} />
        Blog
      </a>

      <div className="flex items-center gap-1">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            className={ghostButton}
          >
            {copied === 'page' ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            <span className="max-[28rem]:hidden">{copied === 'page' ? 'Copied' : 'Copy page'}</span>
            <ChevronDownIcon size={13} />
          </button>

          {open && (
            <div
              role="menu"
              aria-label="Copy page"
              className="slit-frame absolute right-0 top-[calc(100%+6px)] z-50 w-60 rounded-lg bg-(--color-paper) p-1.5"
            >
              <button type="button" role="menuitem" className={menuItem} onClick={() => copyAndClose('page', markdown)}>
                {menuLabel('page', 'Copy page', <CopyIcon size={15} />)}
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => copyAndClose('text', markdownToText(markdown))}
              >
                {menuLabel('text', 'Copy as plain text', <FileTextIcon size={15} />)}
              </button>
              <a role="menuitem" target="_blank" rel="noopener" href={`/blog/${slug}.md`} className={menuItem}>
                <FileTextIcon size={15} />
                View as markdown
              </a>
              <button type="button" role="menuitem" className={menuItem} onClick={() => copyAndClose('link', url)}>
                {menuLabel('link', 'Copy link', <LinkIcon size={15} />)}
              </button>

              <div role="separator" className="mx-2 my-1.5 h-px bg-(--color-rule)" />
              <p className="meta px-2.5 pb-1 pt-0.5">Open in AI agents</p>
              {AI_AGENTS.map((agent) => (
                <a
                  key={agent.label}
                  role="menuitem"
                  target="_blank"
                  rel="noopener"
                  href={agent.build(mdUrl)}
                  className={menuItem}
                >
                  {agent.label}
                  <span aria-hidden="true" className="ml-auto text-(--color-muted)">
                    ↗
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>

        <button type="button" onClick={share} aria-label="Share this post" className={ghostButton}>
          {copied === 'share' ? <CheckIcon size={15} /> : <ShareIcon size={15} />}
          <span className="max-[32rem]:hidden">{copied === 'share' ? 'Copied' : 'Share'}</span>
        </button>

        <a
          aria-label="Forward this post by email"
          className={ghostButton}
          href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${description}\n\n${url}`)}`}
        >
          <ForwardIcon size={15} />
          <span className="max-[32rem]:hidden">Forward</span>
        </a>
      </div>
    </div>
  );
}
