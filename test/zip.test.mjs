import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 as crcOf } from 'node:zlib';
import { readZip, isSafeEntryName, MAX_ZIP_BYTES, MAX_ENTRIES } from '../lib/zip.js';

// Builds a spec-conforming zip in memory so the reader is tested against the
// real byte layout, not a mock of it. `entries` is [{ name, data, method }] —
// the builder writes local headers, a central directory, and an EOCD, exactly
// the three structures a mainstream zip tool emits.
function makeZip(entries, { comment = '' } = {}) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 8;
    const data = entry.data ?? Buffer.alloc(0);
    const packed = method === 0 ? data : deflateRawSync(data);
    const crc = crcOf(data);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);          // version needed
    lfh.writeUInt16LE(0, 6);           // flags
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(0, 10);          // mod time/date
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(packed.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);          // local extra length
    local.push(lfh, nameBuf, packed);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);          // version made by
    cdh.writeUInt16LE(20, 6);          // version needed
    cdh.writeUInt16LE(0, 8);           // flags
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(0, 12);          // mod time/date
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(packed.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);          // extra length
    cdh.writeUInt16LE(0, 32);          // comment length
    cdh.writeUInt32LE(0, 34);          // disk start
    cdh.writeUInt32LE(0, 36);          // internal attrs
    cdh.writeUInt32LE(0, 38);          // external attrs
    cdh.writeUInt32LE(offset, 42);     // local header offset
    central.push(cdh, nameBuf);

    offset += 30 + nameBuf.length + packed.length;
  }

  const cdOffset = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);

  return Buffer.concat([...local, centralBuf, eocd, Buffer.from(comment, 'utf8')]);
}

const page = Buffer.from('<html>hello</html>', 'utf8');
const style = Buffer.from('body{margin:0}', 'utf8');

test('reads a deflated zip with nested paths', () => {
  const zip = makeZip([
    { name: 'index.html', data: page },
    { name: 'assets/app.css', data: style },
  ]);
  const out = readZip(zip);
  assert.equal(out.ok, true);
  assert.deepEqual(out.entries.map((e) => e.name), ['index.html', 'assets/app.css']);
  assert.equal(out.entries[0].data.toString(), '<html>hello</html>');
  assert.equal(out.entries[1].data.toString(), 'body{margin:0}');
});

test('reads stored (method 0) entries', () => {
  const zip = makeZip([{ name: 'index.html', data: page, method: 0 }]);
  const out = readZip(zip);
  assert.equal(out.ok, true);
  assert.equal(out.entries[0].data.toString(), '<html>hello</html>');
});

test('skips directory entries without counting them as files', () => {
  const zip = makeZip([
    { name: 'assets/', data: Buffer.alloc(0) },
    { name: 'index.html', data: page },
  ]);
  const out = readZip(zip);
  assert.equal(out.ok, true);
  assert.equal(out.entries.length, 1);
});

test('reads a zip with a trailing comment', () => {
  const zip = makeZip([{ name: 'index.html', data: page }], { comment: 'made by a test' });
  assert.equal(readZip(zip).ok, true);
});

test('rejects an empty buffer and a non-zip buffer', () => {
  assert.equal(readZip(Buffer.alloc(0)).reason, 'empty');
  assert.equal(readZip(Buffer.from('not a zip at all, definitely not')).reason, 'no_directory');
});

test('rejects a corrupt CRC', () => {
  const zip = makeZip([{ name: 'index.html', data: page }]);
  // Flip the CRC in the central directory: the entry will inflate to the
  // right size but fail integrity.
  const eocdAt = zip.length - 22;
  const cdSize = zip.readUInt32LE(eocdAt + 12);
  const cdAt = eocdAt - cdSize;
  zip.writeUInt32LE(0xdeadbeef, cdAt + 16);
  assert.equal(readZip(zip).reason, 'corrupt');
});

// Zero is the real CRC of empty content, not an opt-out flag: a nonempty
// entry claiming zero must fail integrity now that every entry is checked.
test('rejects a nonempty entry with a zeroed CRC', () => {
  const zip = makeZip([{ name: 'index.html', data: page }]);
  const eocdAt = zip.length - 22;
  const cdAt = eocdAt - zip.readUInt32LE(eocdAt + 12);
  zip.writeUInt32LE(0, cdAt + 16);
  assert.equal(readZip(zip).reason, 'corrupt');
});

test('accepts an empty file, whose CRC is genuinely zero', () => {
  const zip = makeZip([
    { name: 'index.html', data: page },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ]);
  const out = readZip(zip);
  assert.equal(out.ok, true);
  assert.equal(out.entries[1].data.length, 0);
});

