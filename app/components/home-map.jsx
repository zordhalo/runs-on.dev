'use client';

import { useState } from 'react';
import { ContinentChart, continentOf } from './ui.jsx';
import { DOTMAP } from './dotmap-data.js';
import FlapFrame from './flap-frame.jsx';

// The home page's claim map: the base world is a static image (keeps ~1600
// map elements out of the HTML), and the continent cards drive a client-side
// spotlight. Selecting a continent dims the image and draws an SVG overlay
// holding only that continent's dots and claim blooms, bright. The overlay
// renders on demand, so the page's raw HTML never pays for it.
//
// Points, resolved, and total are recounted against the live registry by the
// page that renders this (see lib/geo-placement.js), so the cards and the
// unplaced count always sum to the current owner total.
const PITCH = 10;
const COLS = DOTMAP.cols;

function cellContinent(c, r) {
  const lon = ((c + 0.5) / COLS) * 360 - 180;
  const lat = 84 - ((r + 0.5) / DOTMAP.rows.length) * 140;
  return continentOf([lat, lon]);
}

export default function HomeMap({ heading = false, points = {}, resolved = 0, total = 0 }) {
  const [selected, setSelected] = useState(null);

  // Heat blooms grouped per continent at render time (the data is a few KB).
  const heatByContinent = new Map();
  for (const point of Object.values(points)) {
    const name = continentOf(point);
    if (!name) continue;
    if (!heatByContinent.has(name)) heatByContinent.set(name, []);
    heatByContinent.get(name).push(point);
  }

  const overlay = selected ? heatByContinent.get(selected) ?? [] : [];

  return (
    <div>
      <FlapFrame>
        <div className="relative">
          <img
            src="/claim-map.svg"
            alt={`Dot-matrix world map where brighter dots mark claimed runs-on.dev names: ${resolved} of ${total} owners resolved from claim-time countries and public GitHub profiles`}
            className="h-auto w-full transition-opacity duration-500"
            style={{ opacity: selected ? 0.15 : 1 }}
          />
          {selected && overlay.length > 0 && (
            <svg
              viewBox="0 0 1120 500"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
              focusable="false"
            >
              <g fill="#f3f3f3" fillOpacity="0.55">
                {DOTMAP.rows.map((line, r) => {
                  const dots = [];
                  for (let c = 0; c < COLS; c++) {
                    if (line[c] === '1' && cellContinent(c, r) === selected) {
                      dots.push(<circle key={`${c}-${r}`} cx={c * PITCH + PITCH / 2} cy={r * PITCH + PITCH / 2} r={2.2} />);
                    }
                  }
                  return dots.length ? <g key={r}>{dots}</g> : null;
                })}
              </g>
              <g fill="#4d7cff">
                {overlay.map(([lat, lon], idx) => {
                  const c = Math.min(COLS - 1, Math.max(0, Math.floor(((lon + 180) / 360) * COLS)));
                  const r = Math.min(DOTMAP.rows.length - 1, Math.max(0, Math.floor(((84 - lat) / 140) * DOTMAP.rows.length)));
                  return (
                    <g key={idx}>
                      <circle cx={c * PITCH + PITCH / 2} cy={r * PITCH + PITCH / 2} r={8 + 1.3} fillOpacity="0.22" />
                      <circle cx={c * PITCH + PITCH / 2} cy={r * PITCH + PITCH / 2} r={3.2} fillOpacity="0.9" />
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>
      </FlapFrame>

      <div className="mx-auto max-w-[900px] px-6 pt-10 pb-4">
        <ContinentChart
          heading={heading}
          points={Object.values(points)}
          total={total}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}
