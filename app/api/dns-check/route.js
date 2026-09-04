import dns from 'node:dns/promises';
import { validateName } from '../../../lib/name.js';
import { getRecord } from '../../../lib/registry.js';
import { classifyClaim } from '../../../lib/health.js';
import { createRateLimiter } from '../../../lib/throttle.js';

// Node runtime for node:dns — edge has no resolver. Dynamic because the
// answer is a live DNS reading; caching it would turn "did it work?" into
// "did it work five minutes ago".
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ZONE = 'runs-on.dev';
const PROBE_TIMEOUT_MS = 8000;

// Same budget the write routes use: generous for a real owner polling after
// a save, tight enough that a leaned-on loop can't spend the registry's DNS
// resolver or outbound bandwidth indefinitely. Keyed on the requested name,
// which is the natural abuse unit (one name per poller).
const CHECK_WINDOW_MS = 60 * 1000;
const CHECK_MAX = 10;
const takeCheck = createRateLimiter({ windowMs: CHECK_WINDOW_MS, max: CHECK_MAX });

// SSRF guard: the record's A entries and any redirect target must not point
// at a private network the server can reach. lib/schema.js accepts any valid
// IPv4 including loopback, link-local, and RFC 1918 ranges — the schema
// governs what DNS can express, not what this endpoint should fetch.
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

export function isPrivateAddress(host) {
  if (PRIVATE_RANGES.some((pattern) => pattern.test(host))) return true;
  // An A record pointing at a private range is the same attack: the name
  // resolves, the fetch goes to the private address, and the response body
  // comes back through this endpoint.
  return false;
}

async function resolveAndCheckPrivate(hostname) {
  const addresses = await dns.resolve4(hostname).catch(() => []);
  return addresses.some((addr) => PRIVATE_RANGES.some((pattern) => pattern.test(addr)));
}

// Everything this endpoint returns is already public: DNS answers and the
// page a name serves. It accepts any grammar-valid name for that reason —
// but it still reads the record through the same short revalidate window the
// card uses, so a poll loop costs the registry's GitHub quota almost
// nothing rather than one authenticated read per poll.
async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function flattenTxt(records) {
  return (records ?? []).map((chunks) => chunks.join(''));
}

// No redirect following. The initial URL is always <name>.runs-on.dev
// (grammar-validated), so the destination is constrained by DNS, not by
// whoever set the record. A URL-redirect name will still be classified
// correctly: the registry's own wildcard serves the 307 itself, and the
// probe sees the registry's page, not the redirect target.
async function probe(name) {
  const host = `${name}.${ZONE}`;
  try {
    // SSRF: if the name's A records point at a private range, the fetch
    // would reach inside the network. Resolve first, refuse before fetching.
    if (await resolveAndCheckPrivate(host)) {
      return { ok: true, refused: true, finalHost: host, title: '', finalUrl: `https://${host}/` };
    }
    const res = await fetch(`https://${host}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { 'user-agent': 'runs-on-dev-dns-check (github.com/zordhalo/runs-on.dev)' },
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

export async function GET(request) {
  const name = (new URL(request.url).searchParams.get('name') ?? '').trim().toLowerCase();
  if (!validateName(name).ok) {
    return Response.json({ error: 'invalid_name' }, { status: 400 });
  }

  const budget = takeCheck(name);
  if (!budget.ok) {
    const seconds = Math.ceil(budget.retryAfterMs / 1000);
    return Response.json(
      { error: 'rate_limited', retryInMs: budget.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(seconds) } },
    );
  }

  const token = process.env.CARD_TOKEN ?? process.env.REGISTRY_TOKEN;
  const fetchImpl = (url, init) => fetch(url, { ...init, next: { revalidate: 30 } });
  const record = await safe(() => getRecord(name, { token, fetchImpl }), null);
  if (!record) return Response.json({ error: 'not_found' }, { status: 404 });

  const [cname, a, txtName, txtVercelLabel, txtVercelZone, servingProbe] = await Promise.all([
    safe(() => dns.resolveCname(`${name}.${ZONE}`), []),
    safe(() => dns.resolve4(`${name}.${ZONE}`), []),
    safe(() => dns.resolveTxt(`${name}.${ZONE}`), []),
    safe(() => dns.resolveTxt(`_vercel.${name}.${ZONE}`), []),
    // The zone-level host the mirror publishes to: reading it here is what
    // lets the panel say "published at the zone" instead of making the owner
    // trust a green checkmark they cannot see anywhere.
    safe(() => dns.resolveTxt(`_vercel.${ZONE}`), []),
    probe(name),
  ]);

  return Response.json({
    name,
    cname,
    a,
    txt: {
      name: flattenTxt(txtName),
      vercelLabel: flattenTxt(txtVercelLabel),
      zoneVercel: flattenTxt(txtVercelZone),
    },
    serving: {
      status: classifyClaim(record, servingProbe),
      title: servingProbe.ok && !servingProbe.refused ? servingProbe.title : null,
      finalUrl: servingProbe.ok ? servingProbe.finalUrl : null,
    },
  });
}
