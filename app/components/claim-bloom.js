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
// The stats page's DotMap (app/components/ui.jsx) deliberately draws a
// different, intensity-scaled bloom and does not read these.
export const PITCH = 10;
export const DOT_R = 2.2;

// Two-layer bloom: a wide faint halo that reads at a glance, then a bright
// core the eye locks onto. A single small circle disappears against the
// base dots. Blooms are drawn per claim and composite, so density shows up
// as the halos stacking.
export const HALO_R = 9.3;
export const HALO_OPACITY = 0.22;
export const CORE_R = 3.2;
export const CORE_OPACITY = 0.9;

// Equirectangular projection onto the dot grid, clamped to it. Latitude runs
// 84°N down over 140° of span, which is the crop the dot matrix was drawn to.
export function bloomCenter(lat, lon, cols, rows) {
  const c = Math.min(cols - 1, Math.max(0, Math.floor(((lon + 180) / 360) * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(((84 - lat) / 140) * rows)));
  return { x: c * PITCH + PITCH / 2, y: r * PITCH + PITCH / 2 };
}
