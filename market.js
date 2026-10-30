// Ranks trade opportunities from the pipeline's market snapshot. Pure functions: the UI adds routes.
export const SCC_AND_FACILITY = 0.0425; // shortcut: 4% SCC surcharge + 0.25% NPC facility tax; structures with rigs differ.

export function fees(skills, ids = {}) {
  const level = id => skills?.skills?.find(s => s.skill_id === id)?.active_skill_level || 0;
  return {salesTax:0.075 * (1 - 0.11 * level(ids.accounting)), brokerFee:Math.max(0.01, 0.03 - 0.003 * level(ids.brokerRelations))};
}
// Merge every scanned region into one view per item: sells, buys and the station each sits in.
export function book(regions) {
  const items = new Map(), stations = new Map();
  for (const {data} of regions) {
    for (const [loc, [system, name]] of Object.entries(data.stations || {})) stations.set(Number(loc), {system, name, region:data.name});
    for (const [type, t] of Object.entries(data.types || {})) {
      const item = items.get(Number(type)) || {sells:[], buys:[], daily:0};
      item.sells.push(...t.s.map(([loc, price, volume]) => ({loc, price, volume})));
      item.buys.push(...t.b.map(([loc, price, volume]) => ({loc, price, volume})));
      item.daily += t.d || 0;
      items.set(Number(type), item);
    }
  }
  for (const item of items.values()) { item.sells.sort((a,b) => a.price - b.price); item.buys.sort((a,b) => b.price - a.price); }
  return {items, stations};
}
// Buy from a sell order in one station, haul, sell into a buy order elsewhere.
export function hauls(market, {salesTax, cargo, volumeOf, limit = 60}) {
  const out = [];
  for (const [type, item] of market.items) {
    const m3 = volumeOf(type);
    if (!(m3 > 0)) continue;
    let best = null;
    for (const from of item.sells) for (const to of item.buys) {
      if (from.loc === to.loc) continue;
      const unit = to.price * (1 - salesTax) - from.price;
      if (unit <= 0) continue;
      const units = Math.min(from.volume, to.volume, Math.floor(cargo / m3));
      if (units < 1) continue;
      const profit = unit * units;
      if (!best || profit > best.profit) best = {type, from, to, unit, units, profit, invest:from.price * units, m3:units * m3};
    }
    if (best) out.push(best);
  }
  return out.sort((a,b) => b.profit - a.profit).slice(0, limit);
}
// Station trading: buy order at the top bid, relist at the lowest ask, inside one station.
export function stationTrades(market, {salesTax, brokerFee, capture = 0.05, limit = 60}) {
  const out = [];
  for (const [type, item] of market.items) for (const sell of item.sells) {
    const buy = item.buys.find(b => b.loc === sell.loc);
    if (!buy || buy.price >= sell.price) continue;
    const unit = sell.price * (1 - salesTax - brokerFee) - buy.price * (1 + brokerFee);
    if (unit <= 0) continue;
    // shortcut: assumes we fill `capture` of the scanned regions' daily volume; real fills depend on competition.
    const daily = unit * Math.min(item.daily * capture, buy.volume, sell.volume);
    out.push({type, loc:sell.loc, buy:buy.price, sell:sell.price, unit, margin:unit / buy.price, volume:item.daily, daily});
  }
  return out.sort((a,b) => b.daily - a.daily).slice(0, limit);
}
// One manufacturing run at ME 0: materials bought at the cheapest scanned ask, product listed at the best ask.
export function manufacturing(market, recipes, {salesTax, brokerFee, adjusted, costIndex = 0}) {
  const cheapest = type => market.items.get(type)?.sells[0];
  const out = [];
  for (const [product, r] of Object.entries(recipes || {})) {
    const sell = cheapest(Number(product));
    if (!sell) continue;
    let materials = 0, eiv = 0, missing = false;
    for (const [type, qty] of r.m) {
      const ask = cheapest(type);
      if (!ask) { missing = true; break; }
      materials += ask.price * qty; eiv += (adjusted.get(type) || 0) * qty;
    }
    if (missing) continue;
    const job = eiv * (costIndex + SCC_AND_FACILITY);
    const revenue = sell.price * r.q * (1 - salesTax - brokerFee);
    const profit = revenue - materials - job;
    out.push({type:Number(product), materials, job, revenue, profit, margin:profit / (materials + job), loc:sell.loc, daily:market.items.get(Number(product)).daily});
  }
  return out.sort((a,b) => b.profit - a.profit);
}
