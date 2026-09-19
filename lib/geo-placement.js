// Placement of claimed owners on the world map, recounted against the live
// registry on every build. Coordinates come from two sources, in order: the
// claim-time country each record carries (mapped to a country centroid), then
// the script-generated GitHub-location geocodes in app/components/claim-geo.js
// for older claims that predate the country field. Owners who released a name
// drop out of the points, every new claim is counted in the total, and the
// continent cards plus the unplaced card always sum to the live owner count.
// Pure: no fs, no fetch, no Next.
export function geoPlacement(records = [], geocoded = {}, centroids = {}) {
  const list = Array.isArray(records) ? records : [];

  const logins = new Set();
  for (const record of list) {
    const login = record?.owner?.github;
    if (typeof login === 'string' && login) logins.add(login.toLowerCase());
  }

  // GitHub logins are case-insensitive but the generated geocode file was
  // keyed before that was normalised, so the lookup has to be too.
  const geocodedByLogin = new Map();
  for (const [login, point] of Object.entries(geocoded ?? {})) {
    geocodedByLogin.set(login.toLowerCase(), point);
  }

  const points = {};
  let resolved = 0;
  for (const record of list) {
    const login = record?.owner?.github;
    if (typeof login !== 'string' || !login) continue;
    const key = login.toLowerCase();
    if (key in points) continue;

    let point = null;
    const centroid = typeof record?.country === 'string' ? centroids[record.country.toUpperCase()] : undefined;
    if (Array.isArray(centroid) && Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])) {
      point = centroid;
    } else {
      const geocoded = geocodedByLogin.get(key);
      // The generated file carries a few [null, null] entries; an
      // unparseable coordinate is exactly what the unplaced card shows.
      if (Array.isArray(geocoded) && Number.isFinite(geocoded[0]) && Number.isFinite(geocoded[1])) {
        point = geocoded;
      }
    }
    if (point) {
      points[key] = point;
      resolved += 1;
    }
  }

  return { points, resolved, total: logins.size };
}
