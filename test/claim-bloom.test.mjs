// The home map is drawn twice: prebuilt into public/claim-map.svg for the
// resting state, and as a live SVG overlay in home-map.jsx when a continent
// is selected. They sit on top of each other, so the two have to agree. They
// did not once (the overlay's halo was 9.3, the image's 7.2), which is what
// app/components/claim-bloom.js and these tests exist to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HALO_R, HALO_OPACITY, CORE_R, CORE_OPACITY, bloomCenter, PITCH } from '../app/components/claim-bloom.js';

const svg = readFileSync('public/claim-map.svg', 'utf8');
const overlaySource = readFileSync('app/components/home-map.jsx', 'utf8');

test('the committed map image draws blooms at the shared radii', () => {
  assert.ok(svg.includes(`r="${HALO_R}" fill-opacity="${HALO_OPACITY}"`), 'halo matches the shared constants');
  assert.ok(svg.includes(`r="${CORE_R}" fill-opacity="${CORE_OPACITY}"`), 'core matches the shared constants');

  // No other bloom geometry may appear, or the image is a stale build from
  // before a constant changed.
  const radii = new Set([...svg.matchAll(/r="([0-9.]+)" fill-opacity=/g)].map((m) => m[1]));
  assert.deepEqual([...radii].sort(), [String(CORE_R), String(HALO_R)].sort());
});

test('the overlay reads its geometry from the shared module, never literals', () => {
  assert.ok(overlaySource.includes("from './claim-bloom.js'"), 'home-map imports the shared geometry');
  assert.ok(overlaySource.includes('r={HALO_R}') && overlaySource.includes('r={CORE_R}'), 'overlay uses the constants');
  assert.ok(!/r=\{[0-9]/.test(overlaySource), 'no hard-coded radius survives in the overlay');
});

test('bloomCenter projects and clamps onto the dot grid', () => {
  const cols = 112;
  const rows = 50;
  // Null Island lands mid-grid; the poles and the date line clamp inside it.
  assert.deepEqual(bloomCenter(0, 0, cols, rows), { x: 56 * PITCH + PITCH / 2, y: 30 * PITCH + PITCH / 2 });
  assert.deepEqual(bloomCenter(90, -180, cols, rows), { x: PITCH / 2, y: PITCH / 2 });
  assert.deepEqual(bloomCenter(-90, 180, cols, rows), { x: (cols - 1) * PITCH + PITCH / 2, y: (rows - 1) * PITCH + PITCH / 2 });
});
