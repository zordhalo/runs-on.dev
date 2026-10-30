// The geometry of a claim bloom, in one place.
//
// Two renderers draw the same blooms: the prebuilt image in
// scripts/generate-claim-map-svg.mjs (the home map at rest) and the SVG
// overlay in home-map.jsx (the home map with a continent selected). They sit
// on top of each other, so any number that differs between them shows up as
// the resting map and the selected map disagreeing about the same claims.
// They drifted once already; importing the numbers from here is what keeps
// them honest.
//
// The stats page renders this same HomeMap, so every claim bloom on the
// site comes from these numbers.
export const PITCH = 10;
export const DOT_R = 2.2;

// Two-layer bloom: a wide faint halo that reads at a glance, then a bright
// core the eye locks onto. A single small circle disappears against the
// base dots. One bloom is drawn per grid cell, sized by how many claims the
// cell holds. Drawing one bloom per claim and letting the halos stack hid the
// real density: most claims carry only a country, so they share that
// country's centroid (India alone is ~1000 on one cell), and stacked 0.22
// halos are solid by ten claims, so 10 and 1000 looked identical.
//
// The curve is log10, pinned to a fixed 1000 rather than the current max, so
// the resting image and a continent overlay (which sees a different max)
// draw the same bloom for the same count. 1 claim -> t 0.1, 10 -> 0.35,
// 100 -> 0.67, 1000+ -> 1.
const round = (v) => Math.round(v * 100) / 100;
export function bloomStyle(count) {
  const t = Math.min(1, Math.log10(count + 1) / 3);
  return {
    haloR: round(6 + 10 * t),
    haloOpacity: round(0.18 + 0.3 * t),
    coreR: round(2.6 + 1.8 * t),
    coreOpacity: round(0.75 + 0.25 * t),
  };
}

// How far (in cells) an offshore bloom may move to sit on land. The 110m
// land grid's coastline often stops a cell short, so Mumbai, Singapore and
// Tunis landed in the sea. Two cells is ~6 degrees.
// ponytail: also pulls genuine islands (Mauritius onto Madagascar); a
// finer land grid is the real fix if that starts to matter.
export const SNAP_CELLS = 2;

// Groups [lat, lon] points into one bloom per grid cell, snapping offshore
// cells to the nearest land cell within SNAP_CELLS. Sorted by count so the
// biggest blooms paint last, on top.
export function bloomCells(points, dotmap) {
  const cols = dotmap.cols;
  const rows = dotmap.rows.length;
  const land = (c, r) => dotmap.rows[r]?.[c] === '1';
  const counts = new Map();
  for (const [lat, lon] of points) {
    const { x, y } = bloomCenter(lat, lon, cols, rows);
    let c = (x - PITCH / 2) / PITCH;
    let r = (y - PITCH / 2) / PITCH;
    if (!land(c, r)) {
      let best = null;
      for (let dr = -SNAP_CELLS; dr <= SNAP_CELLS; dr++) {
        for (let dc = -SNAP_CELLS; dc <= SNAP_CELLS; dc++) {
          const d = dr * dr + dc * dc;
          if (land(c + dc, r + dr) && (!best || d < best.d)) best = { d, dc, dr };
        }
      }
      if (best) {
        c += best.dc;
        r += best.dr;
      }
    }
    const key = r * cols + c;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => ({
      x: (key % cols) * PITCH + PITCH / 2,
      y: Math.floor(key / cols) * PITCH + PITCH / 2,
      count,
    }))
    .sort((a, b) => a.count - b.count);
}

// Equirectangular projection onto the dot grid, clamped to it. Latitude runs
// 84°N down over 140° of span, which is the crop the dot matrix was drawn to.
export function bloomCenter(lat, lon, cols, rows) {
  const c = Math.min(cols - 1, Math.max(0, Math.floor(((lon + 180) / 360) * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(((84 - lat) / 140) * rows)));
  return { x: c * PITCH + PITCH / 2, y: r * PITCH + PITCH / 2 };
}
