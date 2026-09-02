import { sessionFromRequest } from '../../../lib/session.js';
import { evaluateClaim } from '../../../lib/claim.js';
import { putRecord } from '../../../lib/registry.js';
import { getOwnerIndex, putOwnerIndex } from '../../../lib/owners.js';

const TOKEN = () => process.env.REGISTRY_TOKEN;

const BUSY_RESPONSE = () =>
  Response.json({ error: 'busy', retryInMs: 4000 }, { status: 503, headers: { 'Retry-After': '4' } });

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';

  const session = sessionFromRequest(request, process.env.SESSION_SECRET);

  let ownerIndex = null;
  if (session?.login) {
    try {
      ownerIndex = await getOwnerIndex(session.login, { token: TOKEN() });
    } catch {
      // Fail closed: a rate-limited or errored owner-index read must not
      // let the claim through uncounted, because load is exactly when a
      // land grab happens. Answer with the same busy response putRecord
      // uses for its own GitHub failures.
      return BUSY_RESPONSE();
    }
  }

  // No pre-flight existence check: putRecord's atomic create already answers
  // "taken" via its `exists` reason, at the same status/code, for one less
  // GitHub request. It also degrades safely under rate limiting, unlike a
  // pre-flight getRecord call which throws on 403/429.
  const decision = evaluateClaim({
    name,
    session,
    existing: null,
    ownedCount: ownerIndex?.names?.length ?? 0,
  });
  if (!decision.ok) {
    // Hand back the names this account already holds. Only limit_reached
    // needs them, but they cost nothing to include and they are the caller's
    // own records, not anyone else's. Without them the form can only say "you
    // already have a name" without saying which -- a dead end at exactly the
    // moment a returning owner is trying to reach their record.
    const owned = ownerIndex?.names?.length ? ownerIndex.names : undefined;
    return Response.json({ error: decision.code, owned }, { status: decision.status });
  }

  const result = await putRecord(decision.record, { token: TOKEN() });

  if (result.ok) {
    // Second, non-atomic commit: two claims racing from the same account
    // inside this window can both pass evaluateClaim's limit check and end
    // up with two names each recorded here. The record write above stays
    // safe regardless (the contents API rejects a create over an existing
    // path), so the worst case is an account owning one more name than the
    // limit allows, not a corrupted or lost record. Not worth the extra
    // machinery of an atomic two-file commit via the Git Data API for that.
    try {
      const names = [...(ownerIndex?.names ?? []), name];
      const indexResult = await putOwnerIndex(session.login, names, {
        token: TOKEN(),
        sha: ownerIndex?.sha,
      });
      if (!indexResult.ok) {
        console.warn(`owner index write failed for ${session.login}: ${indexResult.reason}`);
      }
    } catch (err) {
      // The claim already succeeded — the user's name is genuinely theirs.
      // Never fail the request over an index bookkeeping problem.
      console.warn(`owner index write threw for ${session.login}: ${err.message}`);
    }
    return Response.json({ claimed: name, commit: result.commit ?? null });
  }

  if (result.reason === 'exists') {
    return Response.json({ error: 'taken' }, { status: 409 });
  }

  if (result.reason === 'ratelimited') {
    return BUSY_RESPONSE();
  }

  return Response.json({ error: 'server_error' }, { status: 500 });
}
