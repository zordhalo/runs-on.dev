import { authorizeBearer, resolveSiteName } from '../../../../lib/site-access.js';
import { createRateLimiter } from '../../../../lib/throttle.js';
import { readZip, MAX_ZIP_BYTES } from '../../../../lib/zip.js';
import { getSite, putSite, applyDeployment, newDeployment } from '../../../../lib/sites.js';
import { storeConfigured, putDeployment, deletePrefixes } from '../../../../lib/store.js';

// A deploy spends real storage and a registry commit, so it gets the same
// order of allowance a record edit does rather than a read's.
const DEPLOY_WINDOW_MS = 10 * 60 * 1000;
const DEPLOY_MAX = 6;
const takeDeploy = createRateLimiter({ windowMs: DEPLOY_WINDOW_MS, max: DEPLOY_MAX });

const TOKEN = () => process.env.REGISTRY_TOKEN;

export const runtime = 'nodejs';

// POST a zip, get a live deployment. Body: multipart/form-data with `site`
// (the zip, required) and `name` (optional while accounts hold one name).
//
// The write order is deliberate: upload the files first, then move the
// pointer. If the pointer write fails or loses a race, the freshly uploaded
// prefix is reclaimed right there — a crash between the two is the only path
// that can still orphan storage, and only a future cleanup workflow can see
// that, because to every reader the orphan has never been referenced.
export async function POST(request) {
  if (!storeConfigured()) {
    return Response.json({ error: 'storage_not_configured' }, { status: 503 });
  }

  // Refuse on the declared size before anything parses. The envelope adds a
  // little overhead to the zip itself, so the hard check stays on file.size.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_ZIP_BYTES + 64 * 1024) {
    return Response.json({ error: 'too_big' }, { status: 413 });
  }

  // Credential and budget before the body: an unauthenticated caller must
  // not be able to make the server parse anything, only spend its own
  // (now-consumed) allowance.
  const auth = authorizeBearer(request, takeDeploy);
  if (auth.response) return auth.response;

  const form = await request.formData().catch(() => null);
  if (!form) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  const file = form.get('site');
  if (!(file instanceof File)) {
    return Response.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size > MAX_ZIP_BYTES) {
    return Response.json({ error: 'too_big' }, { status: 413 });
  }

  const name = await resolveSiteName(auth, form.get('name'));
  if (name.response) return name.response;

  const zip = readZip(Buffer.from(await file.arrayBuffer()));
  if (!zip.ok) {
    return Response.json({ error: 'invalid_zip', reason: zip.reason }, { status: 400 });
  }
  if (!zip.entries.some((e) => e.name === 'index.html')) {
    return Response.json({ error: 'no_index_html' }, { status: 400 });
  }

  let existing;
  try {
    existing = await getSite(name.name, { token: TOKEN() });
  } catch {
    return Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '4' } });
  }

  const deployment = newDeployment({ files: zip.entries.length, bytes: zip.totalBytes });
  const prefix = `sites/${name.name}/${deployment.id}/`;
  const stored = await putDeployment(prefix, zip.entries);
  if (!stored.ok) {
    return Response.json({ error: 'storage_error' }, { status: 503 });
  }

  const { record, pruned } = applyDeployment(existing?.data, {
    name: name.name,
    owner: auth.login,
    deployment,
  });
  const result = await putSite(record, {
    token: TOKEN(),
    sha: existing?.sha,
    editor: auth.login,
  });
  if (!result.ok) {
    // This deployment never entered history, so no future prune can see the
    // prefix. Reclaim it now, best-effort — a failed delete is leftover
    // storage, and it must never mask the failure that caused it.
    await deletePrefixes([prefix]);
    if (result.reason === 'stale' || result.reason === 'exists') {
      // Another deploy of this name landed mid-flight (a lost race on the
      // first deploy reports `exists`); the caller re-reads and decides,
      // exactly as a stale record edit does.
      return Response.json({ error: 'stale' }, { status: 409 });
    }
    if (result.reason === 'ratelimited') {
      return Response.json({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '4' } });
    }
    return Response.json({ error: 'server_error' }, { status: 500 });
  }

  // Sweep what fell out of history. Best-effort by design: the pointer has
  // moved, and leftover bytes are a storage cost, not a correctness problem.
  if (pruned.length > 0) {
    await deletePrefixes(pruned.map((d) => `sites/${name.name}/${d.id}/`));
  }

  return Response.json({
    url: `https://${name.name}.runs-on.dev/`,
    deploymentId: deployment.id,
    files: deployment.files,
    bytes: deployment.bytes,
    commit: result.commit ?? null,
  });
}
