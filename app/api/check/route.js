import { validateName } from '../../../lib/name.js';
import { isReserved } from '../../../lib/blocklist.js';
import { getRecord } from '../../../lib/registry.js';
import { createRateLimiter } from '../../../lib/throttle.js';

// A separate card-read token keeps availability checks off REGISTRY_TOKEN,
// the same quota /api/claim depends on. Every other read-only route
// (dns-check, sites/[name], claim-banner) already does this; /api/check was
// the lone hold-out, so a loop here could starve claiming for everyone.
const TOKEN = () => process.env.CARD_TOKEN ?? process.env.REGISTRY_TOKEN;

// Keyed on the requested name, like dns-check. The availability check is
// the form's debounce call, so a real visitor produces one request per typed
// name, not a burst; an anonymous loop over random names is the thing this
// has to cap. Anonymous by design (no session to key on), so the name is
// the natural unit — poll one name, see one answer.
const CHECK_WINDOW_MS = 60 * 1000;
const CHECK_MAX = 10;
const takeCheck = createRateLimiter({ windowMs: CHECK_WINDOW_MS, max: CHECK_MAX });

export async function GET(request) {
  const name = (new URL(request.url).searchParams.get('name') ?? '').trim().toLowerCase();

  const grammar = validateName(name);
  if (!grammar.ok) return Response.json({ available: false, code: `invalid_${grammar.reason}` });
  if (isReserved(name).reserved) return Response.json({ available: false, code: 'reserved' });

  // Rate limit before the read: a request that costs no GitHub quota still
  // costs a slot, and gating only the read would let a loop spend the
  // limiter without ever being refused (every name 404s, every answer is
  // 'available'). Same shape as the write routes.
  const budget = takeCheck(name);
  if (!budget.ok) {
    const seconds = Math.ceil(budget.retryAfterMs / 1000);
    return Response.json(
      { error: 'rate_limited', retryInMs: budget.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(seconds) } },
    );
  }

  let existing;
  try {
    existing = await getRecord(name, { token: TOKEN() });
  } catch (err) {
    // Log before collapsing the failure into a code. Without this the only
    // trace a broken registry read leaves is "check_failed" on the visitor's
    // screen -- the server logs stay silent and there is nothing to debug
    // from, which is how a bad REGISTRY_TOKEN can look like a UI bug.
    console.error(`check ${name} failed: status=${err.status ?? 'none'} ${err.message}`);
    const code = err.status === 403 || err.status === 429 ? 'busy' : 'check_failed';
    return Response.json({ available: false, code });
  }
  return Response.json({ available: existing === null, code: existing ? 'taken' : 'available' });
}
