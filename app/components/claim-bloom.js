// The claim map's geometry and pixels, in one place.
//
// The map is baked at build time (scripts/generate-claim-map.mjs) into
// indexed PNGs drawn as square pixels: one for the whole world at rest, and
// one per continent that home-map.jsx lays over the dimmed world when a
// continent card is selected. Both come from pixelMap below, so the resting
// map and the selected map cannot disagree about the same claims.
//
// The stats page renders this same HomeMap, so every claim pixel on the site
// comes from here. Plain JS (no JSX) so the build script can import it.
export const PITCH = 10;

// Continent bucketing for the claim map: rough lat/lon boxes, checked in an
// order that settles the overlaps (Europe before Asia and Africa, Oceania
// before Asia, North before South America). Crude on purpose; the caption on
// the stats page says the whole thing is approximate.
const CONTINENT_BOXES = [
  ['Europe', -25, 36, 60, 72],
  ['Africa', -20, -37, 52, 37],
  ['Oceania', 110, -50, 180, 0],
  ['North America', -170, 12, -52, 72],
  ['South America', -82, -56, -34, 13],
  ['Asia', 25, 0, 180, 80],
];
export const CONTINENTS = CONTINENT_BOXES.map(([name]) => name);

export function continentOf([lat, lon]) {
  for (const [name, lonMin, latMin, lonMax, latMax] of CONTINENT_BOXES) {
    if (lon >= lonMin && lon <= lonMax && lat >= latMin && lat <= latMax) return name;
  }
  return null;
}

// public/claim-map-<slug>.png holds a continent's spotlight image.
export const continentSlug = (name) => name.toLowerCase().replace(/ /g, '-');

// How far (in cells) an offshore bloom may move to sit on land. The 110m
// land grid's coastline often stops a cell short, so Mumbai, Singapore and
// Tunis glowed from the sea. Two cells is ~6 degrees.
// ponytail: also pulls genuine islands (Mauritius onto Madagascar); a
// finer land grid is the real fix if that starts to matter.
export const SNAP_CELLS = 2;

// Groups [lat, lon] points into one heat source per grid cell, snapping offshore
// cells to the nearest land cell within SNAP_CELLS.
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
    }));
}

// Equirectangular projection onto the dot grid, clamped to it. Latitude runs
// 84°N down over 140° of span, which is the crop the dot matrix was drawn to.
export function bloomCenter(lat, lon, cols, rows) {
  const c = Math.min(cols - 1, Math.max(0, Math.floor(((lon + 180) / 360) * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(((84 - lat) / 140) * rows)));
  return { x: c * PITCH + PITCH / 2, y: r * PITCH + PITCH / 2 };
}

// The pixel look shared with advance-labs (web/scripts/pixelate.py) and
// aeo-toolkit: square pixels, a 4x4 Bayer ordered dither, a small fixed
// palette, no anti-aliasing. Each map cell is SUB x SUB art pixels, of
// which only one is ever lit.
export const SUB = 2;
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16));

// Index 0 is transparent (the page shows through). 1 is unclaimed land. 2-6
// are the claim ramp, ending on the site's blue and a near-white for the
// hottest dots. The land grey is dim on purpose so blue is the only thing
// that draws the eye.
export const PALETTE = ['#000000', '#38383d', '#2a3f8f', '#3c62d9', '#4d7cff', '#9db5ff', '#e4ebff'];
const LAND = 1;
const RAMP = [LAND, 2, 3, 4, 5, 6];

// Claim heat glows from each cell, with strength and spread on a log10 curve
// pinned to 1000 claims rather than the current max, so the world image and
// a continent image (which sees a different max) glow the same for the same
// count. Most claims carry only a country, so they share its centroid (India
// is ~1000 on one cell): a linear scale would make everything else vanish.
// 1 claim -> 0.1, 10 -> 0.35, 100 -> 0.67, 1000+ -> 1.
export function heatStrength(count) {
  return Math.min(1, Math.log10(count + 1) / 3) * 0.85 + 0.15;
}

// Renders the map as palette indices, width x height art pixels, row-major.
// With a continent, only that continent's land and claims are drawn.
//
// An LED matrix: every land cell is one lit pixel (a square dot on the
// PITCH grid), and claim heat changes the dot's colour, never the gaps.
// Filling the gaps turned each hotspot into a solid blob that erased the
// grid and the coastline right where the claims are. Heat lives per cell
// and the Bayer dither runs dot to dot, so density reads as a soft gradient.
export function pixelMap(points, dotmap, continent = null) {
  const cols = dotmap.cols;
  const rows = dotmap.rows.length;
  const mine = continent ? points.filter((p) => continentOf(p) === continent) : points;

  const heat = new Float32Array(cols * rows);
  for (const { x, y, count } of bloomCells(mine, dotmap)) {
    const cx = (x - PITCH / 2) / PITCH;
    const cy = (y - PITCH / 2) / PITCH;
    const amp = heatStrength(count);
    const sig = 1.15 * (0.35 + amp);
    const reach = Math.ceil(3 * sig);
    for (let r = Math.max(0, cy - reach); r <= Math.min(rows - 1, cy + reach); r++) {
      for (let c = Math.max(0, cx - reach); c <= Math.min(cols - 1, cx + reach); c++) {
        const v = amp * Math.exp(-((c - cx) ** 2 + (r - cy) ** 2) / (2 * sig * sig));
        heat[r * cols + c] = Math.max(heat[r * cols + c], v);
      }
    }
  }

  const isLand = (c, r) => {
    if (dotmap.rows[r][c] !== '1') return false;
    if (!continent) return true;
    const lon = ((c + 0.5) / cols) * 360 - 180;
    const lat = 84 - ((r + 0.5) / rows) * 140;
    return continentOf([lat, lon]) === continent;
  };

  const width = cols * SUB;
  const height = rows * SUB;
  const pixels = new Uint8Array(width * height);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isLand(c, r)) continue;
      const h = heat[r * cols + c];
      const level = h > 0.03 ? Math.floor(h * (RAMP.length - 1) + BAYER[r % 4][c % 4]) : 0;
      pixels[r * SUB * width + c * SUB] = RAMP[Math.min(RAMP.length - 1, level)];
    }
  }
  return { width, height, pixels };
}
