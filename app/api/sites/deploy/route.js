import { authorizeBearer, resolveSiteName } from '../../../../lib/site-access.js';
import { createRateLimiter } from '../../../../lib/throttle.js';
import { readZip, MAX_ZIP_BYTES } from '../../../../lib/zip.js';
import { storeConfigured } from '../../../../lib/store.js';
import { publishSite, toResponse } from '../../../../lib/site-actions.js';

// A deploy spends real storage and a registry commit, so it gets the same
// order of allowance a record edit does rather than a read's.
const DEPLOY_WINDOW_MS = 10 * 60 * 1000;
const DEPLOY_MAX = 6;
const takeDeploy = createRateLimiter({ windowMs: DEPLOY_WINDOW_MS, max: DEPLOY_MAX });

export const runtime = 'nodejs';

// POST a zip, get a live deployment. Body: multipart/form-data with `site`
// (the zip, required) and `name` (optional while accounts hold one name).
// The upload-then-pointer write order lives in lib/site-actions.js.
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
  const auth = await authorizeBearer(request, takeDeploy);
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

  return toResponse(await publishSite({ login: auth.login, name: name.name }, zip.entries));
}
