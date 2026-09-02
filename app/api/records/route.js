import { sessionFromRequest } from '../../../lib/session.js';
import { validateEdit } from '../../../lib/edit.js';
import { getContentsMeta, putRecordUpdate } from '../../../lib/registry.js';
import { validateName } from '../../../lib/name.js';

const TOKEN = () => process.env.REGISTRY_TOKEN;

const BUSY_RESPONSE = () =>
  Response.json({ error: 'busy', retryInMs: 4000 }, { status: 503, headers: { 'Retry-After': '4' } });

// The second write path onto domains/<name>.json, alongside /api/claim and a
// merged pull request. It commits straight to main for the same reason
// claiming does: the record file is the registry, and making an owner fork a
// repo to point their own name is the friction that leaves most claimed names
// pointing nowhere. The commit is still a public diff in the log, and the
// rules it must satisfy are the same ones CI applies to a pull request,
// because both call validateEdit.
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

  let meta;
  try {
    meta = await getContentsMeta(`domains/${name}.json`, { token: TOKEN() });
  } catch {
    // Fail closed, as /api/claim does: a read that could not run must not be
    // treated as "no such record" or as permission to write.
    return BUSY_RESPONSE();
  }
  if (!meta) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // Replace only what the request actually sent. A form that does not yet
  // understand `subdomains` must not silently delete an owner's _atproto
  // entry just by omitting it from the payload.
  const head = { ...meta.data };
  if ('records' in body) head.records = body.records;
  if ('subdomains' in body) {
    const subs = body.subdomains;
    const empty = subs === null || (typeof subs === 'object' && Object.keys(subs).length === 0);
    if (empty) delete head.subdomains;
    else head.subdomains = subs;
  }

  const decision = validateEdit({ base: meta.data, head, editor: session.login });
  if (!decision.ok) {
    // An ownership refusal is a 403; anything else is the payload's fault.
    const forbidden = decision.errors.some((e) => e.startsWith('only the owner'));
    return Response.json(
      { error: forbidden ? 'not_owner' : 'invalid_record', details: decision.errors },
      { status: forbidden ? 403 : 400 },
    );
  }

  const result = await putRecordUpdate(head, {
    token: TOKEN(),
    sha: meta.sha,
    editor: session.login,
  });

  if (result.ok) {
    return Response.json({ updated: name, commit: result.commit ?? null });
  }
  if (result.reason === 'stale') {
    // The record changed under this edit. Re-read and decide again rather
    // than overwrite whatever landed in between.
    return Response.json({ error: 'stale' }, { status: 409 });
  }
  if (result.reason === 'ratelimited') return BUSY_RESPONSE();
  return Response.json({ error: 'server_error' }, { status: 500 });
}
