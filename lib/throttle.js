// A best-effort per-key write limiter, held in memory.
//
// Be clear about what this is and is not. Instances are not shared, so a
// determined caller spreading requests across cold starts gets a fresh
// allowance each time -- this is not an authorization boundary and must never
// be the only thing standing between a caller and something expensive.
// Fluid Compute reuses warm instances, so it does reliably stop the realistic
// case: one client looping against one instance, which is what a stuck retry
// or a leaned-on button actually looks like.
//
// The durable protections live elsewhere: ownership is checked on every write,
// the record is schema-validated before it is committed, and the sha makes a
// stale write fail rather than clobber. This only caps how fast a legitimate
// owner can spend shared quota.
const MAX_KEYS = 5000;

export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  return function take(key, now = Date.now()) {
    const cutoff = now - windowMs;

    // Sweep before inserting, not on a timer: a serverless instance may be
    // frozen between requests, so a timer is not a thing that reliably runs.
    if (hits.size > MAX_KEYS) {
      for (const [k, times] of hits) {
        const live = times.filter((t) => t > cutoff);
        if (live.length === 0) hits.delete(k);
        else hits.set(k, live);
      }
    }

    const times = (hits.get(key) ?? []).filter((t) => t > cutoff);

    if (times.length >= max) {
      // Oldest hit in the window is the one that has to age out.
      return { ok: false, retryAfterMs: Math.max(0, times[0] + windowMs - now) };
    }

    times.push(now);
    hits.set(key, times);
    return { ok: true, remaining: max - times.length };
  };
}
