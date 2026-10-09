import { siteTokenFromRequest, SITE_TOKEN_SCOPE } from './tokens.js';
import { isTokenRevoked } from './token-registry.js';
import { getOwnerIndex } from './owners.js';
import { validateName } from './name.js';

const TOKEN = () => process.env.REGISTRY_TOKEN;

// The credential half of the front door: verify the bearer token and spend
// the route's throttle budget. Split out from the name resolution so routes
// whose parameters arrive in a request body (deploy's zip, rollback's JSON)
// can authenticate BEFORE parsing anything — an unauthenticated caller must
// not be able to spend server memory on a body, only its own rate budget.
//
// Now async, because a signature alone no longer settles it: the token
// registry is consulted so a deleted token stops working immediately, not at
// its natural expiry. Both callers await it.
//
// Returns { login } to proceed with, or { response } to return as-is.
export async function authorizeBearer(request, takeBudget) {
  const raw = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(rod1\.\S+)$/i)?.[1];
  const payload = siteTokenFromRequest(request, process.env.SITE_TOKEN_SECRET);
  if (!payload?.login || payload.scope !== SITE_TOKEN_SCOPE) {
    return { response: Response.json({ error: 'invalid_token' }, { status: 401 }) };
  }

  // The registry has the final word: an entry the owner deleted (or that
  // aged out) rejects here. isTokenRevoked fails open on registry trouble --
  // a GitHub hiccup must not take the deploy path down -- but a registry
  // that answers "not listed" is a revocation and wins.
  if (await isTokenRevoked(payload.login, raw, { token: TOKEN() })) {
    return { response: Response.json({ error: 'revoked_token' }, { status: 401 }) };
  }

  const budget = takeBudget(payload.login.toLowerCase());
  if (!budget.ok) {
    const seconds = Math.ceil(budget.retryAfterMs / 1000);
    return {
      response: Response.json(
        { error: 'rate_limited', retryInMs: budget.retryAfterMs },
        { status: 429, headers: { 'Retry-After': String(seconds) } },
      ),
    };
  }

  return { login: payload.login };
}

// The name half: read the owner index and settle on the one name the action
// targets. Split for the same reason as authorizeBearer — this spends a
// registry read, so it runs after the body has proven itself worth one.
//
// Returns { name } to proceed with, or { response } to return as-is.
export async function resolveSiteName({ login }, explicitName) {
  // Fail closed, like /api/records: an index that could not be read must not
  // read as "this account owns nothing" (which would be a 403 for a person
  // who owns a name) nor as permission to act.
  let index;
  try {
    index = await getOwnerIndex(login, { token: TOKEN() });
  } catch {
    return { response: Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '4' } }) };
  }
  if (!index || !Array.isArray(index.names) || index.names.length === 0) {
    return { response: Response.json({ error: 'no_claimed_name' }, { status: 403 }) };
  }

  // v1 accounts hold exactly one name, so it can be implied. The explicit
  // form exists so the day MAX_NAMES_PER_ACCOUNT changes, callers that send a
  // name keep working and the ambiguity is surfaced rather than guessed away.
  let name;
  if (explicitName !== null && explicitName !== undefined && explicitName !== '') {
    name = String(explicitName).trim().toLowerCase();
    if (!validateName(name).ok || !index.names.includes(name)) {
      return { response: Response.json({ error: 'not_your_name' }, { status: 403 }) };
    }
  } else if (index.names.length === 1) {
    name = index.names[0];
  } else {
    return { response: Response.json({ error: 'name_required' }, { status: 400 }) };
  }

  return { name };
}

// The whole front door in one call, for routes whose parameters ride in the
// query string and parse for free (the deployments list). Body-carrying
// routes use the two halves in order: authorizeBearer, parse, resolveSiteName.
export async function authorizeSiteAction(request, { explicitName, takeBudget }) {
  const auth = await authorizeBearer(request, takeBudget);
  if (auth.response) return auth;
  return resolveSiteName(auth, explicitName);
}
