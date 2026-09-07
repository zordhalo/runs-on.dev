import { sessionFromRequest } from '../../../lib/session.js';
import { validateName } from '../../../lib/name.js';
import { getContentsMeta } from '../../../lib/registry.js';
import { createRateLimiter } from '../../../lib/throttle.js';

// Releases a claimed name: deletes domains/<name>.json from the repo,
// making the name available for anyone to claim again. The sync-dns
// workflow cleans up DNS automatically when the file disappears.

const RELEASE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RELEASE_MAX = 2;
const takeRelease = createRateLimiter({ windowMs: RELEASE_WINDOW_MS, max: RELEASE_MAX });

export async function POST(request) {
  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  if (!session?.login) {
    return Response.json({ error: 'signin_required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  const confirm = typeof body.confirm === 'string' ? body.confirm.trim().toLowerCase() : '';
  if (!validateName(name).ok) {
    return Response.json({ error: 'invalid_name' }, { status: 400 });
  }

  // The caller must type the exact name to confirm. This prevents accidental
  // releases from a mis-click, the same double-step pattern GitHub uses
  // for repository deletion.
  if (confirm !== name) {
    return Response.json({ error: 'confirm_mismatch', detail: 'type the name exactly to confirm' }, { status: 400 });
  }

  const budget = takeRelease(session.login.toLowerCase());
  if (!budget.ok) {
    const seconds = Math.ceil(budget.retryAfterMs / 1000);
    return Response.json(
      { error: 'rate_limited', retryInMs: budget.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(seconds) } },
    );
  }

  // Read the current file to verify ownership and get the SHA for deletion.
  const uncachedFetch = (url, init) => fetch(url, init, { cache: 'no-store' });
  const meta = await getContentsMeta(`domains/${name}.json`, {
    token: process.env.REGISTRY_TOKEN,
    fetchImpl: uncachedFetch,
  }).catch(() => null);

  if (!meta) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (meta.data.owner?.github?.toLowerCase() !== session.login.toLowerCase()) {
    return Response.json({ error: 'not_owner' }, { status: 403 });
  }

  // Delete the file via the GitHub contents API. The SHA proves we read
  // the current version; if someone changed the file between our read
  // and this delete, GitHub rejects with 409.
  const res = await fetch(
    `https://api.github.com/repos/${process.env.REGISTRY_REPO ?? 'zordhalo/runs-on.dev'}/contents/domains/${name}.json`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${process.env.REGISTRY_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `release: ${name} by @${session.login}`,
        sha: meta.sha,
      }),
    },
  ).catch(() => null);

  if (!res) {
    return Response.json({ error: 'network_error' }, { status: 502 });
  }
  if (res.status === 409) {
    return Response.json({ error: 'stale', detail: 'record changed elsewhere, try again' }, { status: 409 });
  }
  if (!res.ok) {
    return Response.json({ error: 'delete_failed', detail: `GitHub returned ${res.status}` }, { status: 502 });
  }

  return Response.json({
    ok: true,
    name,
    message: `${name}.runs-on.dev has been released and is now available to claim`,
  });
}
