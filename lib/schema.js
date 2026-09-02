import { validateName } from './name.js';

const TOP_LEVEL = new Set(['name', 'owner', 'claimedAt', 'records', 'subdomains']);
const RECORD_TYPES = new Set(['CNAME', 'A', 'TXT', 'MX', 'URL']);
// URL only makes sense at the claimed name itself: the app serves it by
// looking up that one name and issuing a redirect, and it doesn't route
// nested names at all, so a subdomain can never be served that way.
const SUBDOMAIN_RECORD_TYPES = new Set(['CNAME', 'A', 'TXT', 'MX']);
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
// A single leading underscore is allowed on top of the name grammar, because
// the two real-world uses of nesting (_atproto, _discord) require it. No
// dots, so a subdomain is exactly one label deep.
const SUBDOMAIN_LABEL = /^_?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_SUBDOMAINS = 10;
const MAX_MX_ENTRIES = 5;
const MAX_DNS_NAME_LENGTH = 253;

function isIPv4(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

// A URL record is an open-redirect surface on a domain other people trust,
// so it is validated as an absolute http(s) URL and nothing else. Reject
// javascript:/data:/vbscript: schemes (new URL() happily parses these, so
// the protocol must be checked explicitly) and protocol-relative
// `//evil.com` (new URL() without a base throws on these, but the explicit
// check makes the rejection obvious rather than incidental).
export function isValidRedirectUrl(value) {
  if (typeof value !== 'string' || value.startsWith('//')) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function validateMx(value, errors, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MX_ENTRIES) {
    errors.push(`${label}MX must be an array of 1 to ${MAX_MX_ENTRIES} entries`);
    return;
  }
  const bad = value.some((entry) => (
    entry === null || typeof entry !== 'object' || Array.isArray(entry)
    || !Number.isInteger(entry.priority) || entry.priority < 0 || entry.priority > 65535
    || typeof entry.value !== 'string' || !HOSTNAME.test(entry.value)
  ));
  if (bad) errors.push(`${label}MX entries must be { priority: 0-65535, value: hostname }`);
}

// Shared by the root `records` object and every `subdomains.<label>` object,
// since both hold the same record-type shapes under the same DNS
// coexistence rules. `allowUrl` is false for subdomains: the app only ever
// looks up the claimed name itself, so a URL redirect record there could
// never be served.
function validateRecordsShape(records, errors, { label = '', allowUrl } = {}) {
  if (records === null || typeof records !== 'object' || Array.isArray(records)) {
    errors.push(`${label}records must be an object`);
    return false;
  }

  const allowedTypes = allowUrl ? RECORD_TYPES : SUBDOMAIN_RECORD_TYPES;
  for (const key of Object.keys(records)) {
    if (!allowedTypes.has(key)) errors.push(`unknown record type: ${label}${key}`);
  }

  if ('URL' in records) {
    if (!allowUrl) {
      errors.push(`${label}URL is not allowed here`);
    } else if (Object.keys(records).length > 1) {
      errors.push(`${label}URL cannot coexist with other record types`);
    } else if (!isValidRedirectUrl(records.URL)) {
      errors.push(`${label}URL must be an absolute http(s) URL`);
    }
  }

  if ('CNAME' in records && ('A' in records || 'TXT' in records || 'MX' in records)) {
    errors.push(`${label}CNAME cannot coexist with other record types`);
  }

  if ('CNAME' in records && !HOSTNAME.test(String(records.CNAME))) {
    errors.push(`${label}CNAME must be a hostname`);
  }

  if ('A' in records) {
    if (!Array.isArray(records.A) || records.A.length === 0) {
      errors.push(`${label}A must be a non-empty array`);
    } else if (!records.A.every(isIPv4)) {
      errors.push(`${label}A entries must be IPv4 addresses`);
    }
  }

  if ('TXT' in records) {
    const ok = Array.isArray(records.TXT)
      && records.TXT.length > 0
      && records.TXT.every((v) => typeof v === 'string' && v.length <= 255);
    if (!ok) errors.push(`${label}TXT must be an array of strings up to 255 chars`);
  }

  if ('MX' in records) validateMx(records.MX, errors, label);

  return true;
}

function validateSubdomains(subdomains, rootName, errors) {
  if (subdomains === null || typeof subdomains !== 'object' || Array.isArray(subdomains)) {
    errors.push('subdomains must be an object');
    return;
  }

  const labels = Object.keys(subdomains);
  if (labels.length > MAX_SUBDOMAINS) {
    errors.push(`subdomains may not exceed ${MAX_SUBDOMAINS} entries`);
  }

  for (const label of labels) {
    if (!SUBDOMAIN_LABEL.test(label)) {
      errors.push(`subdomain label fails grammar: ${label}`);
    }

    // The full DNS name this label resolves to, so a legal-looking label on
    // a long root name can't push the zone past the 253-char DNS ceiling.
    const fullName = `${label}.${rootName}.runs-on.dev`;
    if (fullName.length > MAX_DNS_NAME_LENGTH) {
      errors.push(`subdomains.${label} pushes the full name past ${MAX_DNS_NAME_LENGTH} characters`);
    }

    validateRecordsShape(subdomains[label], errors, { label: `subdomains.${label}.`, allowUrl: false });
  }
}

export function validateRecord(obj) {
  const errors = [];
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['record must be an object'] };
  }

  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL.has(key)) errors.push(`unknown key: ${key}`);
  }

  if (!validateName(obj.name).ok) errors.push('name fails grammar');

  if (!obj.owner || typeof obj.owner.github !== 'string' || !obj.owner.github) {
    errors.push('owner.github is required');
  } else {
    // Unknown keys under `owner` are rejected for the same reason unknown
    // top-level keys are: a field nothing reads still looks authoritative
    // sitting in a file that says who holds the name.
    // schema/record.schema.json has always declared additionalProperties:
    // false here, so this is the mirror and the validator agreeing again.
    for (const key of Object.keys(obj.owner)) {
      if (key !== 'github') errors.push(`unknown key: owner.${key}`);
    }
  }

  if (typeof obj.claimedAt !== 'string' || Number.isNaN(Date.parse(obj.claimedAt))) {
    errors.push('claimedAt must be an ISO 8601 timestamp');
  }

  const recordsOk = validateRecordsShape(obj.records, errors, { allowUrl: true });
  if (!recordsOk) return { ok: false, errors };

  if ('subdomains' in obj) {
    const rootName = typeof obj.name === 'string' ? obj.name : '';
    validateSubdomains(obj.subdomains, rootName, errors);
  }

  return { ok: errors.length === 0, errors };
}
