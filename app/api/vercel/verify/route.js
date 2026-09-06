import { sessionFromRequest } from '../../../../lib/session.js';
import { validateName } from '../../../../lib/name.js';
import { getRecord } from '../../../../lib/registry.js';
import { createRateLimiter } from '../../../../lib/throttle.js';

// Calls Vercel's domain verification API on behalf of the signed-in owner,
// using a token they provided for this session. The token is NOT stored
// persistently — it lives in the .env.local (POC) or the session cookie
// (production), and this route is the only thing that touches it.
//
// This exists because Vercel frequently never re-checks a pending domain
// even when the DNS and TXT records are correct. The only reliable fix is
// calling this endpoint, which was previously impossible for a registry
// user to do without generating their own API token and running curl.

const VERCEL_API = 'https://api.vercel.com';

// Same budget as dns-check: generous for a real owner polling after a
// save, tight enough that a loop can't spend Vercel's API quota.
const VERIFY_WINDOW_MS = 60 * 1000;
const VERIFY_MAX = 10;
const takeVerify = createRateLimiter({ windowMs: VERIFY_WINDOW_MS, max: VERIFY_MAX });

export async function POST(request) {
  // The caller must own the name they're trying to verify.
  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  if (!session?.login) {
    return Response.json({ error: 'signin_required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  const project = typeof body.project === 'string' ? body.project.trim() : '';
  if (!validateName(name).ok) {
    return Response.json({ error: 'invalid_name' }, { status: 400 });
  }
  if (!project) {
    return Response.json({ error: 'project_required' }, { status: 400 });
  }

  const budget = takeVerify(session.login.toLowerCase());
  if (!budget.ok) {
    const seconds = Math.ceil(budget.retryAfterMs / 1000);
    return Response.json(
      { error: 'rate_limited', retryInMs: budget.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(seconds) } },
    );
  }

  // Verify the caller owns this name.
  const token = process.env.REGISTRY_TOKEN;
  const fetchImpl = (url, init) => fetch(url, { ...init, next: { revalidate: 30 } });
  const record = await getRecord(name, { token, fetchImpl }).catch(() => null);
  if (!record) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (record.owner.github.toLowerCase() !== session.login.toLowerCase()) {
    return Response.json({ error: 'not_owner' }, { status: 403 });
  }

  // POC: token comes from env. In production, it comes from the session
  // after the user connects their Vercel account.
  const vercelToken = session.vercelToken ?? process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    return Response.json({ error: 'vercel_not_connected' }, { status: 400 });
  }

  // Call Vercel's verify endpoint.
  const res = await fetch(
    `${VERCEL_API}/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(`${name}.runs-on.dev`)}/verify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
    },
  ).catch(() => null);

  if (!res) {
    return Response.json({ error: 'vercel_unreachable' }, { status: 502 });
  }

  const result = await res.json().catch(() => ({}));

  if (res.status === 401 || res.status === 403) {
    return Response.json({ error: 'vercel_token_invalid' }, { status: 401 });
  }

  // After successful verification, remove the _vercel TXT from the claim.
  // The zone mirror only mirrors values present in claim files, so removing
  // it here stops the sync from re-publishing the TXT on every run. The
  // zone TXT gets cleaned up on the next sync as "no longer wanted". This
  // keeps the zone bounded instead of accumulating every claim's token
  // forever (issues #104, #105: Vercel caps records per hostname at ~50).
  if (result.verified) {
    try {
      const uncachedFetch = (url, init) => fetch(url, init, { cache: 'no-store' });
      const meta = await getContentsMeta(`domains/${name}.json`, {
        token: registryToken,
        fetchImpl: uncachedFetch,
      }).catch(() => null);

      if (meta?.data?.subdomains?._vercel) {
        const head = { ...meta.data };
        const subs = { ...head.subdomains };
        delete subs._vercel;
        if (Object.keys(subs).length > 0) {
          head.subdomains = subs;
        } else {
          delete head.subdomains;
        }

        const { putRecordUpdate } = await import('../../../../lib/registry.js');
        await putRecordUpdate(head, {
          token: registryToken,
          sha: meta.sha,
          editor: session.login,
          fetchImpl: uncachedFetch,
        }).catch(() => null);
      }
    } catch {
      // Cleanup is best-effort: verification already succeeded, and the
      // zone TXT TTL in lib/dns.js catches any missed cleanup on the
      // next sync. Don't fail the response over a non-essential step.
    }
  }

  return Response.json({
    verified: result.verified ?? false,
    name,
    project,
    response: result,
  });
}
