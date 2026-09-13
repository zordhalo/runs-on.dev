'use client';

import { useEffect, useState } from 'react';
import { commitUrl, shortSha } from '../../lib/repo.js';
import {
  modeOf, mxToLines, buildRecords,
  SUBDOMAIN_TYPES, buildSubdomains, subdomainsToRows,
  buildProfile, profileToRows,
} from '../../lib/record-fields.js';

const MAX_SUBDOMAINS = 10;
const MAX_LINKS = 8;

// The one input look for the whole form: transparent field inside a slit
// outline, chalk text, the line brightening on focus. Contrast carries the
// state, no fills.
const INPUT =
  'slit-input w-full bg-transparent px-3 py-2 font-(family-name:--font-mono) text-sm text-(--color-ink) placeholder:text-(--color-muted)/70';

// The "did it work?" panel: polls /api/dns-check after a save and compares
// live DNS against what was committed.
function VerifyPanel({ name, cname, url, hasDns, vercelTxt }) {
  const [check, setCheck] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/dns-check?name=${encodeURIComponent(name)}`);
        if (res.ok && alive) setCheck(await res.json());
      } catch {}
    };
    tick();
    const done = check && cnameOk(check, cname) && pageOk(check, { cname, url, hasDns, vercelTxt });
    const timer = done ? null : setInterval(tick, 8000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [name, cname, url, hasDns, vercelTxt, check]);

  if (!check) {
    return (
      <div className="slit-top px-6 py-4 font-(family-name:--font-mono) text-xs text-(--color-muted) sm:px-8">
        {'// checking DNS…'}
      </div>
    );
  }

  const rows = [];
  if (cname) {
    const resolved = check.cname ?? [];
    rows.push({
      ok: resolved.some((r) => r.toLowerCase() === cname.toLowerCase()),
      text: resolved.length ? `CNAME → ${resolved[0]}` : 'CNAME not visible yet',
    });
  }
  if (vercelTxt.length > 0) {
    const zone = check.txt?.zoneVercel ?? [];
    const published = vercelTxt.some((v) => zone.includes(v));
    rows.push({
      ok: published,
      text: published ? '_vercel TXT published at the zone' : '_vercel TXT not at the zone yet',
    });
  }
  const page = pageState(check, { cname, url, hasDns });
  rows.push({ ok: page.ok, text: page.text });

  return (
    <div className="slit-top px-6 py-4 sm:px-8">
      <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">{'// did it work?'}</p>
      <ul className="mt-2 space-y-1.5 font-(family-name:--font-mono) text-xs">
        {rows.map((row, i) => (
          <li key={i} className={row.ok ? 'text-(--color-ink)' : 'text-(--color-muted)'}>
            <span className={row.ok ? 'text-(--color-pulse)' : ''}>{row.ok ? '✓' : '…'}</span> {row.text}
          </li>
        ))}
      </ul>
      {page.hint && <p className="mt-2.5 max-w-[600px] text-xs leading-relaxed text-(--color-muted)">{page.hint}</p>}
    </div>
  );
}

function cnameOk(check, cname) {
  if (!cname) return true;
  return (check.cname ?? []).some((r) => r.toLowerCase() === cname.toLowerCase());
}

function pageOk(check, expected) {
  return pageState(check, expected).ok;
}

function pageState(check, { cname, url, hasDns }) {
  const status = check.serving?.status;
  if (status === 'ok') return { ok: true, text: `serving your site: ${check.serving.title ?? ''}` };
  if (status === 'redirect' && url) return { ok: true, text: `redirecting to ${check.serving.finalUrl ?? url}` };
  if (status === 'card' && !hasDns && !cname) return { ok: true, text: 'serving the profile card (as picked)' };
  if (status === 'card' || status === 'stuck') {
    return {
      ok: false,
      text: 'still serving the profile card',
      hint: cname?.includes('vercel-dns')
        ? 'DNS is live but Vercel has not re-checked. Removing and re-adding the domain in your Vercel project settings forces a fresh check.'
        : 'DNS may still be propagating.',
    };
  }
  return { ok: false, text: 'no answer yet. DNS may still be propagating' };
}

const PROVIDERS = [
  { id: 'card', label: 'Profile Card', hint: 'Serve a card built from your GitHub profile. No DNS needed.', icon: 'M3 10h18M7 15h.01M11 15h.01M15 15h.01M7 19h10a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v7a4 4 0 0 0 4 4Z' },
  { id: 'cname', label: 'Custom Domain', hint: 'Point at any host your provider gave you via CNAME.', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
  { id: 'url', label: 'Redirect', hint: 'Send visitors to any URL. Simple and fast.', icon: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
  { id: 'advanced', label: 'Advanced DNS', hint: 'A, TXT, and MX records. For power users.', icon: 'M4 6h16M4 12h16M4 18h16' },
];

// Provider presets for CNAME mode. Each one knows the target shape the
// provider actually needs and the steps that provider requires beyond DNS —
// which is exactly where the health check's stuck names come from: pointing
// at a deployment URL instead of a custom-domain target, or attaching the
// domain on the provider's side never happening at all. The preset fills the
// half DNS can do and walks the user through the half it can't.
const PRESETS = [
  {
    id: 'github-pages',
    label: 'GitHub Pages',
    placeholder: 'yourusername.github.io',
    prefillFor: (login) => (login ? `${String(login).toLowerCase()}.github.io` : ''),
    guide: null,
    steps: (name, login) => [
      `Target ${login ? `${String(login).toLowerCase()}.github.io` : 'yourusername.github.io'} (or <project>.github.io if the site lives in a project repo)`,
      `In that repo: Settings → Pages → Custom domain, enter ${name}.runs-on.dev, save`,
      "Save here. The zone publishes within a minute, HTTPS follows on GitHub's side",
    ],
  },
  {
    id: 'netlify',
    label: 'Netlify',
    placeholder: 'your-site.netlify.app',
    prefillFor: null,
    guide: null,
    steps: (name) => [
      "Target your site's netlify.app address (Domain settings shows it)",
      `In Netlify: Domain settings → Add a domain → ${name}.runs-on.dev`,
      'Save here, then let Netlify provision the certificate',
    ],
  },
  {
    id: 'cloudflare-pages',
    label: 'Cloudflare Pages',
    placeholder: 'your-project.pages.dev',
    prefillFor: null,
    guide: null,
    steps: (name) => [
      "Target your project's pages.dev address",
      `In Cloudflare: your Pages project → Custom domains → Set up a custom domain → ${name}.runs-on.dev`,
      'Save here. Cloudflare issues the certificate once the CNAME is live',
    ],
  },
  {
    id: 'vercel',
    label: 'Vercel',
    placeholder: 'cname.vercel-dns.com',
    prefillFor: () => 'cname.vercel-dns.com',
    guide: '/docs/guides/vercel',
    steps: (name) => [
      `In your Vercel project: Settings → Domains → Add, enter ${name}.runs-on.dev`,
      'It will show a verification TXT starting with vc-domain-verify= — copy the whole value',
      'Add it below as a subdomain record: label _vercel, type TXT',
      'Save here. Vercel needs one re-check after the TXT is live, so give it a minute',
    ],
  },
  {
    id: 'render',
    label: 'Render',
    placeholder: 'your-service.onrender.com',
    prefillFor: null,
    guide: null,
    steps: (name) => [
      "Target your service's onrender.com address",
      `In Render: your service → Settings → Custom Domains → Add ${name}.runs-on.dev`,
      'Save here; Render validates the CNAME and issues the certificate',
    ],
  },
];

export default function RecordForm({ name, record }) {
  const [mode, setMode] = useState(() => modeOf(record.records));
  const [cname, setCname] = useState(record.records?.CNAME ?? '');
  // Highlight the preset the loaded CNAME already matches (a Vercel user
  // returning to their record sees the Vercel steps, not bare fields). Only
  // derivable values match; anything hand-typed leaves no chip active.
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const initial = record.records?.CNAME ?? '';
    if (!initial) return null;
    const ownerLogin = record.owner?.github;
    return PRESETS.find((p) => p.prefillFor?.(ownerLogin) === initial)?.id ?? null;
  });
  const [url, setUrl] = useState(record.records?.URL ?? '');
  const [a, setA] = useState((record.records?.A ?? []).join('\n'));
  const [txt, setTxt] = useState((record.records?.TXT ?? []).join('\n'));
  const [mx, setMx] = useState(mxToLines(record.records?.MX));
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState([]);
  const [commit, setCommit] = useState(null);
  const [subRows, setSubRows] = useState(() => subdomainsToRows(record.subdomains));
  const [displayName, setDisplayName] = useState(record.profile?.name ?? '');
  const [bio, setBio] = useState(record.profile?.bio ?? '');
  const [linkRows, setLinkRows] = useState(() => profileToRows(record.profile));
  const [dnsStatus, setDnsStatus] = useState(null);

  // What the record held when the page loaded, not what the form currently
  // builds: the point is to warn that saving in a mode that drops records the
  // file already has — card wipes everything, redirect drops a CNAME, cname
  // drops A/TXT/MX — before the user hits Save.
  const existingTypes = Object.keys(record.records ?? {});
  const MODE_LABEL = { card: 'Profile Card', cname: 'Custom Domain', url: 'Redirect', advanced: 'Advanced DNS' };
  // buildRecords(mode) returns exactly the types that mode can express, so
  // any record type the file holds that the mode cannot keep is one that
  // save would remove.
  const kept = new Set(Object.keys(buildRecords(mode, { cname, url, a, txt, mx })));
  const dropped = existingTypes.filter((t) => !kept.has(t));
  const willDropRecords = dropped.length > 0;

  useEffect(() => {
    fetch(`/api/dns-check?name=${encodeURIComponent(name)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setDnsStatus(data.serving?.status); })
      .catch(() => {});
  }, [name]);

  function selectProvider(id) {
    setMode(id);
    setStatus(null);
    setErrors([]);
  }

  // Picking a preset swaps the placeholder and, when the preset can derive a
  // target (GitHub Pages from the owner's login, Vercel's generic), prefills
  // the field — but never over something the user typed themselves: only an
  // empty field or another preset's own prefill is replaced.
  function selectPreset(preset) {
    const deselecting = selectedPreset === preset.id;
    setSelectedPreset(deselecting ? null : preset.id);
    setStatus(null);
    if (deselecting) return;
    const prefill = preset.prefillFor?.(record.owner?.github);
    if (!prefill) return;
    const presetValues = PRESETS.map((p) => p.prefillFor?.(record.owner?.github)).filter(Boolean);
    if (!cname.trim() || presetValues.includes(cname.trim())) setCname(prefill);
  }

  function setRow(i, patch) {
    setSubRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setStatus(null);
    setErrors([]);
  }
  function addRow() { setSubRows((rows) => [...rows, { label: '', type: 'TXT', value: '' }]); setStatus(null); }
  function removeRow(i) { setSubRows((rows) => rows.filter((_, j) => j !== i)); setStatus(null); }
  function setLinkRow(i, patch) { setLinkRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setStatus(null); }
  function removeLink(i) { setLinkRows((rows) => rows.filter((_, j) => j !== i)); setStatus(null); }

  async function save(event) {
    event.preventDefault();
    setStatus('saving');
    setErrors([]);
    const res = await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        records: buildRecords(mode, { cname, url, a, txt, mx }),
        subdomains: buildSubdomains(subRows),
        profile: buildProfile({ name: displayName, bio, linkRows }) ?? null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { setCommit(body.commit ?? null); setStatus(body.unchanged ? 'unchanged' : 'saved'); return; }
    setErrors(body.details ?? ['Could not save just now.']);
    setStatus('error');
  }

  const sha = shortSha(commit);
  const statusPill = dnsStatus === 'ok' ? { label: 'Verified', tone: 'ok' }
    : dnsStatus === 'stuck' ? { label: 'Pending', tone: 'pending' }
    : dnsStatus === 'redirect' ? { label: 'Redirect', tone: 'redirect' }
    : { label: 'Card', tone: 'neutral' };

  return (
    <form onSubmit={save} className="slit-frame rounded-lg">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 slit-bottom px-6 py-5 sm:px-8">
        <div>
          <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">domains/{name}.json</p>
          <h2 className="mt-1.5 text-[23px] leading-[1.07] font-normal tracking-[-0.004em] text-(--color-ink)">{name}.runs-on.dev</h2>
        </div>
        <span className="inline-flex items-center gap-2 slit-frame rounded-[4px] bg-(--color-badge) px-3.5 py-2 font-(family-name:--font-mono) text-[12px] tracking-[0.05em] text-(--color-muted) uppercase">
          <span
            aria-hidden="true"
            className={`inline-block h-1.5 w-1.5 rounded-full ${statusPill.tone === 'ok' ? 'pulse-dot' : ''}`}
            style={{
              background:
                statusPill.tone === 'ok' ? '#98ff38'
                : statusPill.tone === 'pending' ? '#eab308'
                : statusPill.tone === 'redirect' ? '#8ea1ff'
                : '#9c9c9c',
            }}
          />
          {statusPill.label}
        </span>
      </div>

      {/* Provider tiles. Icon strokes sit in Compass Gold, the reference's
          reserved icon color; the active tile is traced in white instead. */}
      <div className="px-8 py-6 sm:px-10">
        <p className="text-[14px] text-(--color-ink)">Where does your name go?</p>
        <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-8">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" onClick={() => selectProvider(p.id)}
              className={`slit-frame flex flex-col items-center gap-2.5 rounded-lg p-4 text-center sm:p-5 ${mode === p.id ? 'slit-frame-bright' : ''}`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={mode === p.id ? 'text-(--color-ink)' : 'text-(--color-gold)'}>
                <path d={p.icon} />
              </svg>
              <span className={`text-[11px] tracking-[0.02em] uppercase ${mode === p.id ? 'text-(--color-ink)' : 'text-(--color-muted)'}`}>{p.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-(--color-muted)">{PROVIDERS.find((p) => p.id === mode)?.hint}</p>
      </div>

      {/* Mode-specific section. The profile editor lives outside this
          switch (further down) because `profile` and `records` are
          independent keys — gating the bio behind this mode meant anyone
          with a CNAME who wanted to edit their bio silently lost their
          records. */}
      {mode === 'card' && (
        <div className="slit-top px-6 py-5 sm:px-8">
          <p className="text-[14px] text-(--color-ink)">Profile card</p>
          <p className="mt-1.5 text-xs leading-relaxed text-(--color-muted)">
            Your name serves a card built from your GitHub profile. No DNS records are published.
          </p>
        </div>
      )}

      {/* Warn when a save in this mode would remove records the file
          currently holds. The WYSIWYG model makes switching mode drop
          anything the new mode can't express; the banner makes that
          visible rather than silent, for every destructive transition
          (card, redirect, and cname each drop whatever the record had). */}
      {willDropRecords && (
        <div className="slit-top px-6 py-3 sm:px-8">
          <p className="slit-bar-l rounded-r-lg bg-(--color-card) px-3 py-2.5 pl-5 font-(family-name:--font-mono) text-xs leading-relaxed text-(--color-flag)">
            Saving in {MODE_LABEL[mode]} mode removes the {dropped.join(', ')} record(s)
            on this name. To edit your card or redirect without changing where the name points,
            edit the profile section below or keep your current mode.
          </p>
        </div>
      )}

      {/* Custom Domain mode */}
      {mode === 'cname' && (
        <>
          <div className="slit-top px-6 py-5 sm:px-8">
            <span className="text-[14px] text-(--color-ink)">CNAME target</span>

            {/* Provider presets: fill the target shape and walk the steps
                that provider needs beyond DNS. Optional — a plain hostname
                typed below works exactly as before. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPreset(p)}
                  aria-pressed={selectedPreset === p.id}
                  className={`border px-3 py-1.5 font-(family-name:--font-mono) text-xs transition-colors ${
                    selectedPreset === p.id
                      ? 'border-(--color-signal) bg-(--color-signal)/10 text-(--color-signal)'
                      : 'border-(--color-rule) text-(--color-muted) hover:border-(--color-muted) hover:text-(--color-ink)'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="block">
              <input
                value={cname}
                onChange={(e) => { setCname(e.target.value); setStatus(null); }}
                placeholder={PRESETS.find((p) => p.id === selectedPreset)?.placeholder ?? 'your-provider.example.com'}
                aria-label="CNAME target"
                spellCheck={false}
                autoCapitalize="off"
                className={`mt-3 ${INPUT}`}
              />
            </label>
            <p className="mt-2 text-xs text-(--color-muted)">Copy the exact value from your provider.</p>

            {(() => {
              const preset = PRESETS.find((p) => p.id === selectedPreset);
              if (!preset) return null;
              return (
                <div className="mt-4 border border-(--color-rule) bg-(--color-card) px-4 py-3">
                  <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">{'// '}{preset.label} setup</p>
                  <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-(--color-ink)">
                    {preset.steps(name, record.owner?.github).map((step, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-(family-name:--font-mono) text-(--color-muted)">{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  {preset.guide && (
                    <a href={preset.guide} className="mt-3 inline-block font-(family-name:--font-mono) text-xs text-(--color-signal) underline">
                      full guide →
                    </a>
                  )}
                </div>
              );
            })()}
          </div>
          <SubdomainRecords name={name} subRows={subRows} setRow={setRow} addRow={addRow} removeRow={removeRow} />
        </>
      )}

      {/* Redirect mode */}
      {mode === 'url' && (
        <div className="slit-top px-6 py-5 sm:px-8">
          <label className="block">
            <span className="text-[14px] text-(--color-ink)">Redirect URL</span>
            <input value={url} onChange={(e) => { setUrl(e.target.value); setStatus(null); }} placeholder="https://your-site.com" spellCheck={false} className={`mt-2 ${INPUT}`} />
          </label>
        </div>
      )}

      {/* Advanced DNS mode */}
      {mode === 'advanced' && (
        <div className="slit-top px-6 py-5 sm:px-8">
          <p className="text-[14px] text-(--color-ink)">DNS records</p>
          <div className="mt-4 space-y-4">
            <TextArea label="A (IPv4)" value={a} onChange={(v) => { setA(v); setStatus(null); }} placeholder="76.76.21.21" hint="One address per line." />
            <TextArea label="TXT" value={txt} onChange={(v) => { setTxt(v); setStatus(null); }} placeholder="v=spf1 -all" hint="One string per line." />
            <TextArea label="MX" value={mx} onChange={(v) => { setMx(v); setStatus(null); }} placeholder="10 mx.example.com" hint="One per line, up to 5." />
          </div>
          <SubdomainRecords name={name} subRows={subRows} setRow={setRow} addRow={addRow} removeRow={removeRow} />
        </div>
      )}

      {/* Profile card fields. Always available, whatever the records mode:
          `profile` is its own key on the record and is served by the card, so
          editing a bio must never require touching where the name points. */}
      <div className="slit-top px-6 py-5 sm:px-8">
        <p className="text-[14px] text-(--color-ink)">Profile card details</p>
        <p className="mt-1.5 text-xs leading-relaxed text-(--color-muted)">
          {mode === 'card'
            ? 'Override any field below. Blank falls back to your GitHub profile.'
            : 'Saved with your name and shown if you ever switch to the profile card. Editing these does not change your DNS.'}
        </p>
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="meta normal-case">display name</span>
            <input value={displayName} onChange={(e) => { setDisplayName(e.target.value); setStatus(null); }} placeholder="GitHub profile name" className={`mt-2 ${INPUT}`} />
          </label>
          <label className="block">
            <span className="meta normal-case">bio</span>
            <textarea value={bio} onChange={(e) => { setBio(e.target.value); setStatus(null); }} placeholder="GitHub profile bio" rows={2} className={`mt-2 ${INPUT} resize-y`} />
          </label>
          {linkRows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={row.label} onChange={(e) => setLinkRow(i, { label: e.target.value })} placeholder="My portfolio" aria-label="Link label" className={`w-36 ${INPUT}`} />
              <input value={row.url} onChange={(e) => setLinkRow(i, { url: e.target.value })} placeholder="https://…" aria-label="Link URL" spellCheck={false} className={`min-w-0 flex-1 ${INPUT}`} />
              <button type="button" onClick={() => removeLink(i)} className="font-(family-name:--font-mono) text-xs text-(--color-muted) underline transition-colors hover:text-(--color-ink)">remove</button>
            </div>
          ))}
          {linkRows.length < MAX_LINKS && (
            <button type="button" onClick={() => { setLinkRows((rows) => [...rows, { label: '', url: '' }]); setStatus(null); }} className="slit-frame rounded-[4px] px-3 py-1.5 font-(family-name:--font-mono) text-xs text-(--color-muted) hover:text-(--color-ink)">+ add a link</button>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="flex flex-wrap items-center gap-4 slit-top px-6 py-5 sm:px-8">
        <button type="submit" disabled={status === 'saving'} className="btn-pill">
          {status === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
        {status === 'unchanged' && <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">no changes to save</span>}
        {status === 'saved' && (
          <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
            {sha ? <a className="text-(--color-ink) underline" href={commitUrl(commit)} target="_blank" rel="noopener noreferrer">commit {sha}</a> : 'saved'}
          </span>
        )}
        {errors.length > 0 && <ul className="mt-2 space-y-1 font-(family-name:--font-mono) text-xs text-(--color-flag)">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </div>

      {/* Verify panel: the "did it work?" feedback after a save, part of
          the manage page since PR #57. */}
      {status === 'saved' && (
        <VerifyPanel
          name={name}
          cname={mode === 'cname' ? cname.trim() : null}
          url={mode === 'url' ? url.trim() : null}
          hasDns={mode === 'advanced'}
          vercelTxt={subRows
            .filter((r) => r.label.trim().toLowerCase() === '_vercel' && r.type === 'TXT')
            .flatMap((r) => r.value.split('\n').map((v) => v.trim()).filter(Boolean))}
        />
      )}

      {/* Danger zone: release the name back to the pool */}
      <SwapZone name={name} />
      <ReleaseZone name={name} />
    </form>
  );
}

// ── Swap zone (trade this name for a different one) ─────────
function SwapZone({ name }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [swapping, setSwapping] = useState(false);
  const [result, setResult] = useState(null);

  const validateNewName = (v) => {
    const trimmed = v.trim().toLowerCase();
    return /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(trimmed) && trimmed.length >= 2 && trimmed !== name;
  };

  const canSwap = validateNewName(newName) && confirmText.trim().toLowerCase() === newName.trim().toLowerCase();

  const swap = async () => {
    if (!canSwap) return;
    setSwapping(true);
    setResult(null);
    try {
      const res = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: name,
          to: newName.trim().toLowerCase(),
          confirm: confirmText.trim().toLowerCase(),
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body.ok) {
        setResult({ ok: true, text: body.message });
        setTimeout(() => { window.location.href = '/manage'; }, 2000);
      } else {
        setResult({ ok: false, text: body.detail ?? body.error ?? 'swap failed' });
      }
    } catch {
      setResult({ ok: false, text: 'network error' });
    }
    setSwapping(false);
  };

  const nameAvailable = validateNewName(newName);

  return (
    <div className="slit-top px-6 py-5 sm:px-8">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-(family-name:--font-mono) text-xs text-(--color-muted) underline transition-colors hover:text-(--color-ink)"
        >
          swap this name for a different one
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-[14px] text-(--color-ink)">Swap {name}.runs-on.dev</p>
          <p className="max-w-[600px] text-xs leading-relaxed text-(--color-muted)">
            Trade this name for a new one. All your settings (CNAME, profile, subdomains)
            carry over. The old name is released immediately and becomes available to anyone.
          </p>

          <div className="space-y-2">
            <input
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setResult(null); }}
              placeholder="new-name"
              aria-label="New name to swap to"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={`${INPUT} ${nameAvailable || !newName ? '' : 'slit-input-flag'}`}
            />
            {newName && !nameAvailable && (
              <p className="text-xs text-(--color-flag)">
                {newName.trim().toLowerCase() === name ? "that's your current name" : 'invalid name (2-32 chars, a-z 0-9 hyphens)'}
              </p>
            )}
            {nameAvailable && (
              <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
                → {newName.trim().toLowerCase()}.runs-on.dev
              </p>
            )}
          </div>

          {nameAvailable && (
            <div>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={`type "${newName.trim().toLowerCase()}" to confirm`}
                aria-label="Type the new name to confirm swap"
                spellCheck={false}
                autoCapitalize="off"
                className={INPUT}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={swap}
              disabled={swapping || !canSwap}
              className="btn-pill px-4 py-2 text-xs"
            >
              {swapping ? 'Swapping…' : `Swap to ${newName.trim().toLowerCase() || '…'}`}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setNewName(''); setConfirmText(''); setResult(null); }}
              className="btn-ghost px-4 py-2 text-xs"
            >
              Cancel
            </button>
          </div>

          {result && (
            <p className={`font-(family-name:--font-mono) text-xs ${result.ok ? 'text-(--color-pulse)' : 'text-(--color-flag)'}`}>
              {result.ok ? '✓ ' : '✗ '}{result.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Release zone (give the name back to the pool) ───────────
function ReleaseZone({ name }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [result, setResult] = useState(null);

  const release = async () => {
    if (confirmText.trim().toLowerCase() !== name) return;
    setReleasing(true);
    setResult(null);
    try {
      const res = await fetch('/api/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, confirm: confirmText.trim().toLowerCase() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        setResult({ ok: true, text: body.message });
        // Redirect to homepage after a short delay so the user sees the confirmation
        setTimeout(() => { window.location.href = '/'; }, 2000);
      } else {
        setResult({ ok: false, text: body.detail ?? body.error ?? 'release failed' });
      }
    } catch {
      setResult({ ok: false, text: 'network error' });
    }
    setReleasing(false);
  };

  return (
    <div className="slit-top px-6 py-5 sm:px-8">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-(family-name:--font-mono) text-xs text-(--color-flag) underline hover:opacity-80"
        >
          release this name
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-[14px] text-(--color-flag)">Release {name}.runs-on.dev?</p>
          <p className="max-w-[600px] text-xs leading-relaxed text-(--color-muted)">
            This permanently deletes your claim. The name becomes available for anyone
            to claim immediately. DNS records and your profile card are removed.
            This cannot be undone.
          </p>
          {/* Stacked on mobile: the confirm input is flex-1 in the same row as
              two buttons, which squeezed it to a few characters on a phone --
              exactly the field someone has to type a name into exactly. Inline
              again from sm up, where there is room for all three. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`type "${name}" to confirm`}
              aria-label="Type the name to confirm release"
              spellCheck={false}
              autoCapitalize="off"
              className={`${INPUT} slit-input-flag sm:w-auto sm:flex-1`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={release}
                disabled={releasing || confirmText.trim().toLowerCase() !== name}
                className="slit-frame slit-frame-flag rounded-[4px] px-4 py-2 font-(family-name:--font-mono) text-xs text-(--color-flag) disabled:opacity-40"
              >
                {releasing ? 'Releasing…' : 'Release permanently'}
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); setConfirmText(''); setResult(null); }}
                className="btn-ghost px-4 py-2 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
          {result && (
            <p className={`font-(family-name:--font-mono) text-xs ${result.ok ? 'text-(--color-pulse)' : 'text-(--color-flag)'}`}>
              {result.ok ? '✓ ' : '✗ '}{result.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Subdomain records ────────────────────────────────────────
function SubdomainRecords({ name, subRows, setRow, addRow, removeRow }) {
  return (
    <div className="slit-top px-6 py-5 sm:px-8">
      <p className="text-[14px] text-(--color-ink)">Subdomain records</p>
      <p className="mt-1.5 text-xs leading-relaxed text-(--color-muted)">
        Records a provider asks for at a different name, like <code className="font-(family-name:--font-mono)">_vercel</code> for verification.
      </p>
      {subRows.map((row, i) => (
        <div key={i} className="slit-frame mt-12 rounded-lg p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={row.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="_vercel" aria-label="Subdomain label" spellCheck={false} className={`w-32 ${INPUT}`} />
            <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">.{name}.runs-on.dev</span>
            <select value={row.type} onChange={(e) => setRow(i, { type: e.target.value })} aria-label="Record type" className={`w-auto ${INPUT}`}>
              {SUBDOMAIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button type="button" onClick={() => removeRow(i)} className="ml-auto font-(family-name:--font-mono) text-xs text-(--color-muted) underline transition-colors hover:text-(--color-ink)">remove</button>
          </div>
          <textarea value={row.value} onChange={(e) => setRow(i, { value: e.target.value })} rows={2} aria-label="Record value" spellCheck={false} className={`mt-2 ${INPUT} resize-y`} />
        </div>
      ))}
      {subRows.length < MAX_SUBDOMAINS && (
        <button type="button" onClick={addRow} className="mt-6 slit-frame rounded-[4px] px-3 py-1.5 font-(family-name:--font-mono) text-xs text-(--color-muted) hover:text-(--color-ink)">+ add a subdomain record</button>
      )}
    </div>
  );
}

// ── TextArea helper ──────────────────────────────────────────
function TextArea({ label, value, onChange, placeholder, hint }) {
  return (
    <label className="block">
      <span className="meta normal-case">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} spellCheck={false} className={`mt-2 ${INPUT} resize-y`} />
      {hint && <span className="mt-1.5 block text-xs text-(--color-muted)">{hint}</span>}
    </label>
  );
}
