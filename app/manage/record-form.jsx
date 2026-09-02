'use client';

import { useState } from 'react';
import { commitUrl, shortSha } from '../../lib/repo.js';
import { modeOf, mxToLines, buildRecords } from '../../lib/record-fields.js';

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

  async function save(event) {
    event.preventDefault();
    setStatus('saving');
    setErrors([]);

    const res = await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, records: buildRecords(mode, { cname, url, a, txt, mx }) }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      setCommit(body.commit ?? null);
      setStatus('saved');
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

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="border px-5 py-2.5 font-(family-name:--font-mono) text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal)', color: 'var(--color-paper)' }}
        >
          {status === 'saving' ? 'Saving…' : 'Save record'}
        </button>

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

const MESSAGES = {
  signin_required: 'Sign in again to save this record.',
  not_owner: 'Only the owner of this name may change its record.',
  not_found: 'That record no longer exists.',
  stale: 'This record changed somewhere else while you were editing. Reload and try again.',
  busy: 'The registry is busy. Try again in a few seconds.',
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
