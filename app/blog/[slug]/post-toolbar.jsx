'use client';

import { useEffect, useRef, useState } from 'react';

// The blog post toolbar, the chanhdai.com pattern rebuilt in this repo's
// language: post-to-post back/forward, a split copy-page button (label
// copies, chevron opens the menu), an "On this page" jump menu, and share /
// forward. No dropdown dependency — menus are small client components with
// outside-click and Escape handling, styled from the same tokens as the
// rest of the site. Icons are verbatim Lucide path data inlined as SVG (the
// repo has no icon package; see app/edge-picker.jsx for the same pattern).

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
const ArrowRightIcon = icon(
  <>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </>,
);
const CopyIcon = icon(
  <>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>,
);
const CheckIcon = icon(<path d="M20 6 9 17l-5-5" />);
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
const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);
const ListTreeIcon = icon(
  <>
    <path d="M21 12h-8" />
    <path d="M21 6h-8" />
    <path d="M21 18h-8" />
    <path d="M9 6v12" />
    <rect width="4" height="16" x="3" y="4" rx="1" />
  </>,
);

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

// Brand marks for the AI agents, verbatim from each vendor, rendered in
// white. Fill-based logos, not stroke icons like the UI set above.
const ChatGPTIcon = () => (
  <svg viewBox="0 0 24 24" fill="#FFFFFF" fillRule="evenodd" width="15" height="15" aria-hidden="true">
    <title>OpenAI (ChatGPT)</title>
    <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
  </svg>
);
const ClaudeIcon = () => (
  <svg viewBox="0 0 24 24" fill="#FFFFFF" role="img" width="15" height="15" aria-hidden="true">
    <title>Claude</title>
    <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
  </svg>
);
const GrokIcon = () => (
  <svg viewBox="0 0 1024 1024" fill="none" width="15" height="15" aria-hidden="true">
    <title>Grok</title>
    <path
      d="M395.479 633.828L735.91 381.105C752.599 368.715 776.454 373.548 784.406 392.792C826.26 494.285 807.561 616.253 724.288 699.996C641.016 783.739 525.151 802.104 419.247 760.277L303.556 814.143C469.49 928.202 670.987 899.995 796.901 773.282C896.776 672.843 927.708 535.937 898.785 412.476L899.047 412.739C857.105 231.37 909.358 158.874 1016.4 10.6326C1018.93 7.11771 1021.47 3.60279 1024 0L883.144 141.651V141.212L395.392 633.916"
      fill="#FFFFFF"
    />
    <path
      d="M325.226 695.251C206.128 580.84 226.662 403.776 328.285 301.668C403.431 226.097 526.549 195.254 634.026 240.596L749.454 186.994C728.657 171.88 702.007 155.623 671.424 144.2C533.19 86.9942 367.693 115.465 255.323 228.382C147.234 337.081 113.244 504.215 171.613 646.833C215.216 753.423 143.739 828.818 71.7385 904.916C46.2237 931.893 20.6216 958.87 0 987.429L325.139 695.339"
      fill="#FFFFFF"
    />
  </svg>
);

const AI_PROMPT = 'Read this article and give me a summary: ';
const AI_AGENTS = [
  { label: 'ChatGPT', Icon: ChatGPTIcon, build: (u) => `https://chatgpt.com/?q=${encodeURIComponent(AI_PROMPT + u)}` },
  { label: 'Claude', Icon: ClaudeIcon, build: (u) => `https://claude.ai/new?q=${encodeURIComponent(AI_PROMPT + u)}` },
  { label: 'Grok', Icon: GrokIcon, build: (u) => `https://grok.com/?q=${encodeURIComponent(AI_PROMPT + u)}` },
];

const ghostButton =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-(--color-muted) no-underline transition-colors hover:bg-(--color-card) hover:text-(--color-ink) outline-none focus-visible:ring-2 focus-visible:ring-(--color-signal)';
const disabledButton =
  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-(--color-muted) opacity-40';
const menuItem =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-(--color-ink) no-underline transition-colors hover:bg-(--color-card)';
const panelClass =
  // Floating panel: absolute + z-index. Not slit-frame — that class carries
  // position: relative, which silently un-positions an absolute utility and
  // drops the menu into the page flow, pushing content down.
  'absolute right-0 top-[calc(100%+6px)] z-50 w-60 rounded-lg border border-(--color-rule) bg-(--color-paper) p-1.5 shadow-xl';

