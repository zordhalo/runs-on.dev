import { registerClient, NO_STORE, CORS } from '../../../../lib/oauth.js';
import { createRateLimiter } from '../../../../lib/throttle.js';

// RFC 7591 dynamic client registration. Stateless: the client id handed back
// is the signed registration itself, so registering costs nothing but a
// signature and nothing needs cleaning up. Throttled per IP anyway, because
// an unauthenticated endpoint that never says no is an invitation.
const takeRegister = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });

export async function POST(request) {
  const secret = process.env.SITE_TOKEN_SECRET;
  if (!secret) return Response.json({ error: 'temporarily_unavailable' }, { status: 503, headers: CORS });

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (!takeRegister(ip).ok) {
    return Response.json({ error: 'slow_down' }, { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
  }

  const meta = await request.json().catch(() => null);
  const out = registerClient(meta, secret);
  if (!out.ok) {
    return Response.json(
      { error: out.error, error_description: out.detail },
      { status: 400, headers: { ...CORS, ...NO_STORE } },
    );
  }
  return Response.json({
    client_id: out.clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: out.client.name,
    redirect_uris: out.client.redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, { status: 201, headers: { ...CORS, ...NO_STORE } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
