'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { canAttemptClaim } from '../lib/claim.js';
import { REPO_URL, commitUrl, shortSha } from '../lib/repo.js';

const CHECK_DEBOUNCE_MS = 300;
const MAX_CLAIM_RETRIES = 5;
const RETRY_BASE_MS = 1000;
const RETRY_CEILING_MS = 8000;
const FIELD_WIDTH = 13;

export default function ClaimForm({ signedIn }) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState(null);
  const [commit, setCommit] = useState(null);
  const [ownedName, setOwnedName] = useState(null);
  const [inputWidth, setInputWidth] = useState(null);
  const [animKey, setAnimKey] = useState(0);
  const nameRef = useRef('');
  const debounceRef = useRef(null);
  const lastCheckedRef = useRef('');
  const lastResultRef = useRef({ value: '', status: null });
  const mirrorRef = useRef(null);
  const lastAnimatedRef = useRef('');

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function onChange(value) {
    nameRef.current = value;
    setName(value);
    clearTimeout(debounceRef.current);

    if (value.length < 2) {
      setStatus(null);
      return;
    }

    debounceRef.current = setTimeout(() => check(value), CHECK_DEBOUNCE_MS);
  }

  async function check(value) {
    if (value === lastCheckedRef.current) {
      // Already have a result for this exact name (e.g. typed, edited, then
      // retyped back) — reuse it instead of spending another API call.
      if (nameRef.current === value) setStatus(lastResultRef.current.status);
      return;
    }
    lastCheckedRef.current = value;

    const res = await fetch(`/api/check?name=${encodeURIComponent(value)}`);
    const body = res.ok ? await res.json().catch(() => null) : null;
    const result = body && body.available ? 'available' : (body && body.code) || 'check_failed';
    lastResultRef.current = { value, status: result };

    // The input may have changed (or been retyped) while this was in flight —
    // discard a response that no longer matches what's on screen.
    if (nameRef.current !== value) return;
    setStatus(result);
  }

  async function claim(attempt = 0) {
    setStatus('claiming');
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (res.status === 503) {
      if (attempt >= MAX_CLAIM_RETRIES) {
        setStatus('retry_exhausted');
        return;
      }
      // Exponential backoff with jitter, capped, so a rate-limit storm doesn't
      // turn every waiting claimant into another request against an
      // already-exhausted quota.
      const backoff = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CEILING_MS);
      const delay = backoff / 2 + Math.random() * (backoff / 2);
      setStatus('retrying');
      setTimeout(() => claim(attempt + 1), delay);
      return;
    }

    const body = await res.json();
    if (res.ok) setCommit(body.commit ?? null);
    // A limit_reached rejection carries the name this account already holds,
    // so the message below can point at it instead of dead-ending.
    if (Array.isArray(body.owned) && body.owned.length) setOwnedName(body.owned[0]);
    setStatus(res.ok ? 'claimed' : body.error);
  }

  const pending = status === 'claiming' || status === 'retrying';
  const available = status === 'available' || status === 'claimed';
  // Not the same question as `available`: this asks whether the claim is
  // worth attempting, which stays true when the check itself failed.
  const claimable = canAttemptClaim({ name, status });
  // A check that could not run is unknown, not a refusal -- painting the
  // record red while the copy says "try claiming it anyway" tells the
  // visitor two different things.
  const unknown = status === 'check_failed' || status === 'busy';
  const negative = Boolean(status) && !pending && !available && !unknown;
  const displayName = name || 'yourname';
  // Long names (the schema allows up to 32 chars) would otherwise blow the
  // claim line past the viewport at full size — scale it down past a normal
  // first-name length instead of letting it force page-level horizontal
  // scroll. Short names are unaffected (scale never exceeds 1).
  const heroScale = Math.min(1, 10 / displayName.length);

  // Mirror span holds the same text at the same font metrics so the input
  // (and its underline) can be sized to exactly what's on screen, instead of
  // an approximate ch-based guess — that approximation is what let the
  // bracket gap open up and the underline overhang past it.
  useLayoutEffect(() => {
    if (mirrorRef.current) setInputWidth(mirrorRef.current.offsetWidth);
  }, [displayName]);

  // Replay the record's stagger only when a genuinely different name (or a
  // real claimed transition) settles — not on every debounced re-check while
  // the visitor is still mid-keystroke on the same name.
  useEffect(() => {
    if (pending) return;
    const signature = status === 'claimed' ? `${displayName}:claimed` : displayName;
    if (lastAnimatedRef.current !== signature) {
      lastAnimatedRef.current = signature;
      setAnimKey((k) => k + 1);
    }
  }, [pending, status, displayName]);

  return (
    <div>
      <label htmlFor="claim-name" className="sr-only">
        Subdomain name
      </label>
      <div
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0 font-(family-name:--font-display) leading-none font-medium tracking-tight text-(--color-ink)"
        style={{ fontSize: `calc(clamp(2.25rem, 7vw, 4.5rem) * ${heroScale})` }}
      >
        <span className="relative inline-flex flex-nowrap items-baseline">
          <span aria-hidden="true" className="text-(--color-muted)">[</span>
          <input
            id="claim-name"
            value={name}
            onChange={(e) => onChange(e.target.value.trim().toLowerCase())}
            placeholder="yourname"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            size={1}
            style={{ width: inputWidth ? `${inputWidth}px` : undefined }}
            className="border-b-2 border-(--color-signal) bg-transparent text-[0.94em] outline-none placeholder:text-(--color-muted)/60 focus-visible:border-b-4"
          />
          {/* Measures the input's width. Its font MUST match the input exactly,
              including text-[0.94em], or the brackets stop hugging the text. */}
          <span
            ref={mirrorRef}
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 -z-10 text-[0.94em] whitespace-pre opacity-0"
          >
            {displayName}
          </span>
          <span aria-hidden="true" className="text-(--color-muted)">]</span>
        </span>
        <span className="text-(--color-muted)">.runs-on.dev</span>
      </div>

      <div
        key={animKey}
        className="record-block mt-4 max-w-full overflow-x-auto border-l-2 py-3 pr-4 pl-4 font-(family-name:--font-mono) text-[11px] whitespace-pre sm:max-w-md sm:text-[13px]"
        style={{ borderColor: negative ? 'var(--color-flag)' : 'var(--color-signal)' }}
      >
        <p className="record-field text-(--color-muted)">domains/{displayName}.json</p>
        <p className="record-field mt-2">{'{'}</p>
        <Field
          name={'"name":'}
          value={`"${displayName}",`}
          valueClass={negative ? 'text-(--color-muted)' : 'text-(--color-ink)'}
        />
        <Field
          name={'"owner":'}
          value={`{ "github": "${signedIn ? 'you' : 'you, once you sign in'}" },`}
        />
        <Field
          name={'"claimedAt":'}
          value={`"${status === 'claimed' ? 'just now' : 'the moment you claim it'}",`}
        />
        <Field name={'"records":'} value="{}" />
        <p className="record-field">{'}'}</p>
        {status && (
          <p className="record-field mt-2 text-(--color-muted)">// {message(status, displayName, ownedName)}</p>
        )}
      </div>

      <div className="mt-5">
        {status === 'claimed' ? (
          <Claimed name={displayName} commit={commit} />
        ) : status === 'limit_reached' ? (
          // Being told "you already have a name" is only useful if it comes
          // with a way to reach that name. This is where a returning owner
          // ends up, so it has to lead somewhere.
          <a
            href="/manage"
            className="inline-block border px-5 py-2.5 font-(family-name:--font-mono) text-sm transition-opacity hover:opacity-90"
            style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal)', color: 'var(--color-paper)' }}
          >
            {ownedName ? `Point ${ownedName}.runs-on.dev somewhere →` : 'Point your name somewhere →'}
          </a>
        ) : signedIn ? (
          <button
            onClick={() => claim()}
            disabled={!claimable}
            aria-disabled={!claimable}
            className="border px-5 py-2.5 font-(family-name:--font-mono) text-sm transition-colors disabled:cursor-not-allowed"
            style={
              claimable
                ? { borderColor: 'var(--color-signal)', background: 'var(--color-signal)', color: 'var(--color-paper)' }
                : { borderColor: 'var(--color-ink)', background: 'var(--color-ink)', color: 'var(--color-paper)', opacity: 0.3 }
            }
          >
            Claim it
          </button>
        ) : (
          <a
            href="/api/auth/github"
            className="inline-block border border-(--color-ink) bg-(--color-ink) px-5 py-2.5 font-(family-name:--font-mono) text-sm text-(--color-paper)"
          >
            Sign in with GitHub to claim
          </a>
        )}
      </div>
    </div>
  );
}

