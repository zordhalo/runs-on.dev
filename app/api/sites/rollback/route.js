import { authorizeBearer, resolveSiteName } from '../../../../lib/site-access.js';
import { createRateLimiter } from '../../../../lib/throttle.js';
import { rollbackSite, toResponse } from '../../../../lib/site-actions.js';

// A pointer swap, not a re-upload — but it is still a registry write with a
// visitor-visible effect, so it gets a deploy-shaped allowance.
const ROLLBACK_WINDOW_MS = 10 * 60 * 1000;
const ROLLBACK_MAX = 6;
const takeRollback = createRateLimiter({ windowMs: ROLLBACK_WINDOW_MS, max: ROLLBACK_MAX });

// POST { deploymentId, name? } — re-points the live site at a deployment
// still in history (lib/site-actions.js).
export async function POST(request) {
  // Credential and budget before the body, for the same reason as the deploy
  // route: an unauthenticated caller gets neither parsing nor a registry read.
  const auth = await authorizeBearer(request, takeRollback);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const name = await resolveSiteName(auth, body.name);
  if (name.response) return name.response;

  return toResponse(await rollbackSite({ login: auth.login, name: name.name }, body.deploymentId));
}
