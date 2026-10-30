// The claim map is baked into indexed PNGs (scripts/generate-claim-map.mjs)
// from pixelMap in app/components/claim-bloom.js: the world image at rest,
// and one per continent that home-map.jsx lays over it when a continent card
// is selected. These tests keep the committed images in step with the code
// and pin the behaviour that makes the heat readable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DOTMAP } from '../app/components/dotmap-data.js';
import {
  CONTINENTS,
  PALETTE,
  PITCH,
  SUB,
  bloomCenter,
  bloomCells,
  continentSlug,
  heatStrength,
  pixelMap,
} from '../app/components/claim-bloom.js';

const overlaySource = readFileSync('app/components/home-map.jsx', 'utf8');

test('the committed images are palette PNGs at native size with the current palette', () => {
  const files = ['public/claim-map.png', ...CONTINENTS.map((c) => `public/claim-map-${continentSlug(c)}.png`)];
  const plte = Buffer.from(PALETTE.flatMap((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))));
  for (const file of files) {
    assert.ok(existsSync(file), `${file} is committed`);
    const buf = readFileSync(file);
    assert.equal(buf.readUInt32BE(16), DOTMAP.cols * SUB, `${file} width`);
    assert.equal(buf.readUInt32BE(20), DOTMAP.rows.length * SUB, `${file} height`);
    assert.equal(buf[25], 3, `${file} is indexed`);
    // A stale build from before a palette change fails here.
    assert.ok(buf.includes(Buffer.concat([Buffer.from('PLTE'), plte])), `${file} carries the current palette`);
  }
});

test('the map draws as pixels from the shared module', () => {
  assert.ok(overlaySource.includes("from './claim-bloom.js'"), 'home-map imports the shared module');
  assert.ok(overlaySource.includes("imageRendering: 'pixelated'"), 'scaled up without smoothing');
});

test('heatStrength grows with the count and tops out at 1000', () => {
  const s = [1, 10, 100, 1000].map(heatStrength);
  assert.deepEqual([...s].sort((a, b) => a - b), s);
  assert.ok(s[0] < s[3]);
  assert.equal(heatStrength(1000), heatStrength(100000));
});

test('pixelMap draws a busier cell hotter, and a continent image holds only that continent', () => {
  const india = [22, 79];
  const brazil = [-10, -55];
  const points = [...Array(500).fill(india), brazil];
  const brightest = (pixels) => Math.max(...pixels);
  const at = ([lat, lon], { width, pixels }) => {
    const { x, y } = bloomCenter(lat, lon, DOTMAP.cols, DOTMAP.rows.length);
    const px = (x / PITCH) * SUB;
    const py = (y / PITCH) * SUB;
    return Math.max(...[-1, 0].flatMap((dy) => [-1, 0].map((dx) => pixels[(py + dy) * width + px + dx])));
  };
  const world = pixelMap(points, DOTMAP);
  assert.ok(at(india, world) > at(brazil, world), '500 claims glow brighter than 1');

  // LED matrix: only each cell's one dot pixel is ever lit, so heat can
  // recolour the grid but never flood the gaps into a blob.
  world.pixels.forEach((v, i) => {
    if (v && ((i % world.width) % SUB || Math.floor(i / world.width) % SUB)) assert.fail(`gap pixel ${i} is lit`);
  });

  const asia = pixelMap(points, DOTMAP, 'Asia');
  assert.equal(at(brazil, asia), 0, 'South America is blank in the Asia image');
  assert.equal(brightest(asia.pixels), brightest(world.pixels), 'the same claims glow the same in both');
});

test('bloomCells counts per cell and snaps offshore cells onto nearby land', () => {
  // A 4x2 grid: land only at column 1, row 0.
  const dotmap = { cols: 4, rows: ['0100', '0000'] };
  const lonOf = (c) => ((c + 0.5) / 4) * 360 - 180;
  const latOf = (r) => 84 - ((r + 0.5) / 2) * 140;
  const cells = bloomCells(
    [
      [latOf(0), lonOf(1)],
      [latOf(0), lonOf(1)],
      [latOf(1), lonOf(2)], // offshore, one cell from land: snaps onto it
    ],
    dotmap,
  );
  assert.deepEqual(cells, [{ x: PITCH * 1.5, y: PITCH / 2, count: 3 }]);
});

test('bloomCenter projects and clamps onto the dot grid', () => {
  const cols = 112;
  const rows = 50;
  // Null Island lands mid-grid; the poles and the date line clamp inside it.
  assert.deepEqual(bloomCenter(0, 0, cols, rows), { x: 56 * PITCH + PITCH / 2, y: 30 * PITCH + PITCH / 2 });
  assert.deepEqual(bloomCenter(90, -180, cols, rows), { x: PITCH / 2, y: PITCH / 2 });
  assert.deepEqual(bloomCenter(-90, 180, cols, rows), { x: (cols - 1) * PITCH + PITCH / 2, y: (rows - 1) * PITCH + PITCH / 2 });
});
