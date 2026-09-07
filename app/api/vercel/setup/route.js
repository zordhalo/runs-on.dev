import { sessionFromRequest } from '../../../../lib/session.js';
import { validateName } from '../../../../lib/name.js';
import { getRecord, getContentsMeta, putRecordUpdate } from '../../../../lib/registry.js';
import { validateEdit } from '../../../../lib/edit.js';
import { createRateLimiter } from '../../../../lib/throttle.js';

// One-click Vercel setup: adds the domain to the user's Vercel project,
// configures the registry record with the correct CNAME and verification
// TXT, then returns. The client polls and verifies. Eliminates every
// manual step that broke early users.

const VERCEL_API = 'https://api.vercel.com';

// Tighter than the write routes: a setup writes a registry commit AND makes
// multiple Vercel API calls. 3 per 10 minutes is plenty for a real owner
// doing a one-click setup, and blocks a leaned-on button from burning
// quota on either side.
const SETUP_WINDOW_MS = 10 * 60 * 1000;
const SETUP_MAX = 3;
const takeSetup = createRateLimiter({ windowMs: SETUP_WINDOW_MS, max: SETUP_MAX });

// Step 1: Add <name>.runs-on.dev to the Vercel project. Returns the
// recommended CNAME target and any verification challenge.
async function addDomainToProject(domain, project, vercelToken) {
  const res = await fetch(
    `${VERCEL_API}/v10/projects/${encodeURIComponent(project)}/domains`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // "Already added" arrives as 409 Conflict, or as 400 with the
    // domain_already_in_use error code when the domain is attached to
    // another project on the same account. Both mean we can proceed to
    // reading the config.
    if (res.status === 409 || body.error?.code === 'domain_already_in_use') {
      return { alreadyAdded: true };
    }
    throw new Error(body.error?.message ?? `Vercel API returned ${res.status}`);
  }
  return await res.json();
}

// Step 1b: If the domain was already added, fetch its config separately.
async function getDomainConfig(domain, project, vercelToken) {
  const res = await fetch(
    `${VERCEL_API}/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}`,
    { headers: { Authorization: `Bearer ${vercelToken}` } },
  );
  if (!res.ok) return null;
  return await res.json();
}

export async function POST(request) {
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

  // Rate limit keyed on the session login, same pattern as /api/records
  const budget = takeSetup(session.login.toLowerCase());
  if (!budget.ok) {
    const seconds = Math.ceil(budget.retryAfterMs / 1000);
    return Response.json(
      { error: 'rate_limited', retryInMs: budget.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(seconds) } },
    );
  }

  // Verify ownership
  const registryToken = process.env.REGISTRY_TOKEN;
  const fetchImpl = (url, init) => fetch(url, { ...init, next: { revalidate: 30 } });
  const record = await getRecord(name, { token: registryToken, fetchImpl }).catch(() => null);
  if (!record) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (record.owner.github.toLowerCase() !== session.login.toLowerCase()) {
    return Response.json({ error: 'not_owner' }, { status: 403 });
  }

  // Session token only, same as the other Vercel routes: no operator-token
  // fallback, so a setup always touches the user's own Vercel account.
  const vercelToken = session.vercelToken;
  if (!vercelToken) {
    return Response.json({ error: 'vercel_not_connected' }, { status: 400 });
  }

  const domain = `${name}.runs-on.dev`;
  const steps = [];

  // ── Step 1: Add domain to Vercel project ─────────────────
  let domainConfig;
  try {
    domainConfig = await addDomainToProject(domain, project, vercelToken);
    steps.push({ step: 'add-domain', ok: true, detail: domainConfig.alreadyAdded ? 'already added' : 'domain added' });
  } catch (err) {
    return Response.json({ error: 'vercel_add_failed', detail: err.message, steps }, { status: 502 });
  }

  // ── Step 2: Determine the correct CNAME and verification TXT ──
  if (domainConfig.alreadyAdded || !domainConfig.verification) {
    const fetched = await getDomainConfig(domain, project, vercelToken);
    if (!fetched) {
      // A failed config read must not fall through to a record write with
      // no verification TXT: the save would look successful and the domain
      // would never verify. Fail the whole setup instead.
      return Response.json({
        error: 'vercel_config_failed',
        detail: 'could not read the domain configuration from Vercel; nothing was saved',
        steps,
      }, { status: 502 });
    }
    domainConfig = fetched;
  }

  // The Vercel API returns no CNAME target field — it only tells you the
  // verification challenge. The correct CNAME is whatever the user already
  // has (if it points at vercel-dns) or the generic fallback. Never
  // overwrite a working hashed target with the generic one.
  const existingCname = record.records?.CNAME ?? '';
  const hasVercelCname = existingCname.includes('vercel-dns');
  const cnameTarget = hasVercelCname ? existingCname : 'cname.vercel-dns.com';

  const verification = domainConfig.verification?.[0];
  const txtValue = verification?.value; // "vc-domain-verify=<domain>,<token>"

  steps.push({ step: 'get-config', ok: true, detail: `CNAME: ${cnameTarget}` });

  // ── Step 3: Update the registry record directly (no internal HTTP call,
  // which avoids Next.js fetch caching causing stale SHA mismatches) ──
  const uncachedFetch = (url, init) => fetch(url, init, { cache: 'no-store' });
  const meta = await getContentsMeta(`domains/${name}.json`, {
    token: registryToken,
    fetchImpl: uncachedFetch,
  }).catch(() => null);

  if (!meta) {
    return Response.json({ error: 'record_not_found', steps }, { status: 404 });
  }

  const head = { ...meta.data };
  head.records = { CNAME: cnameTarget };
  if (txtValue) {
    // Preserve all other subdomain entries (_atproto, _discord, etc) and
    // only add or update the _vercel one. Replacing the whole object would
    // silently delete them.
    head.subdomains = { ...(meta.data.subdomains ?? {}) };
    head.subdomains._vercel = { TXT: [txtValue] };
  }

  // Validate the edit before committing
  const decision = validateEdit({ base: meta.data, head, editor: session.login });
  if (!decision.ok) {
    return Response.json({
      error: 'validation_failed',
      detail: decision.errors.join('; '),
      steps,
    }, { status: 400 });
  }

  const updateResult = await putRecordUpdate(head, {
    token: registryToken,
    sha: meta.sha,
    editor: session.login,
    fetchImpl: uncachedFetch,
  }).catch(() => ({ ok: false, reason: 'error' }));

  if (!updateResult.ok) {
    return Response.json({
      error: updateResult.reason === 'stale' ? 'stale' : 'record_update_failed',
      detail: updateResult.reason === 'stale'
        ? 'record changed elsewhere, try again'
        : 'could not save record',
      steps,
    }, { status: 409 });
  }

  steps.push({ step: 'update-record', ok: true, detail: txtValue ? 'CNAME + verification TXT saved' : 'CNAME saved' });

  // Return immediately after the record update. The zone mirror publish
  // (GitHub Actions sync-dns) takes 10-40 seconds, and holding this HTTP
  // request open that long risks timeouts. The client polls dns-check
  // and calls /api/vercel/verify when it sees the TXT is live.
  return Response.json({
    ok: true,
    name,
    project,
    cnameTarget,
    steps,
    txtValue: txtValue ?? null,
    verified: false,
    message: txtValue
      ? 'record saved. waiting for DNS sync, then verifying automatically.'
      : 'record saved.',
  });
}
