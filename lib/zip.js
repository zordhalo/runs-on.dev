import { inflateRawSync, crc32 } from 'node:zlib';

// A minimal, strict ZIP reader for untrusted uploads. No dependency, because
// everything hostile about a zip is size-shaped and checkable before a single
// byte is decompressed: the caps below are enforced against the central
// directory (entry count, per-entry sizes, total uncompressed budget) and the
// inflate call carries maxOutputLength so a central directory that lies about
// a size cannot allocate its way past the budget either.
//
// Supported: methods 0 (stored) and 8 (deflate) — what every zip tool emits.
// Rejected: encryption, other compression methods, ZIP64 (a 10 MB upload has
// no legitimate need for it), duplicate names, and any entry name that is not
// a plain relative path.

export const MAX_ZIP_BYTES = 10 * 1024 * 1024;
export const MAX_ENTRIES = 500;
export const MAX_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
// EOCD is 22 bytes; the only variable part after it is a comment capped at
// 65535, so the signature can hide no further back than this.
const EOCD_WINDOW = 22 + 65535;

function findEOCD(buffer) {
  const floor = Math.max(0, buffer.length - EOCD_WINDOW);
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) !== EOCD_SIG) continue;
    // The trailing comment length must account for every byte after the EOCD.
    // Without that check a signature-looking byte sequence inside a comment
    // or a deflated body could pose as the directory locator.
    if (buffer.readUInt16LE(i + 20) === buffer.length - i - 22) return i;
  }
  return -1;
}

// Entry names become storage paths, so the rule is: a plain relative path,
// nothing else. No absolute paths, no drive letters, no backslashes (the zip
// spec says `/`, a `\` is either a hostile name or a broken writer), no `..`
// or `.` or empty segments, no NULs. Directory entries (trailing `/`) are
// skipped by the caller before this runs.
export function isSafeEntryName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false;
  if (name.includes('\0') || name.includes('\\') || name.includes(':')) return false;
  if (name.startsWith('/')) return false;
  if (/^[a-zA-Z]/.test(name) && name[1] === ':') return false;
  const segments = name.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;
  return true;
}

export function readZip(buffer, {
  maxEntries = MAX_ENTRIES,
  maxTotalUncompressed = MAX_TOTAL_UNCOMPRESSED,
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return fail('empty');
  if (buffer.length > MAX_ZIP_BYTES) return fail('too_big');

  const eocd = findEOCD(buffer);
  if (eocd < 0) return fail('no_directory');

  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);

  // ZIP64 escape hatches. An upload under MAX_ZIP_BYTES has no use for them,
  // and the 0xFFFFFFFF sentinels mean "look elsewhere for the real number",
  // which this reader deliberately does not do.
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    return fail('zip64');
  }
  if (entries === 0) return fail('empty');
  if (entries > maxEntries) return fail('too_many_entries');
  if (cdOffset + cdSize > eocd) return fail('corrupt');

  const files = [];
  const seen = new Set();
  let totalUncompressed = 0;

  // Every record — header, name, extra, comment — must fit inside the
  // directory the EOCD declared, and the walk must land exactly on its end.
  // An unbounded extraLen or commentLen on the final record would otherwise
  // stride past the directory (or past the buffer) reading "metadata" that
  // was never there.
  const cdEnd = cdOffset + cdSize;

  let pos = cdOffset;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > cdEnd || buffer.readUInt32LE(pos) !== CD_SIG) return fail('corrupt');

    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const compSize = buffer.readUInt32LE(pos + 20);
    const uncompSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);

    if (pos + 46 + nameLen + extraLen + commentLen > cdEnd) return fail('corrupt');
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    // Directory entries are structural, not files; skip them rather than
    // reject, since every mainstream zip tool emits them.
    if (name.endsWith('/')) continue;

    if (flags & 0x1) return fail('encrypted');
    if (method !== 0 && method !== 8) return fail('method');
    if (!isSafeEntryName(name)) return fail('name');
    if (seen.has(name)) return fail('duplicate');
    seen.add(name);

    // Stored entries carry their bytes verbatim, so the two sizes are the same
    // number by definition; anything else is a corrupt writer.
    if (method === 0 && compSize !== uncompSize) return fail('corrupt');

    if (uncompSize > maxTotalUncompressed) return fail('too_big');
    totalUncompressed += uncompSize;
    if (totalUncompressed > maxTotalUncompressed) return fail('too_big');

    files.push({ name, method, crc, compSize, uncompSize, localOffset });
  }

  // The declared directory must be consumed exactly: trailing slack inside it
  // is a directory that lied about its own size.
  if (pos !== cdEnd) return fail('corrupt');

  // Extraction. `raw` subarrays share the zip buffer's memory rather than
  // copying; entries collectively keep at most MAX_ZIP_BYTES alive, which is
  // the same budget the upload already spent.
  const out = [];
  let budget = maxTotalUncompressed;
  for (const file of files) {
    const lfh = file.localOffset;
    if (lfhOutOfBounds(buffer, lfh)) return fail('corrupt');
    if (buffer.readUInt32LE(lfh) !== LFH_SIG) return fail('corrupt');

    // The local header carries its own name/extra lengths, and the extra
    // field length may legally differ from the central directory's copy — so
    // the data offset comes from here, never from the central entry.
    const lNameLen = buffer.readUInt16LE(lfh + 26);
    const lExtraLen = buffer.readUInt16LE(lfh + 28);
    const dataStart = lfh + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + file.compSize;
    if (dataEnd > buffer.length) return fail('corrupt');

    const raw = buffer.subarray(dataStart, dataEnd);
    let data;
    if (file.method === 0) {
      data = raw;
    } else {
      try {
        // maxOutputLength one past the remaining budget: a lying central
        // directory that claims a small entry and inflates to gigabytes dies
        // here instead of allocating them.
        data = inflateRawSync(raw, { maxOutputLength: budget + 1 });
      } catch {
        return fail('corrupt');
      }
    }
    if (data.length !== file.uncompSize) return fail('corrupt');
    // Always verified: zero is the legitimate CRC of empty content, so a
    // zero field is not a "nothing to check" marker an archive can claim to
    // opt out of integrity — crc32 of the empty buffer is zero and passes.
    if (crc32(data) !== file.crc) return fail('corrupt');
    budget -= data.length;

    out.push({ name: file.name, data });
  }

  return { ok: true, entries: out, totalBytes: maxTotalUncompressed - budget };
}

function lfhOutOfBounds(buffer, offset) {
  return offset < 0 || offset + 30 > buffer.length;
}

function fail(reason) {
  return { ok: false, reason };
}
