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
