// The static universe document (gate map, NPC stations, ores, skill IDs) is about 1 MB and changes only with CCP's
// static data, so this browser keeps the last version in IndexedDB and the backend is asked only for a new version.
// Every step is optional: without IndexedDB (private windows, old Safari) the document is simply fetched again.
const NAME = 'eve-universe', STORE = 'docs', KEY = 'universe';
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result); r.onerror = r.onblocked = () => reject(r.error);
    setTimeout(() => reject(new Error('IndexedDB did not open')), 3000);
  });
}
async function use(mode, work) {
  const db = await open();
  try { return await new Promise((resolve, reject) => { const t = db.transaction(STORE, mode), result = work(t.objectStore(STORE)); t.oncomplete = () => resolve(result.result); t.onerror = t.onabort = () => reject(t.error); }); }
  finally { db.close(); }
}
export async function cachedUniverse(version) {
  try { const doc = await use('readonly', store => store.get(KEY)); return doc?.version === version ? doc : null; } catch { return null; }
}
export async function keepUniverse(doc) {
  try { await use('readwrite', store => store.put(doc, KEY)); } catch { /* Fetched again next time. */ }
}
