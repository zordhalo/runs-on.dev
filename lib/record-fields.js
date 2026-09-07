// The translation between what the editor form shows (text in boxes) and the
// `records` object the registry stores. Kept out of the component so the
// parsing that decides what actually gets committed is testable on its own,
// rather than only reachable by rendering a form.

// The four shapes a record can legally take, which is the DNS coexistence
// rule in schema.js turned into something you can pick from: CNAME must stand
// alone, URL must stand alone, A/TXT/MX may be combined, and no records at
// all means the name keeps serving its profile card.
export const MODES = ['card', 'cname', 'advanced', 'url'];

export function modeOf(records = {}) {
  if ('URL' in records) return 'url';
  if ('CNAME' in records) return 'cname';
  if ('A' in records || 'TXT' in records || 'MX' in records) return 'advanced';
  return 'card';
}

export function linesToList(text) {
  return String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

// "10 mx.example.com" per line — the priority and the host, in the order they
// appear in every DNS console, rather than two inputs per row. A malformed
// line still produces an entry (with a NaN priority or an empty value) rather
// than being dropped, so schema validation reports it instead of the form
// quietly discarding what someone typed.
export function parseMx(text) {
  return linesToList(text).map((line) => {
    const [priority, ...rest] = line.split(/\s+/);
    return { priority: Number(priority), value: rest.join(' ') };
  });
}

export function mxToLines(mx = []) {
  return (Array.isArray(mx) ? mx : [])
    .map((e) => `${e?.priority ?? ''} ${e?.value ?? ''}`.trim())
    .join('\n');
}

// Only the active mode's fields are read. Switching mode therefore drops the
// records that could not have coexisted with the new shape anyway, which is
// the conservative reading: the record you can see on screen is exactly the
// record that gets written, with nothing carried invisibly underneath it.
export function buildRecords(mode, fields = {}) {
  if (mode === 'cname') {
    const value = String(fields.cname ?? '').trim();
    return value ? { CNAME: value } : {};
  }
  if (mode === 'url') {
    const value = String(fields.url ?? '').trim();
    return value ? { URL: value } : {};
  }
  if (mode === 'advanced') {
    const out = {};
    const a = linesToList(fields.a);
    const txt = linesToList(fields.txt);
    const mx = parseMx(fields.mx);
    if (a.length) out.A = a;
    if (txt.length) out.TXT = txt;
    if (mx.length) out.MX = mx;
    return out;
  }
  return {};
}

// Subdomain record types, in the order the form offers them. No URL: the app
// only ever looks up the claimed name itself, so a redirect one label down
// could never be served, and schema.js rejects it.
export const SUBDOMAIN_TYPES = ['TXT', 'CNAME', 'A', 'MX'];

// The form holds subdomains as flat {label, type, value} rows rather than as
// the nested object the record stores. One row is one thing a provider asked
// for ("put this TXT at _vercel"), which is how people actually receive them,
// and it keeps a label that legitimately carries two types -- A and TXT, say --
// from needing nested UI. Rows sharing a label merge back into one entry here,
// so the coexistence rules apply to the merged result exactly as they would to
// a hand-written file.
export function buildSubdomains(rows = []) {
  const out = {};
  for (const row of rows) {
    const label = String(row?.label ?? '').trim().toLowerCase();
    const type = row?.type;
    if (!label || !SUBDOMAIN_TYPES.includes(type)) continue;

    const value = parseValue(type, row?.value);
    // An empty row is someone who has added the row but not filled it in yet,
    // not a request to write an empty record.
    if (value === null) continue;

    out[label] ??= {};
    out[label][type] = value;
  }
  return out;
}

function parseValue(type, raw) {
  if (type === 'CNAME') {
    const v = String(raw ?? '').trim();
    return v ? v : null;
  }
  if (type === 'MX') {
    const mx = parseMx(raw);
    return mx.length ? mx : null;
  }
  const list = linesToList(raw);
  return list.length ? list : null;
}

// The inverse, for seeding the form from a stored record.
export function subdomainsToRows(subdomains = {}) {
  const rows = [];
  for (const label of Object.keys(subdomains ?? {})) {
    const entry = subdomains[label] ?? {};
    for (const type of Object.keys(entry)) {
      rows.push({ label, type, value: formatValue(type, entry[type]) });
    }
  }
  return rows;
}

function formatValue(type, value) {
  if (type === 'MX') return mxToLines(value);
  if (Array.isArray(value)) return value.join('\n');
  return String(value ?? '');
}

// --- profile ---

// The form holds profile links as flat {label, url} rows, seeded by
// profileToRows and folded back by buildProfile. Same discipline as
// subdomains rows: a row that is entirely empty is someone who has not
// filled it in yet, but a half-filled row survives parsing so schema
// validation reports it instead of the form quietly dropping what was
// typed.
export function profileToRows(profile = {}) {
  return (Array.isArray(profile?.links) ? profile.links : [])
    .map((link) => ({ label: String(link?.label ?? ''), url: String(link?.url ?? '') }));
}

export function buildProfile(fields = {}) {
  const name = String(fields.name ?? '').trim();
  const bio = String(fields.bio ?? '').trim();
  const rows = Array.isArray(fields.linkRows) ? fields.linkRows : [];

  const links = rows
    .filter((row) => String(row?.label ?? '').trim() !== '' || String(row?.url ?? '').trim() !== '')
    .map((row) => ({ label: String(row?.label ?? '').trim(), url: String(row?.url ?? '').trim() }));

  const out = {};
  if (name) out.name = name;
  if (bio) out.bio = bio;
  if (links.length) out.links = links;
  // undefined (not {}) tells the API route the owner removed everything,
  // which deletes the profile block from the record rather than committing
  // a `profile: {}` that means nothing.
  return Object.keys(out).length ? out : undefined;
}
