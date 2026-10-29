// Where was this scan taken? GPS → nearby shop or restaurant (OpenStreetMap) → place.
//
// Sources, in order of trust:
//   1. GPS embedded in the photo (only library photos keep it on iOS, and only if
//      "Include location" is on in the photo picker; camera captures are stripped by Safari)
//   2. The phone's current position (navigator.geolocation) at scan time
// Place names come from OpenStreetMap's Overpass API (free, no key). Coordinates are sent
// to OpenStreetMap only; everything found is stored on the phone.

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const RETAIL_SHOPS = 'supermarket|hypermarket|wine|alcohol|beverages|convenience|deli|wholesale|department_store|general|mall|kiosk';
const HORECA_AMENITIES = 'restaurant|bar|pub|cafe|biergarten|fast_food|nightclub|food_court';

export const KIND_LABEL = {
  supermarket: 'Supermarket', hypermarket: 'Hypermarket', wine: 'Wine shop', alcohol: 'Drinks shop', beverages: 'Drinks shop',
  convenience: 'Convenience store', deli: 'Deli', wholesale: 'Cash & carry', department_store: 'Department store',
  general: 'Shop', mall: 'Mall', kiosk: 'Kiosk',
  restaurant: 'Restaurant', bar: 'Bar', pub: 'Pub', cafe: 'Café', biergarten: 'Beer garden', fast_food: 'Fast food',
  nightclub: 'Club', food_court: 'Food court', hotel: 'Hotel', wine_bar: 'Wine bar',
};

/* ---------------------------------------------------------------- distance */

export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ---------------------------------------------------------------- phone position */

/** Resolves { lat, lon, accuracy, source:'gps' } or rejects with { code:'denied'|'unavailable'|'timeout'|'unsupported' }. */
export function currentPosition({ timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject({ code: 'unsupported' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy || 0) || null, source: 'gps' }),
      (e) => reject({ code: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable', message: e.message }),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

/* ---------------------------------------------------------------- photo EXIF GPS */

/** Reads GPS from a JPEG's EXIF block. Returns { lat, lon, source:'photo' } or null. */
export async function exifGps(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    return parseExifGps(new DataView(buf));
  } catch { return null; }
}

export function parseExifGps(v) {
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // not a JPEG
  let off = 2;
  while (off + 4 < v.byteLength) {
    if (v.getUint8(off) !== 0xff) return null;
    const marker = v.getUint8(off + 1);
    const len = v.getUint16(off + 2);
    if (marker === 0xe1 && v.getUint32(off + 4) === 0x45786966) return readTiffGps(v, off + 10); // "Exif"
    if (marker === 0xda) return null; // start of image data, no EXIF
    off += 2 + len;
  }
  return null;
}

function readTiffGps(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  const ifd0 = u32(4);
  let gpsOff = null;
  const n0 = u16(ifd0);
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8825) gpsOff = u32(e + 8);
  }
  if (gpsOff == null) return null;
  const tags = {};
  const n = u16(gpsOff);
  for (let i = 0; i < n; i++) {
    const e = gpsOff + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    if (type === 2) { // ASCII ref (N/S/E/W), fits in the value field
      tags[tag] = String.fromCharCode(v.getUint8(t + e + 8));
    } else if (type === 5 && count === 3) { // 3 rationals: deg, min, sec
      const p = u32(e + 8);
      const r = (k) => { const d = u32(p + k * 8 + 4); return d ? u32(p + k * 8) / d : 0; };
      tags[tag] = r(0) + r(1) / 60 + r(2) / 3600;
    }
  }
  if (tags[2] == null || tags[4] == null) return null;
  const lat = tags[2] * (tags[1] === 'S' ? -1 : 1);
  const lon = tags[4] * (tags[3] === 'W' ? -1 : 1);
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return null;
  return { lat, lon, accuracy: null, source: 'photo' };
}

/* ---------------------------------------------------------------- nearby places (OSM) */

