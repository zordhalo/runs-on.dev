import dns from 'node:dns/promises';

// The "what is this name actually serving" probe, shared by /api/dns-check
// (the manage page's verify loop) and the public /debug/<name> page. Kept in
// lib so both answer with the same verdict for the same name at the same
// moment; a debug page that disagreed with the panel it explains would be
// worse than no page at all.

const ZONE = 'runs-on.dev';
const PROBE_TIMEOUT_MS = 8000;

// SSRF guard: the record's A entries and any redirect target must not point
// at a private network the server can reach. lib/schema.js accepts any valid
// IPv4 including loopback, link-local, and RFC 1918 ranges — the schema
// governs what DNS can express, not what an endpoint should fetch.
const PRIVATE_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
];

// TOCTOU: this resolves the name once, then `fetch` below resolves it again
// independently. A short-TTL record could answer public here and private on
// the second lookup (DNS rebinding). Fixing properly means resolving once and
// connecting to the pinned address, which is more machinery than this
// warrants today: `redirect: 'manual'` means at most a `<title>` comes back,
// from a host inside our own zone, and the schema only accepts A records
// (no AAAA, so no `::1` bypass). The reasoning lives here so it isn't
// rediscovered.
async function resolveAndCheckPrivate(hostname) {
  const addresses = await dns.resolve4(hostname).catch(() => []);
  return addresses.some((addr) => PRIVATE_RANGES.some((pattern) => pattern.test(addr)));
}

// No redirect following. The initial URL is always <name>.runs-on.dev
// (grammar-validated by every caller), so the destination is constrained by
// DNS, not by whoever set the record. A URL-redirect name still classifies
// correctly: the registry's own wildcard serves the 307 itself, and the probe
// sees the registry's answer, not the redirect target.
export async function probe(name) {
  const host = `${name}.${ZONE}`;
  try {
    if (await resolveAndCheckPrivate(host)) {
      return { ok: true, refused: true, finalHost: host, title: '', finalUrl: `https://${host}/` };
    }
    const res = await fetch(`https://${host}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { 'user-agent': 'runs-on-dev-probe (github.com/zordhalo/runs-on.dev)' },
    });
    const location = res.headers.get('location');
    // A 3xx without following the redirect: classify by the status, don't
    // fetch wherever it points.
    if (res.status >= 300 && res.status < 400 && location) {
      return { ok: true, finalHost: host, title: '', finalUrl: location, redirected: true };
    }
    const body = await res.text();
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? '';
    return { ok: true, finalHost: host, title, finalUrl: `https://${host}/` };
  } catch {
    return { ok: false };
  }
}
