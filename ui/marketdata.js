// The hourly pipeline's market snapshot, live prices and industry cost indices, loaded once per refresh.
import {book} from '../market.js';
import {S} from './state.js';
import {esi, loadPrices} from './esi.js';

export async function loadMarket() {
  if (!S.marketData) { S.marketData = await S.backend.market(); S.marketBook = book(S.marketData.regions); }
  await loadPrices();
  if (!S.costIndices) {
    try { S.costIndices = new Map((await esi('industry/systems/')).map(row => [row.solar_system_id, Object.fromEntries(row.cost_indices.map(c => [c.activity, c.cost_index]))])); }
    catch { S.costIndices = new Map(); }
  }
}
