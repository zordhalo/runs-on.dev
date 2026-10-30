// Generates the claim map images: public/claim-map.png (the whole world, the
// home map at rest) and public/claim-map-<continent>.png (one spotlight per
// continent card). Indexed PNGs at native art-pixel size, scaled up in the
// page with image-rendering: pixelated, the way advance-labs ships its pixel
// scenes. Each is a couple of KB, and serving them as <img> keeps the map
// out of the homepage's HTML (agents and the content ratio both care).
//
// Heat is recounted from the live registry through the same geoPlacement the
// stats page uses, so the images can never drift behind the page's own
// numbers. Runs as a prebuild step; the committed copies are the latest output.
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { DOTMAP } from '../app/components/dotmap-data.js';
import { CLAIM_GEO } from '../app/components/claim-geo.js';
import countryCentroids from './country-centroids.json' with { type: 'json' };
import { readRegistry } from '../lib/registry-files.js';
import { geoPlacement } from '../lib/geo-placement.js';
import { CONTINENTS, PALETTE, continentSlug, pixelMap } from '../app/components/claim-bloom.js';

const { points } = geoPlacement(readRegistry(), CLAIM_GEO, countryCentroids);
const list = Object.values(points);

// Minimal 8-bit palette PNG; index 0 is fully transparent.
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}
function png({ width, height, pixels }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 3, 0, 0, 0], 8); // bit depth 8, colour type 3 (palette)
  const plte = Buffer.from(PALETTE.flatMap((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))));
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', Buffer.from([0])),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = [['public/claim-map.png', null], ...CONTINENTS.map((c) => [`public/claim-map-${continentSlug(c)}.png`, c])];
for (const [file, continent] of files) {
  const buf = png(pixelMap(list, DOTMAP, continent));
  writeFileSync(file, buf);
  console.log(`wrote ${file} (${(buf.length / 1024).toFixed(1)} KB)`);
}
console.log(`${list.length} claims plotted`);
