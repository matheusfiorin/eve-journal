// Live buy-order books for the Sell plan: public ESI orders per (region, type), cached for 5 minutes, at most 6 calls at
// once and 150 per plan. The planner (sell.js) takes the quote shape these produce; this file only fetches and maps.
import {hops, systemIndex} from '../route.js';
import {esi, resolveNames} from './esi.js';
import {names} from './state.js';

export const TTL = 5 * 60000, CONCURRENCY = 6, CALL_CAP = 150, PAGE_ROWS = 1000, MAX_PAGES = 30;

// Regions worth asking about, in the order they matter (a cap drops the last first): where the ships and pickups are,
// then the trade hubs, then every region within maxJumps of a start. starts and hubs are system ids.
export function candidateRegions(g, {starts = [], hubs = [], maxJumps = 0} = {}) {
  const out = new Set(), add = id => { const r = g.systems.get(id)?.region; if (r) out.add(r); };
  starts.forEach(add); hubs.forEach(add);
  if (maxJumps > 0) {
    const index = systemIndex(g), ids = [...g.systems.keys()];
    for (const from of starts) { const d = hops(g, from, maxJumps); for (const id of ids) if (d[index.get(id)] >= 0) add(id); }
  }
  return [...out];
}
const rangeOf = r => /^\d+$/.test(String(r)) ? Number(r) : r;
// An ESI market order → the planner's quote.
export const toQuote = (o, region) => ({order:o.order_id, loc:o.location_id, system:o.system_id, region, price:o.price, volume:o.volume_remain, minVolume:o.min_volume ?? 1, range:rangeOf(o.range)});

// The real fetch: one page of a region's buy orders for a type. Expires and X-Pages are read when ESI lets the page see them.
export async function fetchOrders(region, type, page) {
  const {body, headers} = await esi(`markets/${region}/orders/?type_id=${type}&order_type=buy&page=${page}`, {meta:true});
  const pages = Number(headers.get('x-pages')), expires = Date.parse(headers.get('expires') || '');
  return {rows:Array.isArray(body) ? body : [], pages:pages > 0 ? pages : null, expires:Number.isFinite(expires) ? expires : null};
}

export function createQuotes({fetchPage = fetchOrders, now = Date.now, concurrency = CONCURRENCY, cap = CALL_CAP, ttl = TTL} = {}) {
  const cache = new Map(), flying = new Map(), waiting = [];
  let active = 0;
  const slot = async job => {
    if (active >= concurrency) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { return await job(); } finally { active--; waiting.shift()?.(); }
  };
  // One (region, type): every page, or what the budget allowed. Never cached when incomplete.
  async function book(region, type, budget) {
    const rows = []; let pages = null, expires = null, partial = false;
    for (let page = 1; pages === null || page <= pages; page++) {
      if (budget.calls >= cap) { budget.capped = true; partial = true; break; }
      if (page > MAX_PAGES) { partial = true; break; }
      budget.calls++;
      const r = await fetchPage(region, type, page);
      rows.push(...r.rows); pages ??= r.pages; expires ??= r.expires;
      if (r.pages === null) { if (r.rows.length < PAGE_ROWS) break; pages = Infinity; } // no X-Pages: a short page is the last
    }
    const at = now();
    return {quotes:rows.map(o => toQuote(o, region)), at, until:Math.min(expires ?? at + ttl, at + ttl), partial};
  }
  // regions: ordered, most relevant first; types: ids. Resolves to {quotes, at, calls, cached, capped, skipped, failed, partial}.
  async function load(types, regions, {signal} = {}) {
    const budget = {calls:0, capped:false}, out = new Map(types.map(t => [t, []])), result = {quotes:out, at:null, calls:0, cached:0, capped:false, skipped:0, failed:[], partial:0};
    let halted = false;
    const use = (entry, type) => { out.get(type).push(...entry.quotes); result.at = result.at === null ? entry.at : Math.min(result.at, entry.at); };
    const pairs = regions.flatMap(region => types.map(type => [region, type]));
    await Promise.all(pairs.map(([region, type]) => {
      const key = `${region}:${type}`, hit = cache.get(key);
      if (hit && hit.until > now()) { result.cached++; use(hit, type); return null; }
      let task = flying.get(key);
      if (!task) {
        // The budget is checked when the call is about to start, so a plan stops asking once it has spent its share.
        task = slot(async () => {
          if (halted || signal?.aborted) return null;
          if (budget.calls >= cap) { budget.capped = true; return null; }
          try { return await book(region, type, budget); } catch (error) { if (error.status === 420 || error.status === 429) halted = true; throw error; }
        }).then(entry => { if (entry && !entry.partial) cache.set(key, entry); return entry; }).finally(() => flying.delete(key));
        flying.set(key, task);
      }
      return task.then(entry => {
        if (!entry) { result.skipped++; return; }
        if (entry.partial) result.partial++;
        use(entry, type);
      }, error => { result.failed.push({region, type, status:error.status}); });
    }));
    Object.assign(result, {calls:budget.calls, capped:budget.capped});
    for (const list of out.values()) list.sort((a, b) => b.price - a.price || a.order - b.order);
    return result;
  }
  return {load, clear:() => cache.clear(), size:() => cache.size};
}
export const quotes = createQuotes();

// Names and sizes of item types, and a hull's cargo hold, from ESI's public type data (cached for the page's life).
const info = new Map(), asked = new Map();
// → Map type → {name, volume (packaged, else unpackaged), capacity}. A type ESI can't answer for is left out.
export async function typeInfo(ids, get = id => esi(`universe/types/${id}/`)) {
  const todo = [...new Set(ids)].filter(id => !info.has(id));
  await Promise.all(todo.map(id => {
    if (!asked.has(id)) asked.set(id, get(id).then(t => { info.set(id, {name:t.name, volume:t.packaged_volume ?? t.volume ?? 0, capacity:t.capacity ?? 0}); if (t.name) names.set(id, t.name); }, () => {}).finally(() => asked.delete(id)));
    return asked.get(id);
  }));
  await resolveNames(ids.filter(id => !names.has(id))).catch(() => {});
  return new Map(ids.filter(id => info.has(id)).map(id => [id, info.get(id)]));
}
export const resetTypeInfo = () => info.clear();
