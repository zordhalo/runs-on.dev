'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// The whole deploy workflow as a paste-and-go prompt for a coding agent. The
// token rides inside it (or a placeholder before one exists), because the
// one thing an agent cannot do for itself is mint a browser-session
// credential — everything after that is three curl-able endpoints.
function agentPrompt(token, expiresNote) {
  return `You are deploying a static site to runs-on.dev for me.

AUTH
Bearer token (publishes only to my claimed runs-on.dev name, ${expiresNote}):
${token}
Send it as an Authorization: Bearer header on every request below. Never
commit it to git, log it, or send it anywhere except runs-on.dev.

BASE URL: https://runs-on.dev

1) DEPLOY
- Build the site first. The upload is the BUILT static output (HTML, CSS,
  JS, assets), never the source project.
- Zip the output so index.html sits at the ROOT of the zip, not inside a
  dist/ or public/ folder:
    cd <output-directory> && zip -r site.zip .
- Upload:
    curl -X POST https://runs-on.dev/api/sites/deploy \\
      -H "Authorization: Bearer ${token}" \\
      -F "site=@site.zip"
- Success is 200 with { url, deploymentId, files, bytes }. Tell me the url
  and the deploymentId.

ZIP RULES (enforced server-side; a bad zip is rejected with a reason)
- index.html is required at the zip root
- zip at most 10 MB, uncompressed total at most 100 MB, at most 500 entries
- relative paths only: no leading /, no .., no drive letters, no backslashes
- no encrypted entries, standard stored/deflate compression only, no
  duplicate file names

2) LIST DEPLOYMENTS
    curl -H "Authorization: Bearer ${token}" \\
      https://runs-on.dev/api/sites/deployments
Returns { active, deployments: [{ id, at, files, bytes }] }, newest last.

3) ROLL BACK (instant, no re-upload)
    curl -X POST https://runs-on.dev/api/sites/rollback \\
      -H "Authorization: Bearer ${token}" \\
      -H "Content-Type: application/json" \\
      -d '{"deploymentId":"<8-hex id from the list>"}'

ERRORS: fix per code, never blind-retry
- 400 no_index_html: re-zip with index.html at the root
- 400 invalid_zip plus a reason: fix the zip per the reason
- 413 too_big: shrink assets, then redeploy
- 409 stale: a newer deploy landed mid-flight. List deployments, decide,
  then redeploy
- 429 rate_limited: wait the Retry-After seconds, retry once
- 503: runs-on.dev is busy or its storage is not configured. Tell me and
  stop retrying

NOTES
- The last 5 deployments are kept; older ones are deleted and cannot be
  rolled back to.
- If the url still shows a profile card, serving is not enabled on
  runs-on.dev yet; the deployment itself succeeded.
- Deploying never touches DNS records or the profile card settings.`;
}

// Small outlined action in the system's voice: a fading slit frame that
// brightens on hover. Used for the secondary copy/regenerate controls.
// Inline Lucide marks for the duration dropdown (no icon package in the
// repo; the blog toolbar sets the same pattern).
function ChevronDownIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function DurationCheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
const MINI = 'slit-frame rounded-[4px] px-2.5 py-1.5 font-(family-name:--font-mono) text-xs text-(--color-muted) hover:text-(--color-ink)';

// The livespan options the mint offers. The server re-validates these, so a
// tampered dropdown just falls back to 30 days.
const DURATIONS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Day number, month name, year number — a locale's "9/22/2026" reads as
// month-first in some countries and day-first in others, so the name is
// spelled out to kill the ambiguity.
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