export function searchRadius(accuracy) {
  return Math.round(Math.max(60, Math.min(300, (accuracy || 50) * 1.5)));
}

export function overpassQuery(lat, lon, radius, domain) {
  const a = `around:${radius},${lat.toFixed(6)},${lon.toFixed(6)}`;
  const body = domain === 'horeca'
    ? `nwr(${a})["amenity"~"^(${HORECA_AMENITIES})$"];nwr(${a})["tourism"="hotel"];nwr(${a})["shop"="wine"]["bar"="yes"];`
    : `nwr(${a})["shop"~"^(${RETAIL_SHOPS})$"];`;
  return `[out:json][timeout:8];(${body});out center tags 40;`;
}

/** Turns Overpass elements into place candidates, nearest first. */
export function parseOverpass(json, origin, domain) {
  const out = [];
  for (const el of json?.elements || []) {
    const tg = el.tags || {};
    const name = tg.name || tg.brand;
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const kind = tg.amenity === 'bar' && /wine|vin/i.test(name) ? 'wine_bar' : (tg.shop || tg.amenity || tg.tourism || null);
    const street = [tg['addr:street'], tg['addr:housenumber']].filter(Boolean).join(' ');
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name: tg.brand && tg.name && !tg.name.toLowerCase().includes(tg.brand.toLowerCase()) ? `${tg.brand} ${tg.name}` : name,
      brand: tg.brand || null,
      kind,
      domain,
      lat, lon,
      address: [street, tg['addr:city']].filter(Boolean).join(', ') || null,
      source: 'osm',
      distance: Math.round(distanceM(origin, { lat, lon })),
    });
  }
  const seen = new Set();
  return out.sort((a, b) => a.distance - b.distance).filter((p) => !seen.has(p.id) && seen.add(p.id));
}

export async function nearbyPlaces(pos, domain, { signal, fetchImpl = fetch } = {}) {
  const q = overpassQuery(pos.lat, pos.lon, searchRadius(pos.accuracy), domain);
  let lastErr;
  for (const url of OVERPASS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      // Form-encoded POST is a "simple" CORS request: no preflight needed.
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return parseOverpass(await res.json(), pos, domain);
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr || new Error('Place search unavailable');
}

/* ---------------------------------------------------------------- matching */

const tokens = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 1 && !['the', 'si', 'and', 'restaurant', 'bistro', 'bar', 'srl', 'sa'].includes(t));

/** 0..1 similarity between a printed name (price tag, menu header) and a place. */
export function nameSimilarity(hint, place) {
  const a = new Set(tokens(hint));
  if (!a.size) return 0;
  const b = new Set([...tokens(place.name), ...tokens(place.brand)]);
  let hit = 0;
  a.forEach((t) => { if (b.has(t)) hit++; });
  return hit / a.size;
}

/**
 * Choose a place automatically, or return null to let the person choose.
 *   - a printed name (store/venue hint) that matches a candidate wins
 *   - else the nearest candidate if it is clearly the closest and within GPS accuracy
 *   - else a place you saved before, within GPS accuracy
 */
export function autoChoose(candidates, { hint, accuracy } = {}) {
  if (!candidates.length) return null;
  if (hint) {
    const best = candidates.map((c) => ({ c, s: nameSimilarity(hint, c) })).sort((x, y) => y.s - x.s)[0];
    if (best.s >= 0.5) return { place: best.c, reason: 'name' };
  }
  const tol = Math.max(40, accuracy || 0);
  const [a, b] = candidates;
  if (a.distance <= tol && (!b || b.distance >= a.distance * 1.6 + 10)) return { place: a, reason: 'nearest' };
  const known = candidates.find((c) => c.known && c.distance <= tol);
  if (known) return { place: known, reason: 'known' };
  return null;
}

/** Stable id for a place known only by its printed name (no GPS). */
export function namePlaceId(name, domain) {
  return `name:${domain}:${tokens(name).join('-') || 'unnamed'}`;
}
