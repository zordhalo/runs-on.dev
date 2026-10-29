import { sessionFromRequest } from '../../../lib/session.js';
import { createRateLimiter, rateLimitHeaders } from '../../../lib/throttle.js';
import { editRecord } from '../../../lib/record-edit.js';
import { validateName } from '../../../lib/name.js';

// Generous enough that editing a record, looking at it, and editing again
// never trips it; tight enough that a leaned-on button cannot spend the
// registry's shared GitHub quota or fire a DNS sync per commit indefinitely.
const WRITE_WINDOW_MS = 10 * 60 * 1000;
const WRITE_MAX = 12;
const takeWrite = createRateLimiter({ windowMs: WRITE_WINDOW_MS, max: WRITE_MAX });

// The second write path onto domains/<name>.json, alongside /api/claim and a
// merged pull request. It commits straight to main for the same reason
// claiming does: the record file is the registry, and making an owner fork a
// repo to point their own name is the friction that leaves most claimed names
// pointing nowhere. The commit is still a public diff in the log, and the
// rules it must satisfy are the same ones CI applies to a pull request and
// the MCP server applies to an agent, because all three call validateEdit
// (the edit itself lives in lib/record-edit.js).
export async function POST(request) {
  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  if (!session?.login) {
    return Response.json({ error: 'signin_required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  if (!validateName(name).ok) {
    return Response.json({ error: 'invalid_name' }, { status: 400 });
  }

  // Ahead of the registry read, not just the write: both spend REGISTRY_TOKEN
  // quota, which is the same pool /api/claim draws on. Rationing only the
  // write would still let a loop starve claiming through reads alone.
  const budget = takeWrite(session.login.toLowerCase());
  if (!budget.ok) {
    const seconds = Math.ceil(budget.retryAfterMs / 1000);
    return Response.json(
      { error: 'rate_limited', retryInMs: budget.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(seconds), ...rateLimitHeaders(budget) } },
    );
  }

  const out = await editRecord(session.login, { ...body, name });
  return Response.json(out.body, {
    status: out.status,
    headers: out.status === 503 ? { 'Retry-After': '4' } : undefined,
  });
}
