// Plan → Trade for the Android app: the web's market tab (ui/screens/earn.js renderMarket) without the HTML. Three lists
// from the scanned order book: hauls (buy here, sell there), station spreads (bid and relist) and one-run manufacturing
// margins, sized to the pilot's cargo and budget, with broker fees by hub (standings) and the jumps from the start.
import {levelOf} from '../../../model.js';
import {fees, hauls, stationTrades, manufacturing} from '../../../market.js';
import {isAlpha} from '../../../industry.js';
import {leg} from '../../../route.js';
import {feeBook, brokerFee} from '../../../standings.js';
import {esiLists} from './build.js';
import {checkOrder, daysLeft, outcome, historySummary} from '../../../orders.js';

const HUBS = [[30000142, 'Jita'], [30002187, 'Amarr'], [30002659, 'Dodixie'], [30002510, 'Rens'], [30002053, 'Hek']];
const isNpcStation = id => id >= 60000000 && id < 64000000;

export const api = ({graph, meta, book, regions}) => ({
  /**
   * The pilot's market orders (ui/ordersview.js): live ones checked against the market scan (best, or outbid by how much,
   * at the station or elsewhere in the region) and the last 30 days of history. orders/history: ESI rows as the Worker keeps them.
   */
  'orders.view': ({orders = [], history = null, now = Date.now()}) => {
    const b = book(), types = meta().types || {};
    const place = loc => b.stations.get(loc)?.name ?? null;
    return {
      live:orders.map(o => ({...checkOrder(o, regions()), order:o.order_id, type:o.type_id, name:types[o.type_id]?.n ?? null, buy:Boolean(o.is_buy_order), price:o.price,
        remain:o.volume_remain, total:o.volume_total, loc:o.location_id, place:place(o.location_id), daysLeft:daysLeft(o, now)})),
      history:Array.isArray(history) ? {summary:historySummary(history, now), rows:history.slice(0, 20).map(o => ({type:o.type_id, name:types[o.type_id]?.n ?? null, buy:Boolean(o.is_buy_order),
        price:o.price, traded:o.volume_total - o.volume_remain, total:o.volume_total, issued:o.issued, outcome:outcome(o)}))} : null,
    };
  },
  /**
   * {from, maxJumps, cargo, budget?, me:{skills, standings}, owners:{loc:[corp, faction]}}
   * → {ready, hauls, spreads, builds, tooDear, index, fees, brokers, needOwners, regions, items}
   */
  'trade.plan': ({from, maxJumps = 5, cargo = 5000, budget = null, me = {}, owners = {}}) => {
    const g = graph(), m = meta(), b = book(), {adjusted, costIndices} = esiLists();
    if (!b.items.size) return {ready:false};
    const types = m.types || {}, skills = me.skills;
    const ownerOf = loc => { const o = owners[loc]; return o ? {corp:o[0], faction:o[1] || undefined} : undefined; };
    const standings = Array.isArray(me.standings) ? me.standings : undefined;
    const broker = feeBook({level:levelOf(skills, m.skills?.brokerRelations), standings, owner:ownerOf});
    const f = {...fees(skills, m.skills), brokerAt:broker.at};
    const hold = Math.max(1, cargo || 5000), cap = budget === null || budget === undefined ? Infinity : Math.max(0, budget);
    const cache = new Map(), sys = loc => b.stations.get(loc)?.system, station = loc => b.stations.get(loc)?.name || `Station ${loc}`;
    const jumps = (a, c) => a && c && g.systems.has(a) && g.systems.has(c) ? leg(g, a, c, cache)?.jumps ?? null : null;
    const near = j => j !== null && j <= maxJumps;
    const item = id => types[id]?.n || null, sysName = id => g.systems.get(id)?.name || null;
    const place = loc => ({loc, station:station(loc), system:sys(loc) ?? null, systemName:sysName(sys(loc))});
    const index = costIndices.get(from)?.manufacturing || 0;
    const haulRows = hauls(b, {salesTax:f.salesTax, cargo:hold, volumeOf:id => types[id]?.v, budget:cap, limit:40})
      .map(h => ({...h, toA:jumps(from, sys(h.from.loc)), ab:jumps(sys(h.from.loc), sys(h.to.loc))}))
      .filter(h => near(h.toA) && h.ab !== null).map(h => ({...h, perJump:h.profit / Math.max(1, h.toA + h.ab)})).sort((a, c) => c.perJump - a.perJump).slice(0, 12);
    const tradeRows = stationTrades(b, {...f, budget:cap, limit:60}).map(t => ({...t, j:jumps(from, sys(t.loc))})).filter(t => near(t.j)).slice(0, 12);
    const allBuilds = manufacturing(b, m.recipes, {...f, adjusted, costIndex:index, alpha:isAlpha(skills)});
    const buildRows = allBuilds.filter(x => x.capital <= cap).slice(0, 12).map(x => ({...x, j:jumps(from, sys(x.loc))}));
    const hubLocs = HUBS.map(([id, hub]) => ({hub, loc:[...b.stations].find(([, st]) => st.system === id)?.[0]})).filter(h => h.loc !== undefined);
    const shown = [...haulRows.map(h => h.to.loc), ...tradeRows.map(t => t.loc), ...buildRows.map(x => x.loc)];
    return {
      ready:true,
      hauls:haulRows.map(h => ({type:h.type, name:item(h.type), from:{...place(h.from.loc), price:h.from.price}, to:{...place(h.to.loc), price:h.to.price},
        units:h.units, m3:h.m3, invest:h.invest, profit:h.profit, perJump:h.perJump, toA:h.toA, ab:h.ab, whole:h.invest >= cap * 0.95})),
      spreads:tradeRows.map(t => ({type:t.type, name:item(t.type), at:place(t.loc), buy:t.buy, sell:t.sell, margin:t.margin, volume:t.volume, capital:t.capital, daily:t.daily, jumps:t.j})),
      builds:buildRows.map(x => ({type:x.type, name:item(x.type), at:place(x.loc), materials:x.materials, job:x.job, revenue:x.revenue, profit:x.profit, margin:x.margin, daily:x.daily, jumps:x.j})),
      tooDear:allBuilds.filter(x => x.profit > 0 && x.capital > cap).length,
      index, recipesError:m.recipesError ?? null,
      fees:{salesTax:f.salesTax, brokerFee:brokerFee(levelOf(skills, m.skills?.brokerRelations)), known:Boolean(skills?.skills), brokerLevel:levelOf(skills, m.skills?.brokerRelations), cargo:hold, budget:Number.isFinite(cap) ? cap : null},
      brokers:hubLocs.map(h => { const x = broker.explain(h.loc); return {hub:h.hub, fee:x.fee, applied:x.applied, faction:x.faction ?? null, corp:x.corp ?? null}; }),
      needOwners:standings ? [...new Set([...hubLocs.map(h => h.loc), ...shown])].filter(loc => isNpcStation(loc) && !owners[loc]) : [],
      regions:b.regions ?? null, items:Object.keys(types).length,
    };
  },
});
