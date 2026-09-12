import { randomBytes } from 'node:crypto';
import { API, REPO, headers, getContentsMeta } from './registry.js';
import { validateName } from './name.js';

// Hosted-site bookkeeping in the registry repo, parallel to domains/. A site
// file never holds content — the bytes live in Blob under sites/<name>/<id>/
// — it holds the pointer: which deployment is live and which older ones are
// kept around for rollback.
//
// Deliberately a separate directory from domains/: sync-dns triggers on
// domains/** pushes only, so site deploys can never fire a DNS sync, and the
// DNS-bearing record stays the single authority on where a name resolves.

export const MAX_DEPLOYMENTS_KEPT = 5;

function pathFor(name) {
  // Same guard shape as lib/owners.js: routes validate the name first, and
  // this second check is what keeps a hostile string out of the API path even
  // if a future caller forgets.
  if (!validateName(name).ok) {
    throw new Error(`invalid site name: ${name}`);
  }
  return `sites/${name}.json`;
}

export async function getSite(name, opts = {}) {
  const meta = await getContentsMeta(pathFor(name), opts);
  if (!meta) return null;
  return { data: meta.data, sha: meta.sha };
}

export function newDeployment({ files, bytes, now = new Date() }) {
  return {
    id: randomBytes(4).toString('hex'),
    at: now.toISOString(),
    files,
    bytes,
  };
}

// Appends a deployment as the active one and prunes the history to the last
// MAX_DEPLOYMENTS_KEPT. Returns the record to commit plus the deployments
// that fell out of it, whose Blob prefixes the caller may then delete
// (best-effort: a failed delete must never fail the deploy).
export function applyDeployment(existing, { name, owner, deployment }) {
  const history = [...(existing?.deployments ?? []).filter((d) => d.id !== deployment.id), deployment];
  const kept = history.slice(-MAX_DEPLOYMENTS_KEPT);
  const pruned = history.slice(0, -MAX_DEPLOYMENTS_KEPT);

  const record = existing
    ? { ...existing, active: deployment.id, deployments: kept, updatedAt: deployment.at }
    : { name, owner, active: deployment.id, deployments: kept, updatedAt: deployment.at };

  return { record, pruned };
}

// Swaps the active pointer to a deployment already in the history. Rollback
// re-points rather than re-uploads, which is why pruned deployments are gone
// for good: there is nothing left on the storage side to point at.
export function rollbackTo(existing, deploymentId, { now = new Date() } = {}) {
  if (!existing) return null;
  const target = existing.deployments.find((d) => d.id === deploymentId);
  if (!target) return null;
  return { ...existing, active: target.id, updatedAt: now.toISOString() };
}

export async function putSite(record, { token, sha, editor, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}/repos/${REPO}/contents/${pathFor(record.name)}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `site: ${record.name} by @${editor}`,
      content: Buffer.from(`${JSON.stringify(record, null, 2)}\n`).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });

  if (res.status === 403 || res.status === 429) return { ok: false, reason: 'ratelimited' };
  // Same contract as putRecordUpdate: with a sha this is a stale write; without
  // one the path already exists, which the first deploy treats as a race lost
  // to another deploy of the same name, not a server error.
  if (res.status === 409 || res.status === 422) return { ok: false, reason: sha ? 'stale' : 'exists' };
  if (!res.ok) return { ok: false, reason: 'error' };

  const written = await res.json().catch(() => null);
  return { ok: true, commit: written?.commit?.sha ?? null };
}
