// Local wine database in IndexedDB (on the phone, persists between visits).
//
// v2 stores:
//   wines        key = wineKey, or "horeca|"+wineKey for restaurant lookups
//                → { key, wineKey, domain, info, label, fetchedAt }
//   observations auto id → every price you saw:
//                { key, label, domain, price, priceKind, per750, volume_ml, promo,
//                  placeId, placeName, lat, lon, accuracy, scanId, at }
//   places       key = place id ("osm:node/123", "name:retail:kaufland", "manual:…")
//                → { id, name, brand, kind, domain, lat, lon, address, source,
//                    firstSeen, lastSeen, visits }
//   scans        auto id → { at, domain, store, placeId, place, geo, bottles, prefs, topLabels, thumbs }
//
// v1 → v2 upgrade keeps all existing data; old rows without a domain count as retail.

const DB_NAME = 'oeno';
const VERSION = 2;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const t = req.transaction;
      if (!db.objectStoreNames.contains('wines')) db.createObjectStore('wines', { keyPath: 'key' });
      const obs = db.objectStoreNames.contains('observations')
        ? t.objectStore('observations')
        : db.createObjectStore('observations', { keyPath: 'id', autoIncrement: true });
      if (!obs.indexNames.contains('key')) obs.createIndex('key', 'key');
      if (!obs.indexNames.contains('placeId')) obs.createIndex('placeId', 'placeId');
      if (!obs.indexNames.contains('scanId')) obs.createIndex('scanId', 'scanId');
      if (!db.objectStoreNames.contains('scans')) db.createObjectStore('scans', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('places')) db.createObjectStore('places', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab/app instance upgrading: close so it can proceed.
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other Oeno windows to finish the update'));
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = Array.isArray(store) ? store.map((n) => t.objectStore(n)) : t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/* ---------------------------------------------------------------- wines */

export async function getWine(key) {
  return tx('wines', 'readonly', (s) => reqP(s.get(key)));
}

export async function putWine(key, info, label, extra = {}) {
  return tx('wines', 'readwrite', (s) => reqP(s.put({ key, info, label, fetchedAt: Date.now(), ...extra })));
}

export async function deleteWine(key) {
  return tx('wines', 'readwrite', (s) => reqP(s.delete(key)));
}

export async function allWines() {
  const list = await tx('wines', 'readonly', (s) => reqP(s.getAll()));
  return list.map((w) => ({
    ...w,
    domain: w.domain || (w.key.startsWith('horeca|') ? 'horeca' : 'retail'),
    wineKey: w.wineKey || w.key.replace(/^horeca\|/, ''),
  }));
}

/* ---------------------------------------------------------------- observations */

export async function addObservations(list) {
  const at = Date.now();
  return tx('observations', 'readwrite', (s) => { for (const o of list) s.add({ ...o, at }); });
}

export async function observationsFor(wineKey) {
  const list = await tx('observations', 'readonly', (s) => reqP(s.index('key').getAll(wineKey)));
  return list.map((o) => ({ ...o, domain: o.domain || 'retail' })).sort((a, b) => b.at - a.at);
}

export async function observationsAtPlace(placeId) {
  const list = await tx('observations', 'readonly', (s) => reqP(s.index('placeId').getAll(placeId)));
  return list.sort((a, b) => b.at - a.at);
}

/** Move a saved scan (and the prices recorded with it) to another place. */
export async function reassignScanPlace(scanId, place) {
  const placeId = place?.id ?? null, placeName = place?.name ?? null;
  await tx(['scans', 'observations'], 'readwrite', async ([scans, obs]) => {
    const scan = await reqP(scans.get(scanId));
    if (scan) scans.put({ ...scan, placeId, place: place ? snapshot(place) : null, store: placeName || scan.store });
    const rows = await reqP(obs.index('scanId').getAll(scanId));
    for (const o of rows) obs.put({ ...o, placeId, placeName });
  });
}

/* ---------------------------------------------------------------- places */

export const snapshot = (p) => ({ id: p.id, name: p.name, brand: p.brand || null, kind: p.kind || null, address: p.address || null, domain: p.domain });

export async function getPlace(id) {
  return tx('places', 'readonly', (s) => reqP(s.get(id)));
}

export async function allPlaces() {
  const list = await tx('places', 'readonly', (s) => reqP(s.getAll()));
  return list.sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Insert or update a place; countVisit adds one visit (once per scan). */
export async function upsertPlace(p, { countVisit = false } = {}) {
  return tx('places', 'readwrite', async (s) => {
    const old = await reqP(s.get(p.id));
    const now = Date.now();
    const merged = {
      ...old,
      ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null)),
      firstSeen: old?.firstSeen || now,
      lastSeen: now,
      visits: (old?.visits || 0) + (countVisit ? 1 : 0),
    };
    // Keep the first good coordinates unless the new fix is more accurate.
    if (old?.lat != null && p.lat != null && (old.accuracy ?? 9999) < (p.accuracy ?? 9999)) {
      merged.lat = old.lat; merged.lon = old.lon; merged.accuracy = old.accuracy;
    }
    s.put(merged);
    return merged;
  });
}

export async function deletePlace(id) {
  return tx('places', 'readwrite', (s) => reqP(s.delete(id)));
}

/* ---------------------------------------------------------------- scans */

export async function addScan(scan) {
  return tx('scans', 'readwrite', (s) => reqP(s.add({ ...scan, at: Date.now() })));
}

export async function allScans() {
  const list = await tx('scans', 'readonly', (s) => reqP(s.getAll()));
  return list.map((x) => ({ ...x, domain: x.domain || 'retail' })).sort((a, b) => b.at - a.at);
}

/* ---------------------------------------------------------------- maintenance */

export async function counts() {
  const c = (name) => tx(name, 'readonly', (st) => reqP(st.count()));
  const [wines, scans, places] = await Promise.all([c('wines'), c('scans'), c('places')]);
  return { wines, scans, places };
}

const ALL = ['wines', 'observations', 'scans', 'places'];

export async function clearAll() {
  for (const name of ALL) await tx(name, 'readwrite', (s) => reqP(s.clear()));
}

export async function exportAll() {
  const [wines, observations, scans, places] = await Promise.all(ALL.map((n) => tx(n, 'readonly', (s) => reqP(s.getAll()))));
  return {
    version: VERSION, exportedAt: new Date().toISOString(),
    wines, observations, places, scans: scans.map(({ thumb, thumbs, ...r }) => r),
  };
}

export async function importAll(data) {
  if (!data || !Array.isArray(data.wines)) throw new Error('Not an Oeno backup file');
  await tx('wines', 'readwrite', (s) => { for (const w of data.wines) s.put(w); });
  if (Array.isArray(data.places)) await tx('places', 'readwrite', (s) => { for (const p of data.places) s.put(p); });
  if (Array.isArray(data.observations)) {
    await tx('observations', 'readwrite', (s) => { for (const { id, ...o } of data.observations) s.add(o); });
  }
  return data.wines.length;
}

/** Ask the browser not to evict our data (iOS honours this for installed PWAs). */
export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
