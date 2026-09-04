import { REPO_URL } from '../lib/repo.js';

// One name per account, so a signed-in owner has nothing to claim. Showing
// them the claim form anyway offers an action that can only be refused, and
// the refusal is where a returning owner used to dead-end. This replaces the
// form with the thing they actually came back for: their own record, and a
// way into it.
export default function OwnedName({ name, record }) {
  const records = record?.records ?? {};
  const types = Object.keys(records);
  const pointing = types.length > 0;

  return (
    <div>
      <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
        domains/{name}.json
      </p>

      <h2 className="mt-2 font-(family-name:--font-display) text-2xl font-medium tracking-tight text-(--color-ink) sm:text-3xl">
        {name}.runs-on.dev is yours
      </h2>

      {pointing ? (
        <dl className="mt-4 space-y-1 font-(family-name:--font-mono) text-xs sm:text-[13px]">
          {types.map((type) => (
            <div key={type} className="flex gap-2">
              <dt className="w-16 shrink-0 text-(--color-muted)">{type}</dt>
              <dd className="break-all text-(--color-ink)">{describe(records[type])}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-(--color-muted)">
          It isn&apos;t pointing anywhere yet, so it serves a profile card built from your
          GitHub account. Point it at your own site, a redirect, or an email
          forwarder whenever you like.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <a
          href="/manage"
          className="inline-block border px-5 py-2.5 font-(family-name:--font-mono) text-sm transition-opacity hover:opacity-90"
          style={{
            borderColor: 'var(--color-signal)',
            background: 'var(--color-signal)',
            color: 'var(--color-paper)',
          }}
        >
          {pointing ? 'Edit your record →' : 'Point it somewhere →'}
        </a>
        <a
          className="font-(family-name:--font-mono) text-sm text-(--color-signal) underline"
          href={`https://${name}.runs-on.dev`}
          target="_blank"
          rel="noopener noreferrer"
        >
          your page →
        </a>
        <a
          className="font-(family-name:--font-mono) text-sm text-(--color-signal) underline"
          href={`${REPO_URL}/blob/main/domains/${name}.json`}
          target="_blank"
          rel="noopener noreferrer"
        >
          the record →
        </a>
        <a
          className="font-(family-name:--font-mono) text-sm text-(--color-signal) underline"
          href={`/banner/${name}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          your banner →
        </a>
        <a
          className="font-(family-name:--font-mono) text-sm text-(--color-signal) underline"
          href={`/banner/${name}?theme=dark`}
          target="_blank"
          rel="noopener noreferrer"
        >
          dark, for GitHub →
        </a>
      </div>
    </div>
  );
}

// Records hold a string, a list of strings, or MX objects, so each renders as
// the one line a person would read it as rather than as raw JSON.
function describe(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => (v && typeof v === 'object' ? `${v.priority} ${v.value}` : v))
      .join(', ');
  }
  return String(value);
}
