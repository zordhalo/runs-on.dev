import { validateEdit, isUnchanged } from './edit.js';
import { getContentsMeta, putRecordUpdate } from './registry.js';
import { validateName } from './name.js';

const TOKEN = () => process.env.REGISTRY_TOKEN;

// The edit itself, after the caller has settled who `login` is and spent its
// rate budget. Shared by /api/records (session cookie) and the MCP server
// (manage-scoped bearer token) so the two front doors cannot drift into
// enforcing different rules: both end in validateEdit, the same gate CI
// applies to a pull request.
//
// Returns { status, body } for the caller to send in its own envelope.
export async function editRecord(login, body) {
  const name = typeof body?.name === 'string' ? body.name.trim().toLowerCase() : '';
  if (!validateName(name).ok) {
    return { status: 400, body: { error: 'invalid_name' } };
  }

  let meta;
  try {
    meta = await getContentsMeta(`domains/${name}.json`, { token: TOKEN() });
  } catch {
    // Fail closed, as /api/claim does: a read that could not run must not be
    // treated as "no such record" or as permission to write.
    return { status: 503, body: { error: 'busy', retryInMs: 4000 } };
  }
  if (!meta) {
    return { status: 404, body: { error: 'not_found' } };
  }

  // Replace only what the request actually sent. A form that does not yet
  // understand `subdomains` must not silently delete an owner's _atproto
  // entry just by omitting it from the payload. `profile` follows the same
  // contract, with `null` as the explicit "remove it" signal, because
  // omitting the key and emptying the fields are different intents: the
  // first is an older form, the second is an owner clearing their card.
  const head = { ...meta.data };
  if ('records' in body) head.records = body.records;
  if ('subdomains' in body) {
    const subs = body.subdomains;
    const empty = subs === null || (typeof subs === 'object' && Object.keys(subs).length === 0);
    if (empty) delete head.subdomains;
    else head.subdomains = subs;
  }
  if ('profile' in body) {
    if (body.profile === null) delete head.profile;
    else head.profile = body.profile;
  }

  // Nothing to do. Answering before the ownership check would leak whether a
  // record exists in the shape someone guessed, so this sits after the read
  // but the ownership check below still runs first for a non-owner: a no-op
  // submitted against someone else's record is refused, not reported as fine.
  if (isUnchanged(meta.data, head)) {
    const owns = validateEdit({ base: meta.data, head, editor: login });
    if (!owns.ok) {
      return { status: 403, body: { error: 'not_owner', details: owns.errors } };
    }
    return { status: 200, body: { updated: name, unchanged: true, commit: null } };
  }

  const decision = validateEdit({ base: meta.data, head, editor: login });
  if (!decision.ok) {
    // An ownership refusal is a 403; anything else is the payload's fault.
    const forbidden = decision.errors.some((e) => e.startsWith('only the owner'));
    return {
      status: forbidden ? 403 : 400,
      body: { error: forbidden ? 'not_owner' : 'invalid_record', details: decision.errors },
    };
  }

  const result = await putRecordUpdate(head, { token: TOKEN(), sha: meta.sha, editor: login });

  if (result.ok) {
    return { status: 200, body: { updated: name, commit: result.commit ?? null } };
  }
  if (result.reason === 'stale') {
    // The record changed under this edit. Re-read and decide again rather
    // than overwrite whatever landed in between.
    return { status: 409, body: { error: 'stale' } };
  }
  if (result.reason === 'ratelimited') return { status: 503, body: { error: 'busy', retryInMs: 4000 } };
  return { status: 500, body: { error: 'server_error' } };
}