// Shown in place of the (now disabled) claim button once a name lands. Leads
// with the visitor's own artifact -- their claim is a real commit, authored
// under their name, in a log anyone can read -- and only then asks for the
// star. The commit sha is best-effort: if the write succeeded but the response
// body could not be read, fall back to the record file, which always exists.
function Claimed({ name, commit }) {
  const sha = shortSha(commit);
  const receipt = commitUrl(commit) ?? `${REPO_URL}/blob/main/domains/${name}.json`;

  return (
    <div>
      <p className="font-(family-name:--font-mono) text-[13px] text-(--color-muted)">
        {'// '}
        <a className="text-(--color-signal) underline" href={receipt} target="_blank" rel="noopener noreferrer">
          {sha ? `commit ${sha}` : `domains/${name}.json`}
        </a>
        {sha ? ' — your name is in the log now' : ' — your record is in the registry now'}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block border px-5 py-2.5 font-(family-name:--font-mono) text-sm transition-opacity hover:opacity-90"
          style={{
            borderColor: 'var(--color-signal)',
            background: 'var(--color-signal)',
            color: 'var(--color-paper)',
          }}
        >
          ★ Star the registry
        </a>
        <a
          className="font-(family-name:--font-mono) text-sm text-(--color-signal) underline"
          href="/manage"
        >
          point it somewhere →
        </a>
        <a
          className="font-(family-name:--font-mono) text-sm text-(--color-signal) underline"
          href={`/sites/${name}`}
        >
          your page →
        </a>
      </div>
    </div>
  );
}

