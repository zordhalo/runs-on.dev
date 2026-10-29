export default {
  reactStrictMode: true,
  // The home page recounts the registry off disk for its claim map at run
  // time (it renders dynamically because of session state). Output tracing
  // cannot see the readdir, so the registry files must ship to the lambda
  // explicitly or the read comes up empty in production.
  outputFileTracingIncludes: {
    '/': ['./domains/**'],
    // The banner reads the registry on disk for its claim serial, and the
    // card page does the same for the serial on the card itself; both are
    // runtime file reads that tracing cannot see.
    '/banner/[name]': ['./domains/**', './app/fonts/*.ttf'],
    '/sites/[name]': ['./domains/**'],
  },
  // Every page (and the markdown twin) varies by Accept: agents negotiating
  // text/markdown get /llms-md content while browsers get HTML, and a cache
  // must never serve one variant for the other. API JSON is untouched.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'X-API-Version', value: '1' }],
      },
      {
        source: '/:path*',
        headers: [{ key: 'Vary', value: 'Accept, Accept-Encoding, rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch' }],
      },
    ];
  },
  async rewrites() {
    return [
      // The MCP endpoint must live at /.well-known/mcp per the discovery
      // convention; app-router folders cannot start with a dot, so the
      // handler lives at /api/mcp and this rewrite mounts it there.
      { source: '/.well-known/mcp', destination: '/api/mcp' },
      // OAuth discovery for MCP clients (lib/oauth.js): the authorization
      // server metadata, and the MCP endpoint's own resource metadata at the
      // path-suffixed well-known URI (RFC 9728 3.1).
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata' },
      { source: '/.well-known/oauth-protected-resource/.well-known/mcp', destination: '/api/oauth/resource' },
    ];
  },
};
