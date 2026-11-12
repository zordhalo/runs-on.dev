'use client';

import { useEffect, useState } from 'react';
import { commitUrl, shortSha } from '../../lib/repo.js';
import {
  modeOf, mxToLines, buildRecords,
  SUBDOMAIN_TYPES, buildSubdomains, subdomainsToRows, subdomainRowProblems,
} from '../../lib/record-fields.js';
import { providerFor } from '../../lib/stats.js';
import { PRESETS } from './host-presets.js';

const MAX_SUBDOMAINS = 10;

// The one input look for the whole form: transparent field inside a slit
// outline, chalk text, the line brightening on focus. Contrast carries the
// state, no fills.
const INPUT =
  'slit-input w-full bg-transparent px-3 py-2 font-(family-name:--font-mono) text-sm text-(--color-ink) placeholder:text-(--color-muted)/70';

// The "did it work?" panel: polls /api/dns-check after a save and compares
// live DNS against what the record now holds.
function VerifyPanel({ name, cname, url, hasDns, vercelTxt }) {
  const [check, setCheck] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer = null;
    // `check` deliberately stays out of the dependency list: a state update
    // from inside the effect re-running the effect is an unconditional fetch
    // per round trip. One fetch on mount, then every 8s, stopping when the
    // live DNS matches the file.
    const satisfied = (c) => c && cnameOk(c, cname) && pageOk(c, { cname, url, hasDns, vercelTxt });
    const tick = async () => {
      try {
        const res = await fetch(`/api/dns-check?name=${encodeURIComponent(name)}`);
        if (res.ok && alive) {
          const data = await res.json();
          setCheck(data);
          if (satisfied(data) && timer) clearInterval(timer);
        }
      } catch {}
    };
    tick();
    timer = setInterval(tick, 8000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [name, cname, url, hasDns, vercelTxt]);

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

// Tabs, in the order the form offers them. Each is an editor for one portion
// of domains/<name>.json — opening one has no effect on what a save writes,
// because every section submits only the key it owns.
const PROVIDERS = [
  { id: 'cname', label: 'Custom Domain', hint: 'Point at any host your provider gave you via CNAME.', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
  { id: 'url', label: 'Redirect', hint: 'Send visitors to any URL. Simple and fast.', icon: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
  { id: 'advanced', label: 'Advanced DNS', hint: 'A, TXT, and MX records. For power users.', icon: 'M4 6h16M4 12h16M4 18h16' },
];

// What the stored record currently makes the name do, in one line. Derived
// from the file, never from which tab is open.
function servingSummary(records = {}) {
  if ('URL' in records) return `a redirect to ${records.URL}`;
  if ('CNAME' in records) return `a custom domain (CNAME → ${records.CNAME})`;
  const types = ['A', 'TXT', 'MX'].filter((t) => t in records);
  if (types.length) return `advanced DNS (${types.join(', ')})`;
  return 'the profile card (no DNS)';
}

// The _vercel TXT values the record holds, for the verify panel. Read from
// the stored record, so the panel checks what the file actually has.
function vercelTxtFromSubdomains(subdomains) {
  const txt = (subdomains ?? {})._vercel?.TXT;
  return Array.isArray(txt) ? txt : [];
}

// The per-section save row: one button per tab, each showing only its own
// save's outcome. `disabled` + `hint` is how a guard talks: the button stays
// clickable-looking-but-off with the reason spelled out underneath, so an
// empty field can never be read as "clear the record".
function SaveRow({ section, label, status, commit, disabled, hint, onSave }) {
  const mine = status?.section === section ? status : null;
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || mine?.kind === 'saving'}
          className="btn-pill disabled:opacity-40"
        >
          {mine?.kind === 'saving' ? 'Saving…' : label}
        </button>
        {mine?.kind === 'unchanged' && (
          <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">no changes to save</span>
        )}
        {mine?.kind === 'saved' && (
          <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
            {commit ? <a className="text-(--color-ink) underline" href={commitUrl(commit)} target="_blank" rel="noopener noreferrer">commit {shortSha(commit)}</a> : 'saved'}
          </span>
        )}
      </div>
      {disabled && hint && <p className="mt-2 max-w-[600px] text-xs leading-relaxed text-(--color-muted)">{hint}</p>}
      {mine?.kind === 'error' && (
        <ul className="mt-2 space-y-1 font-(family-name:--font-mono) text-xs text-(--color-flag)">
          {(mine.errors ?? ['Could not save just now.']).map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function RecordForm({ name, record: loaded }) {
  // The record as the file holds it right now. Every successful save merges
  // exactly the keys it sent back into this baseline (the same merge the API
  // performs), so every warning and guard below is computed against what is
  // actually committed — never against a copy frozen at page load.
  const [stored, setStored] = useState(loaded);
  const storedRecords = stored.records ?? {};
  const storedTypes = Object.keys(storedRecords);
  const dnsInFile = storedTypes.length > 0;

  // Tabs are editors, not a serving choice. The tab a record already lives
  // in opens first; moving between tabs carries no data consequences.
  // A name with no DNS opens on Custom Domain, ready to point somewhere,
  // rather than on a card tab this form no longer has.
  const [tab, setTab] = useState(() => {
    const initial = modeOf(loaded.records);
    return initial === 'card' ? 'cname' : initial;
  });
  const [cname, setCname] = useState(loaded.records?.CNAME ?? '');
  // Highlight the preset the loaded CNAME already matches (a Vercel user
  // returning to their record sees the Vercel steps, not bare fields).
  // providerFor reads the provider off the target's own suffix, so the
  // per-project targets match too — matching against prefill values, as this
  // did, only ever recognised the one provider whose target we can derive.
  const [selectedPreset, setSelectedPreset] = useState(() => {
    const provider = providerFor(loaded.records);
    return PRESETS.find((p) => p.label === provider)?.id ?? null;
  });
  const [url, setUrl] = useState(loaded.records?.URL ?? '');
  const [a, setA] = useState((loaded.records?.A ?? []).join('\n'));
  const [txt, setTxt] = useState((loaded.records?.TXT ?? []).join('\n'));
  const [mx, setMx] = useState(mxToLines(loaded.records?.MX));
  const [status, setStatus] = useState(null);
  const [commit, setCommit] = useState(null);
  const [subRows, setSubRows] = useState(() => subdomainsToRows(loaded.subdomains));
  const [dnsStatus, setDnsStatus] = useState(null);

  // What each DNS tab would write right now, built from that tab's fields
  // alone. No tab reads another tab's fields, and no save sends them.
  const cnameShape = buildRecords('cname', { cname });
  const urlShape = buildRecords('url', { url });
  const advancedShape = buildRecords('advanced', { a, txt, mx });
  const shapeOfTab = { cname: cnameShape, url: urlShape, advanced: advancedShape };

  // Saving a DNS shape replaces whatever incompatible shape the file holds —
  // schema.js forbids CNAME beside A/TXT/MX and URL beside anything. That
  // replacement is the one deliberate way a save removes records, so the tab
  // that does it says so, computed from the stored baseline.
  const replacing =
    tab === 'card' || Object.keys(shapeOfTab[tab] ?? {}).length === 0
      ? []
      : storedTypes.filter((t) => !(t in shapeOfTab[tab]));

  useEffect(() => {
    fetch(`/api/dns-check?name=${encodeURIComponent(name)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setDnsStatus(data.serving?.status); })
      .catch(() => {});
  }, [name]);

  // Picking a preset swaps the placeholder and, when the preset can derive a
  // target (only GitHub Pages, from the owner's login), prefills the field —
  // but never over something the user typed themselves: only an empty field
  // or another preset's own prefill is replaced. Every other provider issues
  // a per-project target that this form cannot know, so it stays empty and
  // the placeholder carries the shape.
  function selectPreset(preset) {
    const deselecting = selectedPreset === preset.id;
    setSelectedPreset(deselecting ? null : preset.id);
    setStatus(null);
    if (deselecting) return;
    const prefill = preset.prefillFor?.(loaded.owner?.github);
    if (!prefill) return;
    const presetValues = PRESETS.map((p) => p.prefillFor?.(loaded.owner?.github)).filter(Boolean);
    if (!cname.trim() || presetValues.includes(cname.trim())) setCname(prefill);
  }

  function setRow(i, patch) {
    setSubRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setStatus(null);
  }
  function addRow() { setSubRows((rows) => [...rows, { label: '', type: 'TXT', value: '' }]); setStatus(null); }
  function removeRow(i) { setSubRows((rows) => rows.filter((_, j) => j !== i)); setStatus(null); }
  function setLinkRow(i, patch) { setLinkRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setStatus(null); }
  function removeLink(i) { setLinkRows((rows) => rows.filter((_, j) => j !== i)); setStatus(null); }

  // One POST runner for every section. The payload carries only the keys the
  // calling section owns; the API's contract is that a key absent from the
  // body is left exactly as the file has it, which is what makes a profile
  // edit structurally incapable of touching a CNAME.
  async function post(payload, section, onSuccess) {
    setStatus({ section, kind: 'saving' });
    try {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setCommit(body.commit ?? null);
        setStatus({ section, kind: body.unchanged ? 'unchanged' : 'saved' });
        setStored((prev) => {
          const head = { ...prev };
          if ('records' in payload) head.records = payload.records;
          if ('subdomains' in payload) {
            const subs = payload.subdomains;
            const empty = subs === null || (typeof subs === 'object' && Object.keys(subs).length === 0);
            if (empty) delete head.subdomains;
            else head.subdomains = subs;
          }
          if ('profile' in payload) {
            if (payload.profile === null) delete head.profile;
            else head.profile = payload.profile;
          }
          return head;
        });
        // The file changed shape, so fields belonging to the shapes it can no
        // longer hold go blank — what each tab shows must stay equal to what
        // the file holds. Skipped when the API reported no change: nothing
        // moved, so nothing needs clearing.
        if (!body.unchanged && onSuccess) onSuccess();
        return;
      }
      const errors = res.status === 409
        ? ['the record changed elsewhere a moment ago — reload the page, then save again']
        : (body.details ?? ['Could not save just now.']);
      setStatus({ section, kind: 'error', errors });
    } catch {
      setStatus({ section, kind: 'error', errors: ['network error — try again'] });
    }
  }

  const saveCname = () => {
    const shape = buildRecords('cname', { cname });
    if (!shape.CNAME) return;
    post({ records: shape }, 'cname', () => {
      setCname(shape.CNAME);
      setSelectedPreset(null);
      setUrl(''); setA(''); setTxt(''); setMx('');
    });
  };

  const saveUrl = () => {
    const shape = buildRecords('url', { url });
    if (!shape.URL) return;
    post({ records: shape }, 'url', () => {
      setCname(''); setSelectedPreset(null); setA(''); setTxt(''); setMx('');
    });
  };

  const saveAdvanced = () => {
    const shape = buildRecords('advanced', { a, txt, mx });
    if (Object.keys(shape).length === 0) return;
    post({ records: shape }, 'advanced', () => {
      setCname(''); setSelectedPreset(null); setUrl('');
    });
  };

  // A half-filled row would be dropped by buildSubdomains and the save would
  // report "no changes", so the guard names the row instead.
  const subProblems = subdomainRowProblems(subRows);
  const saveSubdomains = () => {
    if (subProblems.length) return;
    post({ subdomains: buildSubdomains(subRows) }, 'subdomains');
  };

  // Enter in an input saves the section the input belongs to.
  const activeSaver =
    tab === 'cname' ? saveCname
    : tab === 'url' ? saveUrl
    : saveAdvanced;

  const statusPill = dnsStatus === 'ok' ? { label: 'Verified', tone: 'ok' }
    : dnsStatus === 'stuck' ? { label: 'Pending', tone: 'pending' }
    : dnsStatus === 'redirect' ? { label: 'Redirect', tone: 'redirect' }
    : { label: 'Card', tone: 'neutral' };

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); activeSaver(); }}
      className="slit-frame rounded-lg"
    >
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

      {/* Section tabs. The line above them is the serving state, read from
          the file; the tabs below it are editors for one key each. */}
      <div className="px-8 py-6 sm:px-10">
        <p className="text-[14px] text-(--color-ink)">
          Right now this name serves {servingSummary(storedRecords)}.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-(--color-muted)">
          Each section saves separately and writes only its own part of the record —
          saving one can never remove another.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-3 sm:gap-8">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" aria-pressed={tab === p.id}
              onClick={() => { setTab(p.id); setStatus(null); }}
              className={`slit-frame flex flex-col items-center gap-2.5 rounded-lg p-4 text-center sm:p-5 ${tab === p.id ? 'slit-frame-bright' : ''}`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={tab === p.id ? 'text-(--color-ink)' : 'text-(--color-gold)'}>
                <path d={p.icon} />
              </svg>
              <span className={`text-[11px] tracking-[0.02em] uppercase ${tab === p.id ? 'text-(--color-ink)' : 'text-(--color-muted)'}`}>{p.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-(--color-muted)">{PROVIDERS.find((p) => p.id === tab)?.hint}</p>
      </div>

      {/* Custom Domain tab: owns the CNAME target. */}
      {tab === 'cname' && (
        <div className="slit-top px-6 py-5 sm:px-8">
          <span className="text-[14px] text-(--color-ink)">CNAME target</span>

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

          {replacing.length > 0 && (
            <p className="mt-3 slit-bar-l rounded-r-lg bg-(--color-card) px-3 py-2.5 pl-5 font-(family-name:--font-mono) text-xs leading-relaxed text-(--color-flag)">
              Saving here replaces the {replacing.join(', ')} record(s) the name has now —
              DNS allows a name to point only one way at a time.
            </p>
          )}

          {(() => {
            const preset = PRESETS.find((p) => p.id === selectedPreset);
            if (!preset) return null;
            return (
              <div className="mt-4 border border-(--color-rule) bg-(--color-card) px-4 py-3">
                <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">{'// '}{preset.label} setup</p>
                <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-(--color-ink)">
                  {preset.steps(name, loaded.owner?.github).map((step, i) => (
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

          <SaveRow
            section="cname"
            label="Save custom domain"
            status={status}
            commit={commit}
            disabled={Object.keys(cnameShape).length === 0}
            hint={'CNAME' in storedRecords
              ? 'The target is empty, so saving is off — clearing the field does not remove the record. To stop using DNS, use “turn off DNS” in the Profile Card tab.'
              : 'Enter a target above to save.'}
            onSave={saveCname}
          />
        </div>
      )}

      {/* Redirect tab: owns the URL record. */}
      {tab === 'url' && (
        <div className="slit-top px-6 py-5 sm:px-8">
          <label className="block">
            <span className="text-[14px] text-(--color-ink)">Redirect URL</span>
            <input value={url} onChange={(e) => { setUrl(e.target.value); setStatus(null); }} placeholder="https://your-site.com" spellCheck={false} className={`mt-2 ${INPUT}`} />
          </label>

          {replacing.length > 0 && (
            <p className="mt-3 slit-bar-l rounded-r-lg bg-(--color-card) px-3 py-2.5 pl-5 font-(family-name:--font-mono) text-xs leading-relaxed text-(--color-flag)">
              Saving here replaces the {replacing.join(', ')} record(s) the name has now —
              DNS allows a name to point only one way at a time.
            </p>
          )}

          <SaveRow
            section="url"
            label="Save redirect"
            status={status}
            commit={commit}
            disabled={Object.keys(urlShape).length === 0}
            hint={'URL' in storedRecords
              ? 'The URL is empty, so saving is off — clearing the field does not remove the record. To stop using DNS, use “turn off DNS” in the Profile Card tab.'
              : 'Enter a URL above to save.'}
            onSave={saveUrl}
          />
        </div>
      )}

      {/* Advanced DNS tab: owns A, TXT, and MX. */}
      {tab === 'advanced' && (
        <div className="slit-top px-6 py-5 sm:px-8">
          <p className="text-[14px] text-(--color-ink)">DNS records</p>
          <div className="mt-4 space-y-4">
            <TextArea label="A (IPv4)" value={a} onChange={(v) => { setA(v); setStatus(null); }} placeholder="76.76.21.21" hint="One address per line." />
            <TextArea label="TXT" value={txt} onChange={(v) => { setTxt(v); setStatus(null); }} placeholder="v=spf1 -all" hint="One string per line." />
            <TextArea label="MX" value={mx} onChange={(v) => { setMx(v); setStatus(null); }} placeholder="10 mx.example.com" hint="One per line, up to 5." />
          </div>

          {replacing.length > 0 && (
            <p className="mt-3 slit-bar-l rounded-r-lg bg-(--color-card) px-3 py-2.5 pl-5 font-(family-name:--font-mono) text-xs leading-relaxed text-(--color-flag)">
              Saving here replaces the {replacing.join(', ')} record(s) the name has now —
              DNS allows a name to point only one way at a time.
            </p>
          )}

          <SaveRow
            section="advanced"
            label="Save DNS records"
            status={status}
            commit={commit}
            disabled={Object.keys(advancedShape).length === 0}
            hint={['A', 'TXT', 'MX'].some((t) => t in storedRecords)
              ? 'All fields are empty, so saving is off — emptying the fields does not remove the records. To stop using DNS, use “turn off DNS” in the Profile Card tab.'
              : 'Add at least one record above to save.'}
            onSave={saveAdvanced}
          />
        </div>
      )}

      {/* Subdomain records: their own section with their own save, outside
          every tab so nothing is ever hidden or shown twice. Sending
          `subdomains` never carries `records` or `profile`, and vice versa. */}
      <SubdomainRecords name={name} subRows={subRows} setRow={setRow} addRow={addRow} removeRow={removeRow}>
        <SaveRow
          section="subdomains"
          label="Save subdomain records"
          status={status}
          commit={commit}
          disabled={subProblems.length > 0}
          hint={subProblems.join(' ')}
          onSave={saveSubdomains}
        />
      </SubdomainRecords>

      {/* Verify panel: the "did it work?" feedback after a save that touched
          DNS, checking what the file now holds. */}
      {status?.kind === 'saved' && (
        <VerifyPanel
          name={name}
          cname={storedRecords.CNAME ?? null}
          url={storedRecords.URL ?? null}
          hasDns={['A', 'TXT', 'MX'].some((t) => t in storedRecords)}
          vercelTxt={vercelTxtFromSubdomains(stored.subdomains)}
        />
      )}

    </form>
  );
}

// ── Swap zone (trade this name for a different one) ─────────
// Lives on the profile page (/manage/profile), alongside the card, badge,
// and release. Exported so that page can render it directly.
export function SwapZone({ name }) {
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
        setTimeout(() => { window.location.href = '/manage/profile'; }, 2000);
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
    <section className="slit-frame mt-16 rounded-lg">
      <div className="slit-bottom px-6 py-5 sm:px-8">
        <p className="meta">Swap</p>
        <p className="mt-2 text-sm leading-relaxed text-(--color-muted)">
          Trade {name}.runs-on.dev for a new one. All your settings (CNAME, profile,
          subdomains) carry over. The old name is released immediately and becomes
          available to anyone.
        </p>
      </div>

      <div className="px-6 py-5 sm:px-8">
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
    </section>
  );
}

// ── Release zone (give the name back to the pool) ───────────
export function ReleaseZone({ name }) {
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
    <section className="slit-frame mt-16 rounded-lg">
      <div className="slit-bottom px-6 py-5 sm:px-8">
        <p className="meta">Release</p>
        <p className="mt-2 text-sm leading-relaxed text-(--color-muted)">
          This permanently deletes the claim. The name becomes available for anyone
          to claim immediately. DNS records and the profile card are removed. This
          cannot be undone.
        </p>
      </div>

      <div className="px-6 py-5 sm:px-8">
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
    </section>
  );
}

// ── Subdomain records ────────────────────────────────────────
function SubdomainRecords({ name, subRows, setRow, addRow, removeRow, children }) {
  return (
    <div className="slit-top px-6 py-5 sm:px-8">
      <p className="text-[14px] text-(--color-ink)">Subdomain records</p>
      <p className="mt-1.5 text-xs leading-relaxed text-(--color-muted)">
        Records a provider asks for at a different name, like <code className="font-(family-name:--font-mono)">_vercel</code> for verification.
        They save separately from the tabs above — either can change without touching the other.
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
          <textarea value={row.value} onChange={(e) => setRow(i, { value: e.target.value })} rows={2} placeholder="paste the value here, e.g. vc-domain-verify=…" aria-label="Record value" spellCheck={false} className={`mt-2 ${INPUT} resize-y`} />
        </div>
      ))}
      {subRows.length < MAX_SUBDOMAINS && (
        <button type="button" onClick={addRow} className="mt-6 slit-frame rounded-[4px] px-3 py-1.5 font-(family-name:--font-mono) text-xs text-(--color-muted) hover:text-(--color-ink)">+ add a subdomain record</button>
      )}
      {children}
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
