import { DOTMAP } from './dotmap-data.js';

// The page's structural element: a horizontal slit of light, fading smoothly
// into the canvas at both ends. Sections are separated exclusively by these
// lines, never by background shifts.
export function Divider({ className = '' }) {
  return <hr aria-hidden="true" className={`slit-h ${className}`} />;
}

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

export function continentOf([lat, lon]) {
  for (const [name, lonMin, latMin, lonMax, latMax] of CONTINENT_BOXES) {
    if (lon >= lonMin && lon <= lonMax && lat >= latMin && lat <= latMax) return name;
  }
  return null;
}

// Continent-wise claim counts beneath the map: cells in a wrapping,
// centre-justified row (a short last row stacks centred, not left), one per
// continent plus the honest unplaced count. Each cell carries the count set
// large at weight 400, a mono caption, and a thin blue bar scaled against the
// largest continent; the unplaced cell is muted with no bar. Clicking a
// continent card spotlights it on the map above (click again to clear).
export function ContinentChart({ points, total, heading = false, selected = null, onSelect, className = '' }) {
  const rows = Object.values(points)
    .reduce((acc, point) => {
      const name = continentOf(point);
      if (!name) return acc;
      const hit = acc.find((c) => c.name === name);
      if (hit) hit.count += 1;
      else acc.push({ name, count: 1 });
      return acc;
    }, [])
    .sort((a, b) => b.count - a.count);
  const unresolved = Math.max(total - points.length, 0);
  const max = rows[0]?.count ?? 1;
  const interactive = typeof onSelect === 'function';

  const cell = 'slit-frame w-[calc(50%-16px)] rounded-lg p-5 text-left sm:w-[calc(25%-30px)]';

  return (
    <div className={className}>
      {heading && (
        <div className="text-center">
          <h2 className="text-[23px] leading-[1.07] font-normal tracking-[-0.004em] text-(--color-ink)">
            Where the names are
          </h2>
          <p className="meta mt-2 normal-case">
            {points.length} of {total} owners resolved from claim-time countries and public GitHub profiles · counts approximate
          </p>
        </div>
      )}
      <div className={heading ? 'mt-8 flex flex-wrap justify-center gap-8 sm:gap-10' : 'flex flex-wrap justify-center gap-8 sm:gap-10'}>
        {rows.map((c) => {
          const active = selected === c.name;
          const body = (
            <>
              <div className="text-[34px] leading-[1.03] font-normal tracking-[-0.005em] text-(--color-ink)">
                {c.count}
              </div>
              <div className="meta mt-2">{c.name}</div>
              <div
                aria-hidden="true"
                className="mt-4 h-0.5 rounded-full"
                style={{
                  width: `${Math.max((c.count / max) * 100, 3)}%`,
                  backgroundImage: 'linear-gradient(90deg, var(--blue), transparent)',
                }}
              />
            </>
          );
          return interactive ? (
            <button
              key={c.name}
              type="button"
              onClick={() => onSelect(active ? null : c.name)}
              aria-pressed={active}
              aria-label={`Show ${c.name} on the map`}
              className={`${cell} cursor-pointer ${active ? 'slit-frame-bright' : ''}`}
            >
              {body}
            </button>
          ) : (
            <div key={c.name} className={cell}>
              {body}
            </div>
          );
        })}
        {unresolved > 0 && (
          <div className={`${cell} opacity-70`}>
            <div className="text-[34px] leading-[1.03] font-normal tracking-[-0.005em] text-(--color-muted)">
              {unresolved}
            </div>
            <div className="meta mt-2">No location</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Availability / status pill: badge surface inside a graphite hairline, a
// single pulse-green dot reserved for live/active states.
const TONES = {
  live: '#98ff38',
  ok: '#98ff38',
  pending: '#eab308',
  redirect: '#8ea1ff',
  neutral: '#9c9c9c',
  error: '#d97757',
};

export function StatusBadge({ tone = 'neutral', pulse = false, children }) {
  const color = TONES[tone] ?? TONES.neutral;
  return (
    <span className="slit-frame inline-flex items-center gap-2 rounded-[4px] bg-(--color-badge) px-3.5 py-2 font-(family-name:--font-mono) text-[12px] tracking-[0.05em] text-(--color-muted) uppercase">
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${pulse ? 'pulse-dot' : ''}`}
        style={{ background: color }}
      />
      {children}
    </span>
  );
}
