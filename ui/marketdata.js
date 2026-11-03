// The hourly pipeline's market snapshot, live prices and industry cost indices, loaded once per refresh.
import {book} from '../market.js';
import {S} from './state.js';
import {esi, loadPrices} from './esi.js';

// Callers that arrive while a fetch is in flight share its task, so a cold start fetches each source once.
// Refresh clears the data and the tasks; a fetch that lands after that is discarded. A failed fetch is retried next call.
export async function loadMarket() {
  if (!S.marketData) {
    const task = S.marketTask ||= S.backend.market().then(data => {
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
