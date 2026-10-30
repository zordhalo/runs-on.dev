// The home map is drawn twice: prebuilt into public/claim-map.svg for the
// resting state, and as a live SVG overlay in home-map.jsx when a continent
// is selected. They sit on top of each other, so the two have to agree. They
// did not once (the overlay's halo was 9.3, the image's 7.2), which is what
// app/components/claim-bloom.js and these tests exist to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bloomCenter, bloomCells, bloomStyle, PITCH } from '../app/components/claim-bloom.js';

const svg = readFileSync('public/claim-map.svg', 'utf8');
const overlaySource = readFileSync('app/components/home-map.jsx', 'utf8');

test('every bloom in the committed map image is a bloomStyle size', () => {
  // Halo then core per cell. Any pair bloomStyle cannot produce for some
  // count means the image is a stale build from before the curve changed.
  const circles = [...svg.matchAll(/r="([0-9.]+)" fill-opacity="([0-9.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(circles.length > 0 && circles.length % 2 === 0);
  const known = new Map();
  for (let n = 1; n <= 5000; n++) {
    const s = bloomStyle(n);
    known.set(`${s.haloR},${s.haloOpacity},${s.coreR},${s.coreOpacity}`, n);
  }
  for (let i = 0; i < circles.length; i += 2) {
    const key = [...circles[i], ...circles[i + 1]].join(',');
    assert.ok(known.has(key), `bloom ${key} is not a bloomStyle output`);
  }
});

test('the overlay reads its geometry from the shared module, never literals', () => {
  assert.ok(overlaySource.includes("from './claim-bloom.js'"), 'home-map imports the shared geometry');
  assert.ok(overlaySource.includes('bloomCells(') && overlaySource.includes('bloomStyle('), 'overlay uses the shared grouping and sizing');
  assert.ok(!/r=\{[0-9]/.test(overlaySource), 'no hard-coded radius survives in the overlay');
});

test('bloomStyle grows with the count and tops out at 1000', () => {
  const sizes = [1, 10, 100, 1000].map((n) => bloomStyle(n).haloR);
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes);
  assert.ok(sizes[0] < sizes[3]);
  assert.deepEqual(bloomStyle(1000), bloomStyle(100000));
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
