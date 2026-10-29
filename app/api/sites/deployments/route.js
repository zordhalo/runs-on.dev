import { authorizeSiteAction } from '../../../../lib/site-access.js';
import { createRateLimiter } from '../../../../lib/throttle.js';
import { listDeployments, toResponse } from '../../../../lib/site-actions.js';

// Reads cost the registry two GitHub requests (owner index, site file), so
// they are capped too — looser than deploys, since listing is what an agent
// does to orient itself before deciding anything.
const READ_WINDOW_MS = 10 * 60 * 1000;
const READ_MAX = 30;
const takeRead = createRateLimiter({ windowMs: READ_WINDOW_MS, max: READ_MAX });

export async function GET(request) {
  const url = new URL(request.url);
  const auth = await authorizeSiteAction(request, {
    explicitName: url.searchParams.get('name'),
    takeBudget: takeRead,
  });
  if (auth.response) return auth.response;

  return toResponse(await listDeployments(auth));
}
