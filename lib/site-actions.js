import { getSite, putSite, applyDeployment, newDeployment, rollbackTo } from './sites.js';
import { putDeployment, deletePrefixes } from './store.js';

const TOKEN = () => process.env.REGISTRY_TOKEN;

// The bodies of the three site routes, after the front door (lib/site-access)
// has settled `login` and `name`. Shared by the HTTP routes and the MCP
// server so an agent deploying through either one gets the same write order
// and the same errors. Each returns { status, body }.

const BUSY = { status: 503, body: { error: 'busy' } };

// Upload the files first, then move the pointer. If the pointer write fails
// or loses a race, the freshly uploaded prefix is reclaimed right there — a
// crash between the two is the only path that can still orphan storage, and
// only a future cleanup workflow can see that, because to every reader the
// orphan has never been referenced.
//
// `entries` is [{ name, data: Buffer }], already checked by the caller
// (lib/zip.js or the MCP file list) for safe paths and an index.html.
export async function publishSite({ login, name }, entries) {
  let existing;
  try {
    existing = await getSite(name, { token: TOKEN() });
  } catch {
    return BUSY;
  }

  const bytes = entries.reduce((sum, e) => sum + e.data.length, 0);
  const deployment = newDeployment({ files: entries.length, bytes });
  const prefix = `sites/${name}/${deployment.id}/`;
  const stored = await putDeployment(prefix, entries);
  if (!stored.ok) {
    return { status: 503, body: { error: 'storage_error' } };
  }

  const { record, pruned } = applyDeployment(existing?.data, { name, owner: login, deployment });
  const result = await putSite(record, { token: TOKEN(), sha: existing?.sha, editor: login });
  if (!result.ok) {
    // This deployment never entered history, so no future prune can see the
    // prefix. Reclaim it now, best-effort — a failed delete is leftover
    // storage, and it must never mask the failure that caused it.
    await deletePrefixes([prefix]);
    if (result.reason === 'stale' || result.reason === 'exists') {
      // Another deploy of this name landed mid-flight (a lost race on the
      // first deploy reports `exists`); the caller re-reads and decides,
      // exactly as a stale record edit does.
      return { status: 409, body: { error: 'stale' } };
    }
    if (result.reason === 'ratelimited') return BUSY;
    return { status: 500, body: { error: 'server_error' } };
  }

  // Sweep what fell out of history. Best-effort by design: the pointer has
  // moved, and leftover bytes are a storage cost, not a correctness problem.
  if (pruned.length > 0) {
    await deletePrefixes(pruned.map((d) => `sites/${name}/${d.id}/`));
  }

  return {
    status: 200,
    body: {
      url: `https://${name}.runs-on.dev/`,
      deploymentId: deployment.id,
      files: deployment.files,
      bytes: deployment.bytes,
      commit: result.commit ?? null,
    },
  };
}

export async function listDeployments({ name }) {
  let site;
  try {
    site = await getSite(name, { token: TOKEN() });
  } catch {
    return BUSY;
  }
  if (!site) {
    return { status: 200, body: { name, active: null, deployments: [] } };
  }
  return {
    status: 200,
    body: {
      name: site.data.name,
      active: site.data.active,
      deployments: site.data.deployments,
      updatedAt: site.data.updatedAt,
    },
  };
}

// Re-points the live site at a deployment still in history. There is nothing
// to roll back to once history has pruned it: the bytes are gone, and saying
// so beats serving a stranger's 404.
export async function rollbackSite({ login, name }, deploymentId) {
  if (typeof deploymentId !== 'string' || !/^[0-9a-f]{8}$/.test(deploymentId.trim())) {
    return { status: 400, body: { error: 'invalid_deployment_id' } };
  }

  let site;
  try {
    site = await getSite(name, { token: TOKEN() });
  } catch {
    return BUSY;
  }
  if (!site) {
    return { status: 404, body: { error: 'no_site' } };
  }

  const record = rollbackTo(site.data, deploymentId.trim());
  if (!record) {
    return { status: 404, body: { error: 'unknown_deployment' } };
  }

  const result = await putSite(record, { token: TOKEN(), sha: site.sha, editor: login });
  if (!result.ok) {
    if (result.reason === 'stale') return { status: 409, body: { error: 'stale' } };
    if (result.reason === 'ratelimited') return BUSY;
    return { status: 500, body: { error: 'server_error' } };
  }

  return { status: 200, body: { name, active: record.active, updatedAt: record.updatedAt } };
}

// The routes' envelope for these results: a 503 always carries Retry-After.
export function toResponse(out) {
  return Response.json(out.body, {
    status: out.status,
    headers: out.status === 503 ? { 'Retry-After': '4' } : undefined,
  });
}