// The central directory walk must consume exactly cdOffset + cdSize bytes.
// A final record whose extraLen overruns the declared directory is truncated
// metadata wearing a valid-looking header.
test('rejects a final central-directory record overrunning the directory', () => {
  const zip = makeZip([
    { name: 'index.html', data: page },
    { name: 'a.txt', data: Buffer.from('x') },
  ]);
  const eocdAt = zip.length - 22;
  const cdSize = zip.readUInt32LE(eocdAt + 12);
  const cdAt = eocdAt - cdSize;
  // Second record's header sits after the first record's 46 + nameLen bytes.
  const secondAt = cdAt + 46 + 'index.html'.length;
  zip.writeUInt16LE(100, secondAt + 30); // extraLen claims bytes that are not there
  assert.equal(readZip(zip).reason, 'corrupt');
});

test('rejects a central directory that does not end where it declares', () => {
  const zip = makeZip([{ name: 'index.html', data: page }]);
  const eocdAt = zip.length - 22;
  // Shrink the declared size by one byte: the records still parse, but the
  // walk ends past the boundary it promised to consume exactly.
  zip.writeUInt32LE(zip.readUInt32LE(eocdAt + 12) - 1, eocdAt + 12);
  assert.equal(readZip(zip).reason, 'corrupt');
});

test('rejects a duplicate entry name', () => {
  const zip = makeZip([
    { name: 'index.html', data: page },
    { name: 'index.html', data: page },
  ]);
  assert.equal(readZip(zip).reason, 'duplicate');
});

test('rejects encrypted entries', () => {
  const zip = makeZip([{ name: 'index.html', data: page }]);
  const eocdAt = zip.length - 22;
  const cdAt = eocdAt - zip.readUInt32LE(eocdAt + 12);
  const flags = zip.readUInt16LE(cdAt + 8);
  zip.writeUInt16LE(flags | 0x1, cdAt + 8);
  assert.equal(readZip(zip).reason, 'encrypted');
});

test('rejects an unsupported compression method', () => {
  const zip = makeZip([{ name: 'index.html', data: page }]);
  const eocdAt = zip.length - 22;
  const cdAt = eocdAt - zip.readUInt32LE(eocdAt + 12);
  zip.writeUInt16LE(12, cdAt + 10); // bzip2
  assert.equal(readZip(zip).reason, 'method');
});

// The zip-bomb shape: a central directory that claims a small uncompressed
// size for an entry that inflates far beyond the budget. maxOutputLength must
// stop the inflate, not just the post-hoc size check.
test('rejects an entry lying about its uncompressed size', () => {
  const bomb = Buffer.alloc(4 * 1024 * 1024, 0x41); // 4 MB inflates from ~4 KB
  const zip = makeZip([{ name: 'index.html', data: bomb }]);
  // Claim 100 bytes in both headers, keep the real deflate stream.
  const eocdAt = zip.length - 22;
  const cdAt = eocdAt - zip.readUInt32LE(eocdAt + 12);
  const lfhAt = zip.readUInt32LE(cdAt + 42);
  zip.writeUInt32LE(100, cdAt + 24);
  zip.writeUInt32LE(100, lfhAt + 22);
  const out = readZip(zip, { maxTotalUncompressed: 1024 * 1024 });
  assert.equal(out.ok, false);
});

test('enforces the entry-count cap', () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('x') }));
  const zip = makeZip(many);
  assert.equal(readZip(zip, { maxEntries: 10 }).reason, 'too_many_entries');
  assert.equal(readZip(zip).ok, true);
  assert.ok(MAX_ENTRIES >= 10);
});

test('enforces the total uncompressed budget across entries', () => {
  const chunk = Buffer.alloc(600 * 1024, 0x42);
  const zip = makeZip([
    { name: 'a.bin', data: chunk },
    { name: 'b.bin', data: chunk },
  ]);
  assert.equal(readZip(zip, { maxTotalUncompressed: 1024 * 1024 }).reason, 'too_big');
  assert.equal(readZip(zip, { maxTotalUncompressed: 2 * 1024 * 1024 }).ok, true);
});

test('rejects a buffer over MAX_ZIP_BYTES outright', () => {
  assert.equal(readZip(Buffer.alloc(MAX_ZIP_BYTES + 1)).reason, 'too_big');
});

test('isSafeEntryName accepts plain relative paths', () => {
  for (const good of ['index.html', 'assets/app.css', 'a/b/c.js', 'favicon.ico', 'x'.repeat(255)]) {
    assert.equal(isSafeEntryName(good), true, good);
  }
});

test('isSafeEntryName rejects traversal and absolute shapes', () => {
  for (const bad of [
    '', '/abs.html', '../up.js', 'a/../../b', 'a/./b', 'a//b', 'c:\\x', 'C:/x',
    'a\\b.html', 'nul\0byte', '.hidden/..', 'a/../b.txt', 'x'.repeat(256), 'a/', 'C:x',
  ]) {
    assert.equal(isSafeEntryName(bad), false, JSON.stringify(bad));
  }
});
