import { validateRecord } from './schema.js';
import { REPO_SLUG } from './repo.js';

export const REPO = process.env.REGISTRY_REPO ?? REPO_SLUG;
export const API = 'https://api.github.com';

function pathFor(name) {
  return `domains/${name}.json`;
}

export function headers(token) {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Generic GitHub contents-API read, reused by getRecord and lib/owners.js so
// there's one place that knows how to decode the base64 response body. Also
// surfaces the file's `sha`, which an update PUT must echo back.
export async function getContentsMeta(path, { fetchImpl = fetch, token } = {}) {
  const res = await fetchImpl(`${API}/repos/${REPO}/contents/${path}`, {
    headers: headers(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`registry read failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return {
    data: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')),
    sha: body.sha,
  };
}

export async function getContents(path, opts = {}) {
  const meta = await getContentsMeta(path, opts);
  return meta ? meta.data : null;
}

export async function getRecord(name, opts = {}) {
  return getContents(pathFor(name), opts);
}

export async function putRecord(record, { token, fetchImpl = fetch } = {}) {
  if (!validateRecord(record).ok) return { ok: false, reason: 'error' };

  // Reuse the authenticated token for this existence check: anonymous GitHub
  // reads cap at 60/hour vs 5,000/hour authenticated, so during a launch
  // spike an anonymous check would falsely report every name as available.
  let existing;
  try {
    existing = await getRecord(record.name, { fetchImpl, token });
  } catch (err) {
    return {
      ok: false,
      reason: err.status === 403 || err.status === 429 ? 'ratelimited' : 'error',
    };
  }
  if (existing) return { ok: false, reason: 'exists' };

  const res = await fetchImpl(`${API}/repos/${REPO}/contents/${pathFor(record.name)}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `claim: ${record.name} by @${record.owner.github}`,
      content: Buffer.from(`${JSON.stringify(record, null, 2)}\n`).toString('base64'),
    }),
  });

  if (res.status === 403 || res.status === 429) return { ok: false, reason: 'ratelimited' };
  // No sha is sent on this create, so GitHub rejects a write over a path that
  // now exists (409 or 422) — the safety property that stops overwrites. If
  // another claim won the read-then-write race after our existence check
  // above, that's just a name taken a second ago, not a server error.
  if (res.status === 409 || res.status === 422) return { ok: false, reason: 'exists' };
  if (!res.ok) return { ok: false, reason: 'error' };

  // Surface the commit this write produced so the claimant can be shown their
  // own line in the log. Purely decorative: a body we can't read must never
  // turn a successful, already-committed claim into a failure.
  const created = await res.json().catch(() => null);
  return { ok: true, commit: created?.commit?.sha ?? null };
}

// The update counterpart to putRecord, and its exact inverse on the one
// detail that matters: putRecord deliberately omits `sha` so GitHub refuses
// a write over a path that already exists, which is what stops two people
// claiming the same name. An update must send the sha it read, so GitHub
// refuses a write over a file that has changed since — compare-and-swap on
// the same field, in the opposite direction. Without it a stale editor tab
// would silently clobber a record edited from somewhere else in between.
export async function putRecordUpdate(record, { token, sha, editor, fetchImpl = fetch } = {}) {
  if (!validateRecord(record).ok) return { ok: false, reason: 'error' };
  if (typeof sha !== 'string' || !sha) return { ok: false, reason: 'error' };

  const res = await fetchImpl(`${API}/repos/${REPO}/contents/${pathFor(record.name)}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `records: ${record.name} by @${editor ?? record.owner.github}`,
      content: Buffer.from(`${JSON.stringify(record, null, 2)}\n`).toString('base64'),
      sha,
    }),
  });

  if (res.status === 403 || res.status === 429) return { ok: false, reason: 'ratelimited' };
  // A sha mismatch. The record moved under this edit, so the safe answer is
  // to make the editor re-read and decide again rather than pick a winner.
  if (res.status === 409 || res.status === 422) return { ok: false, reason: 'stale' };
  if (!res.ok) return { ok: false, reason: 'error' };

  const written = await res.json().catch(() => null);
  return { ok: true, commit: written?.commit?.sha ?? null };
}
