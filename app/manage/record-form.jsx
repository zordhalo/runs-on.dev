'use client';

import { useState } from 'react';
import { commitUrl, shortSha } from '../../lib/repo.js';
import {
  modeOf, mxToLines, buildRecords,
  SUBDOMAIN_TYPES, buildSubdomains, subdomainsToRows,
} from '../../lib/record-fields.js';

const MAX_SUBDOMAINS = 10;

const MODE_LABELS = [
  { id: 'card', label: 'profile card', hint: 'No DNS records. The name serves your GitHub card.' },
  { id: 'cname', label: 'CNAME', hint: 'Point at a host your provider gave you. Stands alone.' },
  { id: 'advanced', label: 'A / TXT / MX', hint: 'IPv4 addresses, text records, and mail exchangers. Combinable.' },
  { id: 'url', label: 'URL redirect', hint: 'Redirect visitors to an absolute http(s) URL. Stands alone.' },
];

export default function RecordForm({ name, record }) {
  const [mode, setMode] = useState(() => modeOf(record.records));
  const [cname, setCname] = useState(record.records?.CNAME ?? '');
  const [url, setUrl] = useState(record.records?.URL ?? '');
  const [a, setA] = useState((record.records?.A ?? []).join('\n'));
  const [txt, setTxt] = useState((record.records?.TXT ?? []).join('\n'));
  const [mx, setMx] = useState(mxToLines(record.records?.MX));
  const [status, setStatus] = useState(null);
  const [errors, setErrors] = useState([]);
  const [commit, setCommit] = useState(null);
  const [subRows, setSubRows] = useState(() => subdomainsToRows(record.subdomains));

  function setRow(i, patch) {
    setSubRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setStatus(null);
    setErrors([]);
  }

  function addRow() {
    setSubRows((rows) => [...rows, { label: '', type: 'TXT', value: '' }]);
    setStatus(null);
  }

  function removeRow(i) {
    setSubRows((rows) => rows.filter((_, j) => j !== i));
    setStatus(null);
  }

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
      }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      setCommit(body.commit ?? null);
      // A save that changed nothing is not a commit and does not touch DNS,
      // so it must not claim to have done either.
      setStatus(body.unchanged ? 'unchanged' : 'saved');
      return;
    }
    setErrors(body.details ?? [MESSAGES[body.error] ?? 'Could not save just now.']);
    setStatus('error');
  }

  const sha = shortSha(commit);

  return (
    <form
      onSubmit={save}
      className="border border-(--color-rule) bg-(--color-card) p-6 sm:p-8"
    >
      <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
        domains/{name}.json
      </p>
      <h2 className="mt-1 font-(family-name:--font-display) text-xl font-medium tracking-tight text-(--color-ink)">
        {name}.runs-on.dev
      </h2>

      <fieldset className="mt-6">
        <legend className="sr-only">Record type</legend>
        <div className="flex flex-wrap gap-2">
          {MODE_LABELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { setMode(m.id); setStatus(null); setErrors([]); }}
              aria-pressed={mode === m.id}
              className="border px-3 py-1.5 font-(family-name:--font-mono) text-xs transition-opacity hover:opacity-80"
              style={mode === m.id
                ? { borderColor: 'var(--color-signal)', background: 'var(--color-signal)', color: 'var(--color-paper)' }
                : { borderColor: 'var(--color-rule)' }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-(--color-muted)">
          {MODE_LABELS.find((m) => m.id === mode)?.hint}
        </p>
      </fieldset>

      <div className="mt-5 space-y-4">
        {mode === 'cname' && (
          <Input label="CNAME" value={cname} onChange={setCname} placeholder="cname.vercel-dns.com" />
        )}
        {mode === 'url' && (
          <Input label="URL" value={url} onChange={setUrl} placeholder="https://example.com" />
        )}
        {mode === 'advanced' && (
          <>
            <Area label="A" value={a} onChange={setA} placeholder={'76.76.21.21'} hint="One IPv4 address per line." />
            <Area label="TXT" value={txt} onChange={setTxt} placeholder={'did=did:plc:abc123'} hint="One string per line, up to 255 characters." />
            <Area label="MX" value={mx} onChange={setMx} placeholder={'10 mx.example.com'} hint="One 'priority hostname' per line, up to 5." />
          </>
        )}
        {mode === 'card' && (
          <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
            {'"records": {}'}
          </p>
        )}
      </div>

      <fieldset className="mt-8 border-t border-(--color-rule) pt-5">
        <legend className="sr-only">Subdomains</legend>
        <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
          subdomains
        </p>
        <p className="mt-1 text-xs leading-relaxed text-(--color-muted)">
          One label deep, for records a provider asks you to put somewhere other than the
          name itself, like <span className="font-(family-name:--font-mono)">_atproto</span>{' '}
          for a Bluesky handle or{' '}
          <span className="font-(family-name:--font-mono)">_vercel</span> for domain
          verification. These are separate names, so a record here does not conflict with a
          CNAME above.
        </p>

        {subRows.length > 0 && (
          <div className="mt-4 space-y-3">
            {subRows.map((row, i) => (
              <div key={i} className="border border-(--color-rule) p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={row.label}
                    onChange={(e) => setRow(i, { label: e.target.value })}
                    placeholder="_vercel"
                    aria-label="Subdomain label"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    className="w-32 border border-(--color-rule) bg-transparent px-2 py-1.5 font-(family-name:--font-mono) text-sm text-(--color-ink) outline-none focus:border-(--color-signal)"
                  />
                  <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
                    .{name}.runs-on.dev
                  </span>
                  <select
                    value={row.type}
                    onChange={(e) => setRow(i, { type: e.target.value })}
                    aria-label="Record type"
                    className="border border-(--color-rule) bg-transparent px-2 py-1.5 font-(family-name:--font-mono) text-sm text-(--color-ink) outline-none focus:border-(--color-signal)"
                  >
                    {SUBDOMAIN_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="ml-auto font-(family-name:--font-mono) text-xs text-(--color-muted) underline hover:text-(--color-ink)"
                  >
                    remove
                  </button>
                </div>
                <textarea
                  value={row.value}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                  placeholder={SUB_PLACEHOLDER[row.type]}
                  rows={2}
                  aria-label="Record value"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="mt-2 w-full resize-y border border-(--color-rule) bg-transparent px-3 py-2 font-(family-name:--font-mono) text-sm text-(--color-ink) outline-none focus:border-(--color-signal)"
                />
                <span className="mt-1 block text-xs text-(--color-muted)">
                  {SUB_HINT[row.type]}
                </span>
              </div>
            ))}
          </div>
        )}

        {subRows.length < MAX_SUBDOMAINS ? (
          <button
            type="button"
            onClick={addRow}
            className="mt-3 border border-(--color-rule) px-3 py-1.5 font-(family-name:--font-mono) text-xs transition-opacity hover:opacity-80"
          >
            + add a subdomain record
          </button>
        ) : (
          <p className="mt-3 font-(family-name:--font-mono) text-xs text-(--color-muted)">
            {`// ${MAX_SUBDOMAINS} is the limit`}
          </p>
        )}
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="border px-5 py-2.5 font-(family-name:--font-mono) text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal)', color: 'var(--color-paper)' }}
        >
          {status === 'saving' ? 'Saving\u2026' : 'Save record'}
        </button>

        {status === 'unchanged' && (
          <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
            {'// no changes to save'}
          </p>
        )}

        {status === 'saved' && (
          <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
            {'// '}
            {sha ? (
              <a className="text-(--color-signal) underline" href={commitUrl(commit)} target="_blank" rel="noopener noreferrer">
                commit {sha}
              </a>
            ) : 'saved'}
            {' — DNS updates within seconds'}
          </p>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 font-(family-name:--font-mono) text-xs text-(--color-signal)">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </form>
  );
}

const SUB_PLACEHOLDER = {
  TXT: 'vc-domain-verify=you.runs-on.dev,abc123',
  CNAME: 'target.example.com',
  A: '76.76.21.21',
  MX: '10 mx.example.com',
};

const SUB_HINT = {
  TXT: 'One string per line, up to 255 characters.',
  CNAME: 'A single hostname. Cannot share this label with another type.',
  A: 'One IPv4 address per line.',
  MX: "One 'priority hostname' per line, up to 5.",
};

const MESSAGES = {
  signin_required: 'Sign in again to save this record.',
  not_owner: 'Only the owner of this name may change its record.',
  not_found: 'That record no longer exists.',
  stale: 'This record changed somewhere else while you were editing. Reload and try again.',
  busy: 'The registry is busy. Try again in a few seconds.',
  rate_limited: 'That is a lot of saves in a short window. Give it a few minutes.',
  invalid_name: 'That name is not valid.',
  server_error: 'Could not save just now.',
};

function Input({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="mt-1 w-full border border-(--color-rule) bg-transparent px-3 py-2 font-(family-name:--font-mono) text-sm text-(--color-ink) outline-none focus:border-(--color-signal)"
      />
    </label>
  );
}

function Area({ label, value, onChange, placeholder, hint }) {
  return (
    <label className="block">
      <span className="font-(family-name:--font-mono) text-xs text-(--color-muted)">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="mt-1 w-full resize-y border border-(--color-rule) bg-transparent px-3 py-2 font-(family-name:--font-mono) text-sm text-(--color-ink) outline-none focus:border-(--color-signal)"
      />
      {hint && <span className="mt-1 block text-xs text-(--color-muted)">{hint}</span>}
    </label>
  );
}
