'use client';

import { useState } from 'react';

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

// The deploy-token card. Account-scoped, unlike the record forms above it,
// which are per-name: one login mints one kind of credential, and the
// deployment it unlocks is always that account's own name.
export default function TokenZone({ login }) {
  const [state, setState] = useState('idle'); // idle | minting | minted | error
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  async function mint() {
    setState('minting');
    setCopied(false);
    try {
      const res = await fetch('/api/tokens', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.token) {
        setToken(body.token);
        setExpiresAt(body.expiresAt);
        setState('minted');
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
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
    <section className="border border-(--color-rule) bg-(--color-card)">
      <div className="border-b border-(--color-rule) px-6 py-5 sm:px-8">
        <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">@{login}</p>
        <h2 className="mt-1 font-(family-name:--font-display) text-xl font-medium tracking-tight text-(--color-ink) sm:text-2xl">
          Deploy token
        </h2>
      </div>

      <div className="px-6 py-5 sm:px-8">
        <p className="text-sm leading-relaxed text-(--color-muted)">
          Publish a static site to your name from a terminal or a coding agent, no browser
          needed. Generate a token, then:
        </p>
        <pre className="mt-3 overflow-x-auto border border-(--color-rule) px-3 py-2 font-(family-name:--font-mono) text-xs leading-relaxed text-(--color-ink)">
{`curl -X POST https://runs-on.dev/api/sites/deploy \\
  -H "Authorization: Bearer <token>" \\
  -F "site=@dist.zip"`}
        </pre>

        {state !== 'minted' && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={mint}
              disabled={state === 'minting'}
              className="border px-4 py-2 font-(family-name:--font-mono) text-xs transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal)', color: 'var(--color-paper)' }}
            >
              {state === 'minting' ? 'Generating…' : 'Generate token'}
            </button>
            {state === 'error' && (
              <span className="font-(family-name:--font-mono) text-xs text-(--color-signal)">
                could not generate just now, try again
              </span>
            )}
          </div>
        )}

        {state === 'minted' && (
          <div className="mt-4 space-y-3">
            {/* Shown exactly once: the server stores nothing, so there is no
                list to come back to and no way to show it again later. */}
            <div className="border border-(--color-signal) px-3 py-2">
              <p className="font-(family-name:--font-mono) text-xs text-(--color-signal)">
                shown once — copy it now
              </p>
              <div className="mt-2 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all font-(family-name:--font-mono) text-xs text-(--color-ink)">
                  {token}
                </code>
                <button type="button" onClick={copy} className="shrink-0 border border-(--color-rule) px-2 py-1 font-(family-name:--font-mono) text-xs transition-opacity hover:opacity-80">
                  {copied ? 'copied' : 'copy'}
                </button>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-(--color-muted)">
              Expires {expiresAt ? new Date(expiresAt).toLocaleDateString() : 'in 30 days'}.
              Treat it like a password: it can publish to your name and nothing else.
              Generating another does not revoke this one — old tokens simply expire.
            </p>
            <button type="button" onClick={mint} className="border border-(--color-rule) px-3 py-1.5 font-(family-name:--font-mono) text-xs transition-opacity hover:opacity-80">
              generate another
            </button>
          </div>
        )}

        {/* The paste-and-go agent prompt. Embeds the real token only while
            this render has one (the mint response is shown once); after a
            reload it falls back to the placeholder, because stateless tokens
            cannot be listed or shown again. */}
        {(() => {
          const live = state === 'minted';
          const expiresNote = live
            ? `expires ${expiresAt ? new Date(expiresAt).toLocaleDateString() : 'in 30 days'}`
            : 'expires 30 days after you generate it';
          const text = agentPrompt(
            live ? token : 'rod1.YOUR_TOKEN (generate one above first)',
            expiresNote,
          );
          return (
            <details className="mt-6 border border-(--color-rule)" open={live}>
              <summary className="cursor-pointer px-4 py-3 font-(family-name:--font-mono) text-xs text-(--color-ink)">
                {'// '}hand this to your AI agent
              </summary>
              <div className="border-t border-(--color-rule) px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs leading-relaxed text-(--color-muted)">
                    A complete deploy-runbook prompt. {live
                      ? 'Your token is already embedded.'
                      : 'Generate a token first and it will embed itself.'}
                  </p>
                  <button type="button" onClick={() => copyPrompt(text)} className="shrink-0 border border-(--color-rule) px-2 py-1 font-(family-name:--font-mono) text-xs transition-opacity hover:opacity-80">
                    {copiedPrompt ? 'copied' : 'copy prompt'}
                  </button>
                </div>
                <pre className="mt-3 max-h-96 overflow-auto border border-(--color-rule) bg-(--color-paper) px-3 py-2 font-(family-name:--font-mono) text-xs leading-relaxed text-(--color-ink) whitespace-pre-wrap">
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
