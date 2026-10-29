import { mcpResourceMetadata, issuerFor, CORS } from '../../../../lib/oauth.js';

// RFC 9728 protected-resource metadata for the MCP endpoint specifically,
// mounted at /.well-known/oauth-protected-resource/.well-known/mcp by a
// rewrite. Its `resource` is the MCP URL itself, which is what clients check
// it against; the root document describes the whole API.
export function GET(request) {
  return Response.json(mcpResourceMetadata(issuerFor(request)), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