function Field({ name, value, valueClass = 'text-(--color-ink)' }) {
  const label = name.padEnd(FIELD_WIDTH, ' ');
  return (
    <p className="record-field pl-4 text-(--color-muted)">
      {label}
      <span className={valueClass}>{value}</span>
    </p>
  );
}

function message(status, name, ownedName) {
  const map = {
    available: `${name}.runs-on.dev is available.`,
    taken: 'Already claimed.',
    reserved: 'That name is reserved.',
    invalid_length: 'Names are 2 to 32 characters.',
    invalid_charset: 'Lowercase letters, numbers and hyphens only.',
    invalid_hyphen: 'Names cannot start or end with a hyphen.',
    invalid_punycode: 'That pattern is not allowed.',
    invalid_name: 'That name is not valid.',
    server_error: 'Something broke on our side. Try again.',
    claiming: 'Claiming…',
    retrying: 'Busy right now — holding your claim and retrying.',
    retry_exhausted: 'Still overloaded. Try again in a few minutes.',
    busy: 'Too busy to check right now — claiming it still works.',
    check_failed: 'Could not check that name — try claiming it anyway.',
    claimed: `Done. ${name}.runs-on.dev is yours.`,
    signin_required: 'Sign in with GitHub first.',
    ineligible_age: 'Your GitHub account must be at least 30 days old.',
    ineligible_repos: 'Your GitHub account needs at least one public repository.',
    limit_reached: ownedName
      ? `You already own ${ownedName}.runs-on.dev. One per account for now.`
      : 'You already have a name. One per account for now.',
  };
  return map[status] ?? 'Something went wrong.';
}
