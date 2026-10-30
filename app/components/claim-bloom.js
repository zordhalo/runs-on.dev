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
// palette, no anti-aliasing. Each map cell is SUB x SUB art pixels.
export const SUB = 2;
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16));

// Index 0 is transparent (the page shows through). 1 is land: one lit pixel
// per cell, which keeps the dot-matrix grid of the original map (a filled
// cell reads as a heavy slab and drowns the heat). 2-5 are the claim ramp,
// ending on the site's blue and a near-white for the hottest pixels.
export const PALETTE = ['#000000', '#55555c', '#16245a', '#2541a8', '#4d7cff', '#b9cbff'];
const LAND = 1;
const HEAT = [2, 3, 4, 5];

// Claim heat glows from each cell, with strength and spread on a log10 curve
// pinned to 1000 claims rather than the current max, so the world image and
// a continent image (which sees a different max) glow the same for the same
// count. Most claims carry only a country, so they share its centroid (India
// is ~1000 on one cell): a linear scale would make everything else vanish.
// 1 claim -> 0.1, 10 -> 0.35, 100 -> 0.67, 1000+ -> 1.
export function heatStrength(count) {
  return Math.min(1, Math.log10(count + 1) / 3) * 0.85 + 0.15;
}
// Heat over the sea draws at this fraction, so glows soften past coasts.
const SEA_HEAT = 0.35;

// Renders the map as palette indices, width x height art pixels, row-major.
// With a continent, only that continent's land and claims are drawn.
export function pixelMap(points, dotmap, continent = null) {
  const cols = dotmap.cols;
  const rows = dotmap.rows.length;
  const width = cols * SUB;
  const height = rows * SUB;
  const mine = continent ? points.filter((p) => continentOf(p) === continent) : points;

  const field = new Float32Array(width * height);
  for (const { x, y, count } of bloomCells(mine, dotmap)) {
    const cx = (x / PITCH) * SUB;
    const cy = (y / PITCH) * SUB;
    const amp = heatStrength(count);
    const sig = SUB * (0.45 + 1.1 * amp);
    const reach = Math.ceil(4 * sig);
    for (let py = Math.max(0, Math.floor(cy) - reach); py < Math.min(height, cy + reach); py++) {
      for (let px = Math.max(0, Math.floor(cx) - reach); px < Math.min(width, cx + reach); px++) {
        const d2 = (px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2;
        const i = py * width + px;
        field[i] = Math.max(field[i], amp * Math.exp(-d2 / (2 * sig * sig)));
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

  const pixels = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const b = BAYER[py % 4][px % 4];
      const land = isLand(Math.floor(px / SUB), Math.floor(py / SUB));
      const h = field[py * width + px] * (land ? 1 : SEA_HEAT);
      const level = Math.floor(h * HEAT.length + b - 0.5);
      if (h > 0.04 && level >= 0) pixels[py * width + px] = HEAT[Math.min(HEAT.length - 1, level)];
      else if (land && px % SUB === 0 && py % SUB === 0) pixels[py * width + px] = LAND;
    }
  }
  return { width, height, pixels };
}
