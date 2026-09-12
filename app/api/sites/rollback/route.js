import { authorizeBearer, resolveSiteName } from '../../../../lib/site-access.js';
import { createRateLimiter } from '../../../../lib/throttle.js';
import { getSite, putSite, rollbackTo } from '../../../../lib/sites.js';

const TOKEN = () => process.env.REGISTRY_TOKEN;

// A pointer swap, not a re-upload — but it is still a registry write with a
// visitor-visible effect, so it gets a deploy-shaped allowance.
const ROLLBACK_WINDOW_MS = 10 * 60 * 1000;
const ROLLBACK_MAX = 6;
const takeRollback = createRateLimiter({ windowMs: ROLLBACK_WINDOW_MS, max: ROLLBACK_MAX });

// POST { deploymentId, name? } — re-points the live site at a deployment
// still in history. There is nothing to roll back to once history has pruned
// it: the bytes are gone, and saying so beats serving a stranger's 404.
export async function POST(request) {
  // Credential and budget before the body, for the same reason as the deploy
  // route: an unauthenticated caller gets neither parsing nor a registry read.
  const auth = authorizeBearer(request, takeRollback);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const deploymentId = typeof body.deploymentId === 'string' ? body.deploymentId.trim() : '';
  if (!/^[0-9a-f]{8}$/.test(deploymentId)) {
    return Response.json({ error: 'invalid_deployment_id' }, { status: 400 });
  }

  const name = await resolveSiteName(auth, body.name);
  if (name.response) return name.response;

  let site;
  try {
    site = await getSite(name.name, { token: TOKEN() });
  } catch {
    return Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '4' } });
  }
  if (!site) {
    return Response.json({ error: 'no_site' }, { status: 404 });
  }

  const record = rollbackTo(site.data, deploymentId);
  if (!record) {
    return Response.json({ error: 'unknown_deployment' }, { status: 404 });
  }

  const result = await putSite(record, {
    token: TOKEN(),
    sha: site.sha,
    editor: auth.login,
  });
  if (!result.ok) {
    if (result.reason === 'stale') {
      return Response.json({ error: 'stale' }, { status: 409 });
    }
    if (result.reason === 'ratelimited') {
      return Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '4' } });
    }
    return Response.json({ error: 'server_error' }, { status: 500 });
  }

  return Response.json({ name: name.name, active: record.active, updatedAt: record.updatedAt });
}