export default function PostToolbar({ slug, title, description, markdown, headings = [], back = null, forward = null }) {
  const url = `https://runs-on.dev/blog/${slug}`;

  const [openMenu, setOpenMenu] = useState(null); // 'copy' | 'toc' | null
  // Per-copy tick feedback: which control fired ('page', 'share', or a menu
  // item key), so the check renders exactly where the action happened.
  const [copied, setCopied] = useState(null);
  const [doneItem, setDoneItem] = useState(null); // last finished copy-menu item
  const copyRef = useRef(null);
  const tocRef = useRef(null);

  // Close whichever menu is open on outside click and Escape.
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e) => {
      const ref = openMenu === 'copy' ? copyRef : tocRef;
      if (ref.current && !ref.current.contains(e.target)) setOpenMenu(null);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const flashCopied = (key) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
  };

  // Menu copy: wait for the clipboard write to succeed, show the tick beside
  // the item that ran, then close the menu once the success is visible.
  const copyFromMenu = async (key, text) => {
    const ok = await copyText(text);
    if (ok) {
      setDoneItem(key);
      setTimeout(() => {
        setDoneItem(null);
        setOpenMenu(null);
      }, 900);
    }
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

  const postLink = (post, direction) => {
    if (!post) {
      return (
        <span className={disabledButton} aria-disabled="true">
          {direction === 'back' ? <ArrowLeftIcon size={15} /> : <ArrowRightIcon size={15} />}
        </span>
      );
    }
    const navLabel = direction === 'back' ? `Newer post: ${post.title}` : `Earlier post: ${post.title}`;
    return (
      <a
        href={`/blog/${post.slug}`}
        className={ghostButton}
        title={post.title}
        aria-label={navLabel}
      >
        {direction === 'back' ? <ArrowLeftIcon size={15} /> : <ArrowRightIcon size={15} />}
      </a>
    );
  };

  const itemContent = (key, label, icon) =>
    doneItem === key || copied === key ? (
      <>
        <CheckIcon size={15} />
        <span className="text-(--color-signal)">{label === 'Copy page' ? 'Copied' : label}</span>
      </>
    ) : (
      <>
        {icon}
        {label}
      </>
    );

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex items-center gap-1">
        <a href="/blog" className={`${ghostButton} -ml-2.5`} aria-label="Back to all posts">
          <ArrowLeftIcon size={15} />
          Blog
        </a>
        {postLink(back, 'back')}
        {postLink(forward, 'forward')}
      </div>

      <div className="flex items-center gap-1">
        {headings.length > 0 && (
          <div className="relative" ref={tocRef}>
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === 'toc' ? null : 'toc'))}
              aria-haspopup="menu"
              aria-expanded={openMenu === 'toc'}
              className={ghostButton}
            >
              <ListTreeIcon size={15} />
              <span className="max-[32rem]:hidden">On this page</span>
              <ChevronDownIcon size={13} />
            </button>
            {openMenu === 'toc' && (
              <div
                role="menu"
                aria-label="On this page"
                className={`${panelClass} max-h-80 overflow-y-auto`}
              >
                <p className="meta px-2.5 pb-1 pt-0.5">On this page</p>
                {headings.map((h) => (
                  <a
                    key={h.id}
                    role="menuitem"
                    href={`#${h.id}`}
                    className={`${menuItem} ${h.level === 3 ? 'pl-6' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      setOpenMenu(null);
                    }}
                  >
                    {h.text}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="relative" ref={copyRef}>
          {/* Split control: the label copies the page itself; the chevron is
              the only thing that opens the menu. */}
          <div className="inline-flex items-center rounded-lg">
            <button
              type="button"
              aria-label="Copy page as markdown"
              className={ghostButton}
              onClick={async () => {
                if (await copyText(markdown)) flashCopied('page');
              }}
            >
              {copied === 'page' ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              <span className="max-[28rem]:hidden">{copied === 'page' ? 'Copied' : 'Copy page'}</span>
            </button>
            <button
              type="button"
              aria-label="More copy options"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'copy'}
              className={`${ghostButton} px-1.5`}
              onClick={() => setOpenMenu((m) => (m === 'copy' ? null : 'copy'))}
            >
              <ChevronDownIcon size={13} />
            </button>
          </div>

          {openMenu === 'copy' && (
            <div role="menu" aria-label="More copy options" className={panelClass}>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={async () => copyFromMenu('page', markdown)}
              >
                {itemContent('page', 'Copy page', <CopyIcon size={15} />)}
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={async () => copyFromMenu('text', markdownToText(markdown))}
              >
                {itemContent('text', 'Copy as plain text', <FileTextIcon size={15} />)}
              </button>
              <a role="menuitem" target="_blank" rel="noopener" href={`/blog/${slug}.md`} className={menuItem}>
                <FileTextIcon size={15} />
                View as markdown
              </a>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={async () => copyFromMenu('link', url)}
              >
                {itemContent('link', 'Copy link', <LinkIcon size={15} />)}
              </button>

              <div role="separator" className="mx-2 my-1.5 h-px bg-(--color-rule)" />
              <p className="meta px-2.5 pb-1 pt-0.5">Open in AI agents</p>
              {AI_AGENTS.map((agent) => (
                <a
                  key={agent.label}
                  role="menuitem"
                  target="_blank"
                  rel="noopener"
                  href={agent.build(url)}
                  className={menuItem}
                >
                  <agent.Icon />
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
      </div>
    </div>
  );
}
