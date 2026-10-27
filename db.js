// Local wine database in IndexedDB (on the phone, persists between visits).
// Stores:
//   wines        key = wineKey      → { key, info, label, fetchedAt }
//   observations auto id            → { key, label, price, promo, store, at }  (shelf prices you saw)
//   scans        auto id            → { at, store, bottles, prefs, topKeys, cost, thumb }

const DB_NAME = 'oeno';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('wines')) db.createObjectStore('wines', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('observations')) {
        const s = db.createObjectStore('observations', { keyPath: 'id', autoIncrement: true });
        s.createIndex('key', 'key');
      }
      if (!db.objectStoreNames.contains('scans')) db.createObjectStore('scans', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getWine(key) {
  return tx('wines', 'readonly', (s) => reqP(s.get(key)));
}

export async function putWine(key, info, label) {
  return tx('wines', 'readwrite', (s) => reqP(s.put({ key, info, label, fetchedAt: Date.now() })));
}

export async function deleteWine(key) {
  return tx('wines', 'readwrite', (s) => reqP(s.delete(key)));
}

export async function allWines() {
  return tx('wines', 'readonly', (s) => reqP(s.getAll()));
}

export async function addObservation(o) {
  return tx('observations', 'readwrite', (s) => reqP(s.add({ ...o, at: Date.now() })));
}

export async function observationsFor(key) {
  return tx('observations', 'readonly', (s) => reqP(s.index('key').getAll(key)));
}

export async function addScan(scan) {
  return tx('scans', 'readwrite', (s) => reqP(s.add({ ...scan, at: Date.now() })));
}

export async function allScans() {
  const list = await tx('scans', 'readonly', (s) => reqP(s.getAll()));
  return list.sort((a, b) => b.at - a.at);
}

export async function counts() {
  const [w, s] = await Promise.all([
    tx('wines', 'readonly', (st) => reqP(st.count())),
    tx('scans', 'readonly', (st) => reqP(st.count())),
  ]);
  return { wines: w, scans: s };
}

export async function clearAll() {
  for (const name of ['wines', 'observations', 'scans']) {
    await tx(name, 'readwrite', (s) => reqP(s.clear()));
  }
}

export async function exportAll() {
  const [wines, observations, scans] = await Promise.all([
    tx('wines', 'readonly', (s) => reqP(s.getAll())),
    tx('observations', 'readonly', (s) => reqP(s.getAll())),
    tx('scans', 'readonly', (s) => reqP(s.getAll())),
  ]);
  return { version: VERSION, exportedAt: new Date().toISOString(), wines, observations, scans: scans.map(({ thumb, ...r }) => r) };
}

export async function importAll(data) {
  if (!data || !Array.isArray(data.wines)) throw new Error('Not an Oeno backup file');
  await tx('wines', 'readwrite', (s) => { for (const w of data.wines) s.put(w); });
  if (Array.isArray(data.observations)) {
    await tx('observations', 'readwrite', (s) => { for (const { id, ...o } of data.observations) s.add(o); });
  }
  return data.wines.length;
}

/** Ask the browser not to evict our data (iOS honours this for installed PWAs). */
export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
