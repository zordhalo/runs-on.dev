'use client';

import { useState } from 'react';
import { ContinentChart } from './ui.jsx';
import FlapFrame from './flap-frame.jsx';
import { continentSlug } from './claim-bloom.js';

// The home page's claim map: Bayer-dithered square pixels baked at build time
// (scripts/generate-claim-map.mjs) into tiny indexed PNGs, scaled up with
// image-rendering: pixelated. The continent cards drive a spotlight: the
// world image dims and that continent's own image (only its land and claims)
// lays over it, bright. Nothing about the map lives in the page's HTML.
//
// Points, resolved, and total are recounted against the live registry by the
// page that renders this (see lib/geo-placement.js), so the cards and the
// unplaced count always sum to the current owner total. The images are
// recounted by the same code at build time.
const pixelated = { imageRendering: 'pixelated' };

export default function HomeMap({ heading = false, points = {}, resolved = 0, total = 0 }) {
  const [selected, setSelected] = useState(null);

  return (
    <div>
      <FlapFrame>
        <div className="relative">
          <img
            src="/claim-map.png"
            width={224}
            height={100}
            alt={`Pixel world map where brighter blue marks claimed runs-on.dev names: ${resolved} of ${total} owners resolved from claim-time countries and public GitHub profiles`}
            className="h-auto w-full transition-opacity duration-500"
            style={{ ...pixelated, opacity: selected ? 0.15 : 1 }}
          />
          {selected && (
            <img
              src={`/claim-map-${continentSlug(selected)}.png`}
              width={224}
              height={100}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={pixelated}
            />
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