// The deploy-token card. Account-scoped, unlike the record forms beside it,
// which are per-name: one login mints one kind of credential, and the
// deployment it unlocks is always that account's own name. Tokens are
// tracked in the registry since the list arrived, so they can be shown,
// aged out automatically, and deleted by hand before they expire.
export default function TokenZone({ login }) {
  const [state, setState] = useState('idle'); // idle | minting | minted | error
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [errorCode, setErrorCode] = useState(null);
  const [durationDays, setDurationDays] = useState(30);
  // Opt-in: a manage token can also edit DNS through the MCP server. Off by
  // default so the common case (a CI deploy key) stays deploy-only.
  const [manage, setManage] = useState(false);

  // The key list: what the registry holds for this login right now.
  const [keys, setKeys] = useState(null); // null = not loaded yet
  const [keysError, setKeysError] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [durationOpen, setDurationOpen] = useState(false);
  const durationRef = useRef(null);

  // Click outside (or Escape) closes the duration menu.
  useEffect(() => {
    if (!durationOpen) return;
    const onPointerDown = (e) => {
      if (durationRef.current && !durationRef.current.contains(e.target)) setDurationOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setDurationOpen(false);
    };
    // Scrolling the page also closes the menu, so an open menu can never
    // slide beneath the sticky navbar and end up with the logo on top of it.
    const onScroll = () => setDurationOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll);
    };
  }, [durationOpen]);

  const refreshKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/tokens');
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (body && Array.isArray(body.tokens)) {
        setKeys(body.tokens);
        setKeysError(false);
      } else {
        setKeysError(true);
      }
    } catch {
      setKeysError(true);
    }
  }, []);

  useEffect(() => {
    refreshKeys();
  }, [refreshKeys]);

  async function mint() {
    setState('minting');
    setCopied(false);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationDays, scope: manage ? 'manage' : 'sites' }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.token) {
        setToken(body.token);
        setExpiresAt(body.expiresAt);
        setState('minted');
        refreshKeys();
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }

  async function removeKey(id) {
    setDeletingId(id);
    try {
      const res = await fetch('/api/tokens', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) setKeys((list) => (list ?? []).filter((k) => k.id !== id));
    } catch {}
    setDeletingId(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function copyPrompt(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {}
  }

  return (
    <section className="slit-frame rounded-lg">
      <div className="slit-bottom px-6 py-5 sm:px-8">
        <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">@{login}</p>
        <h2 className="mt-1.5 text-[23px] leading-[1.07] font-normal tracking-[-0.004em] text-(--color-ink)">Deploy &amp; agent token</h2>
      </div>

      <div className="px-6 py-6 sm:px-8">
        <p className="max-w-[540px] text-sm leading-relaxed text-(--color-muted)">
          Publish a static site to your name from a terminal or a coding agent, no browser
          needed. Pick how long the key should live, generate it, then:
        </p>
        <pre className="slit-frame mt-4 rounded-lg bg-(--color-card) px-3 py-2.5 font-(family-name:--font-mono) text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word] text-(--color-ash)">
{`curl -X POST https://runs-on.dev/api/sites/deploy \\
  -H "Authorization: Bearer <token>" \\
  -F "site=@dist.zip"`}
        </pre>
        <p className="mt-4 max-w-[540px] text-sm leading-relaxed text-(--color-muted)">
          Or connect an agent (Claude Code, Codex, Cursor) to the MCP server and let it deploy,
          and with a manage token, edit your DNS. <a href="/docs/mcp" className="underline hover:text-(--color-ink)">MCP guide</a>
        </p>
        <pre className="slit-frame mt-3 rounded-lg bg-(--color-card) px-3 py-2.5 font-(family-name:--font-mono) text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word] text-(--color-ash)">
{`claude mcp add --transport http runs-on \\
  https://runs-on.dev/.well-known/mcp \\
  --header "Authorization: Bearer <token>"`}
        </pre>

        {state !== 'minted' && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {/* Auto-delete duration: the key stops working on its own after
                this long, without anyone having to remember to revoke it.
                Custom dropdown — no native select chrome. */}
            <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">Expire After</span>
            <div className="relative" ref={durationRef}>
              <button
                type="button"
                onClick={() => setDurationOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={durationOpen}
                className="slit-frame flex items-center gap-2 rounded-[4px] px-2.5 py-1.5 font-(family-name:--font-mono) text-xs text-(--color-ink)"
              >
                {DURATIONS.find((d) => d.days === durationDays)?.label}
                <ChevronDownIcon />
              </button>
              {durationOpen && (
                <div
                  role="listbox"
                  aria-label="Token lifetime"
                  className="absolute left-0 top-[calc(100%+6px)] z-30 w-40 rounded-[4px] border border-(--color-rule) bg-(--color-paper) p-1 shadow-xl"
                >
                  {DURATIONS.map((d) => (
                    <button
                      key={d.days}
                      type="button"
                      role="option"
                      aria-selected={durationDays === d.days}
                      onClick={() => { setDurationDays(d.days); setDurationOpen(false); }}
                      className={`flex w-full items-center justify-between rounded-[3px] px-2.5 py-1.5 text-left font-(family-name:--font-mono) text-xs ${durationDays === d.days ? 'bg-(--color-card) text-(--color-ink)' : 'text-(--color-muted) hover:text-(--color-ink)'}`}
                    >
                      {d.label}
                      {durationDays === d.days && <DurationCheckIcon />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="flex cursor-pointer items-center gap-2 font-(family-name:--font-mono) text-xs text-(--color-muted)">
              <input
                type="checkbox"
                checked={manage}
                onChange={(e) => setManage(e.target.checked)}
                className="accent-(--color-ink)"
              />
              also edit DNS (manage)
            </label>
            <button
              type="button"
              onClick={mint}
              disabled={state === 'minting'}
              className="btn-pill px-4 py-2 text-xs"
            >
              {state === 'minting' ? 'Generating…' : 'Generate token'}
            </button>
            {state === 'error' && (
              <span className="font-(family-name:--font-mono) text-xs text-(--color-flag)">
                could not generate just now, try again
              </span>
            )}
          </div>
        )}

        {state === 'minted' && (
          <div className="mt-5 space-y-3">
            {/* Shown exactly once: the secret itself is never stored, so the
                list below can show that a key exists but never its value. */}
            <div className="slit-bar-l rounded-r-lg bg-(--color-card) p-3 pl-4">
              <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
                shown once · copy it now
              </p>
              <div className="mt-2 flex items-start gap-3">
                <code className="min-w-0 flex-1 break-all font-(family-name:--font-mono) text-xs text-(--color-ink)">
                  {token}
                </code>
                <button type="button" onClick={copy} className={`shrink-0 ${MINI}`}>
                  {copied ? 'copied' : 'copy'}
                </button>
              </div>
            </div>
            <p className="max-w-[540px] text-xs leading-relaxed text-(--color-muted)">
              Expires {expiresAt ? fmtDate(expiresAt) : 'soon'}.
              Treat it like a password: it can publish to your name{manage ? ' and repoint its DNS' : ''}, nothing else.
              Delete it below any time, or let it age out on its own.
            </p>
            <button type="button" onClick={mint} className={MINI}>
              generate another
            </button>
          </div>
        )}

        {/* Previously created keys, straight from the registry. Deleting one
            revokes it immediately: the deploy front door checks this list. */}
        <div className="slit-top mt-6 pt-4">
          <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">your keys</p>
          {keysError && (
            <p className="mt-2 font-(family-name:--font-mono) text-xs text-(--color-flag)">
              could not load your keys right now
            </p>
          )}
          {keys !== null && !keysError && keys.length === 0 && (
            <p className="mt-2 text-xs text-(--color-muted)">no live keys.</p>
          )}
          {keys !== null && keys.length > 0 && (
            <ul className="mt-3 space-y-2">
              {keys.map((key) => (
                <li key={key.id} className="slit-frame flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[4px] px-3 py-2 font-(family-name:--font-mono) text-xs">
                  <span className="text-(--color-ink)">#{key.id.slice(0, 8)}</span>
                  <span className="text-(--color-muted)">{key.scope === 'manage' ? 'manage' : 'deploy'}</span>
                  <span className="text-(--color-muted)">created {fmtDate(key.createdAt)}</span>
                  <span className="text-(--color-muted)">expires {fmtDate(key.expiresAt)}</span>
                  <button
                    type="button"
                    onClick={() => removeKey(key.id)}
                    disabled={deletingId === key.id}
                    className="ml-auto text-(--color-muted) underline hover:text-(--color-flag) disabled:opacity-40"
                  >
                    {deletingId === key.id ? 'deleting…' : 'delete'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* The paste-and-go agent prompt. Embeds the real token only while
            this render has one (the mint response is shown once); after a
            reload it falls back to the placeholder, because the secret never
            comes back from the list. The runbook panel is a plain carbon
            fill (no frame) so its vertical scroll never clips a tail. */}
        {(() => {
          const live = state === 'minted';
          const expiresNote = live
            ? `expires ${expiresAt ? fmtDate(expiresAt) : 'soon'}`
            : 'expires after the lifetime you pick';
          const text = agentPrompt(
            live ? token : 'rod1.YOUR_TOKEN (generate one above first)',
            expiresNote,
          );
          return (
            <details className="slit-frame mt-6 rounded-lg" open={live}>
              <summary className="cursor-pointer px-4 py-3 font-(family-name:--font-mono) text-xs text-(--color-ink)">
                {'// '}hand this to your AI agent
              </summary>
              <div className="slit-top px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="max-w-[420px] text-xs leading-relaxed text-(--color-muted)">
                    A complete deploy-runbook prompt. {live
                      ? 'Your token is already embedded.'
                      : 'Generate a token first and it will embed itself.'}
                  </p>
                  <button type="button" onClick={() => copyPrompt(text)} className={`shrink-0 ${MINI}`}>
                    {copiedPrompt ? 'copied' : 'copy prompt'}
                  </button>
                </div>
                <pre className="mt-3 max-h-96 overflow-y-auto rounded-lg bg-(--color-card) px-3 py-2.5 font-(family-name:--font-mono) text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word] text-(--color-ash)">
{text}
                </pre>
              </div>
            </details>
          );
        })()}
      </div>
    </section>
  );
}
