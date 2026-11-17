// The hourly pipeline's market snapshot, live prices and industry cost indices, loaded once per refresh.
import {book} from '../market.js';
import {S} from './state.js';
import {esi, loadPrices} from './esi.js';
import {cachedUniverse, keepUniverse} from './universecache.js';

// The snapshot names the version of the static universe document it goes with; that document comes from this page's
// memory, then IndexedDB, then the backend. Merged back in, every screen sees the shape the backend used to send whole:
// data.universe is the gate map, and meta.data carries the ores, combat types and skill IDs.
let universe = null;
async function withUniverse(data) {
  const version = data.universeVersion;
  if (data.universe || !version) return data; // an older backend sends the map inline
  if (universe?.version !== version) universe = await cachedUniverse(version) || await S.backend.universe(version).then(doc => { keepUniverse(doc); return doc; });
  data.universe = universe.universe;
  if (data.meta?.data) data.meta.data = {...universe.meta, ...data.meta.data};
  return data;
}
// Callers that arrive while a fetch is in flight share its task, so a cold start fetches each source once.
// Refresh clears the data and the tasks; a fetch that lands after that is discarded. A failed fetch is retried next call.
export async function loadMarket() {
  if (!S.marketData) {
    const task = S.marketTask ||= S.backend.market().then(withUniverse).then(data => {
      if (S.marketTask !== task) return loadMarket();
      S.marketData = data; S.marketBook = book(data.regions);
    }, error => { if (S.marketTask === task) S.marketTask = null; throw error; });
    await task;
  }
  await loadPrices();
  if (!S.costIndices) {
    const task = S.costTask ||= esi('industry/systems/').then(rows => {
      if (S.costTask === task) S.costIndices = new Map(rows.map(row => [row.solar_system_id, Object.fromEntries(row.cost_indices.map(c => [c.activity, c.cost_index]))]));
    }, () => { if (S.costTask === task) S.costIndices = new Map(); });
    await task;
  }
}
