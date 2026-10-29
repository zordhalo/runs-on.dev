import { authorizationServerMetadata, issuerFor, CORS } from '../../../../lib/oauth.js';

// RFC 8414 authorization server metadata, mounted at
// /.well-known/oauth-authorization-server by a rewrite.
export function GET(request) {
  return Response.json(authorizationServerMetadata(issuerFor(request)), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
