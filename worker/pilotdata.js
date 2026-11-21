// What a sync keeps of the endpoints added for orders, contracts, losses, blueprints, planets and standings. Everything is
// cut down to the fields the app reads and capped, because the snapshot is one D1 row that the browser downloads whole.
// Pure except for the `get` callbacks the killmail and planet steps are handed.

const num = v => Number.isFinite(v) ? v : undefined;
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined && o[k] !== null).map(k => [k, o[k]]));

export const MAX_ORDERS = 100, MAX_HISTORY = 60, MAX_CONTRACTS = 100, MAX_LOSSES = 25, NEW_LOSSES = 10, MAX_BLUEPRINTS = 400, MAX_PLANETS = 12, MAX_STANDINGS = 120, MAX_FIT = 150, MAX_STACKS = 300;

export const compactOrders = list => list.slice(0, MAX_ORDERS).map(o => pick(o, ['order_id', 'type_id', 'location_id', 'region_id', 'is_buy_order', 'price', 'volume_remain', 'volume_total', 'issued', 'duration', 'range', 'escrow']));
// An order's history entry: kept when it was issued or ran out in the last 30 days, newest first.
export function compactHistory(list, now = Date.now()) {
  const since = now - 30 * 86400000;
  return list.filter(o => { const issued = Date.parse(o.issued), end = issued + o.duration * 86400000; return issued >= since || (end >= since && end <= now); })
    .sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued)).slice(0, MAX_HISTORY)
    .map(o => pick(o, ['order_id', 'type_id', 'location_id', 'region_id', 'is_buy_order', 'price', 'volume_remain', 'volume_total', 'issued', 'duration', 'state']));
}
const ACTIVE = new Set(['outstanding', 'in_progress']);
// Open contracts first (all of them, up to the cap), then the newest others; deleted ones are gone.
export function compactContracts(list) {
  const rows = list.filter(c => c.status !== 'deleted').map(c => ({...pick(c, ['contract_id', 'type', 'status', 'availability', 'issuer_id', 'assignee_id', 'acceptor_id', 'date_issued', 'date_expired', 'date_accepted', 'date_completed', 'price', 'reward', 'collateral', 'volume', 'days_to_complete', 'start_location_id', 'end_location_id', 'for_corporation']), ...(c.title ? {title:String(c.title).slice(0, 60)} : {})}));
  const open = rows.filter(c => ACTIVE.has(c.status)), rest = rows.filter(c => !ACTIVE.has(c.status)).sort((a, b) => Date.parse(b.date_issued) - Date.parse(a.date_issued));
  return [...open, ...rest].slice(0, MAX_CONTRACTS);
}
// One row per blueprint type: [type, originals, copies, ME, TE, runs left across copies, location?]. quantity -1 is an original, -2 a copy.
// ME, TE and the location are those of the blueprint the pilot would build with: the best original, else the best copy
// (an original has unlimited runs, and a copy's ME says nothing about it). The location is the item's location_id.
export function compactBlueprints(list) {
  const by = new Map(), better = (a, b) => !a || (b.material_efficiency || 0) > (a.material_efficiency || 0) || ((b.material_efficiency || 0) === (a.material_efficiency || 0) && (b.time_efficiency || 0) > (a.time_efficiency || 0));
  for (const b of list) {
    const e = by.get(b.type_id) || {id: b.type_id, orig: 0, copies: 0, runs: 0}, copy = b.quantity === -2 || (b.runs > 0 && b.quantity !== -1);
    if (copy) { e.copies++; e.runs += Math.max(0, b.runs || 0); if (better(e.bestCopy, b)) e.bestCopy = b; } else { e.orig += Math.max(1, b.quantity || 1); if (better(e.bestOrig, b)) e.bestOrig = b; }
    by.set(b.type_id, e);
  }
  const types = [...by.values()].slice(0, MAX_BLUEPRINTS).map(e => { const b = e.bestOrig || e.bestCopy;
    return [e.id, e.orig, e.copies, b.material_efficiency || 0, b.time_efficiency || 0, e.runs, ...(Number.isSafeInteger(b.location_id) ? [b.location_id] : [])]; });
  return {count: list.length, types};
}
export const compactStandings = list => list.filter(s => Number.isFinite(s.standing)).sort((a, b) => Math.abs(b.standing) - Math.abs(a.standing)).slice(0, MAX_STANDINGS).map(s => [s.from_id, s.from_type, Math.round(s.standing * 100) / 100]);

/**
 * The ship's own items from the asset pages as [type, flag, quantity] rows (the Worker never keeps the full list).
 * Only items directly inside the ship count; a charge loaded in a module has the module's flag.
 */
export function fitCollector(shipItemId) {
  const items = [];
  return {add: rows => { if (!Number.isSafeInteger(shipItemId)) return; for (const a of rows) if (a.location_id === shipItemId && a.location_flag && items.length < MAX_FIT) items.push([a.type_id, a.location_flag, a.quantity || 1]); },
    result: () => Number.isSafeInteger(shipItemId) ? {ship: shipItemId, items} : undefined};
}

/**
 * The sellable item stacks in the item hangar (location_flag 'Hangar') of each wanted station, as {station: [[type, quantity]]},
 * biggest first, at most MAX_STACKS types per station. Every wanted station gets a row list, empty or not, so a later sync can tell
 * "nothing there" from "never read". Singletons (assembled ships, containers, fitted or assembled gear) are left out: only
 * packaged stacks can be listed as lots, and a blueprint copy cannot be sold. Cargo is already in the fit, so it is not repeated.
 */
export function stackCollector(stations) {
  const want = new Set([...stations].filter(Number.isSafeInteger)), by = new Map([...want].map(s => [s, new Map()]));
  return {add: rows => { for (const a of rows) { const at = by.get(a.location_id); if (at && a.location_flag === 'Hangar' && !a.is_singleton && !a.is_blueprint_copy && a.quantity > 0) at.set(a.type_id, (at.get(a.type_id) || 0) + a.quantity); } },
    result: () => Object.fromEntries([...by].map(([s, m]) => [s, [...m].sort((a, b) => b[1] - a[1]).slice(0, MAX_STACKS)]))};
}
/** Whether stored stacks already cover every wanted station (the docked one and the chosen pickup), so unchanged assets can stand. */
export const stacksCover = (stored, stations) => [...stations].filter(Number.isSafeInteger).every(s => Array.isArray(stored?.[s]));
/** A station or structure id a pilot may name as pickup: NPC stations 60,000,000 to 64,000,000, player structures above 1e12. */
export const isStationId = n => Number.isSafeInteger(n) && ((n >= 60000000 && n <= 64000000) || n > 1e12);

// ── Losses ──
export function summarizeKill(k) {
  const final = (k.attackers || []).find(a => a.final_blow) || {};
  return {id: k.killmail_id, hash: k.killmail_hash, time: k.killmail_time, ship: k.victim?.ship_type_id, system: k.solar_system_id, attackers: (k.attackers || []).length,
    ...(final.corporation_id ? {corp: final.corporation_id} : {}), ...(num(k.victim?.damage_taken) !== undefined ? {damage: k.victim.damage_taken} : {})};
}
/**
 * list: ESI's recent killmail references, or undefined when they did not change. The newest 10 not yet looked at are read
 * (public, cached forever by ESI, so each is read once); `wait` is what is left when the budget ran out. A kill the pilot
 * got is remembered by id (`seen`) so it is not read again.
 */
export async function stepKillmails(list, old, {id, get, room}) {
  const losses = [...(old?.losses || [])], seen = [...(old?.seen || [])], known = new Set([...losses.map(l => l.id), ...seen]);
  let wait = list ? list.slice(0, NEW_LOSSES).filter(k => !known.has(k.killmail_id)).map(k => [k.killmail_id, k.killmail_hash]) : [...(old?.wait || [])];
  const done = new Set();
  for (const [kid, hash] of wait) {
    if (room() < 1) break;
    let k;
    try { k = await get(kid, hash); } catch { wait = [...wait.filter(w => w[0] !== kid), [kid, hash]]; break; }
    done.add(kid);
    if (k?.victim?.character_id === id) losses.push(summarizeKill({...k, killmail_id: kid, killmail_hash: hash})); else seen.push(kid);
  }
  losses.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  return {losses: losses.slice(0, MAX_LOSSES), seen: seen.slice(-60), wait: wait.filter(w => !done.has(w[0]))};
}

// ── Planets ──
// Base hold of the pins that store goods (m3): storage facilities 12,000, launchpads 10,000, command centres 500. The pin data gives no capacity.
const hold = new Map([...[2257, 2535, 2536, 2541, 2558, 2560, 2561, 2562].map(t => [t, 12000]), ...[2256, 2542, 2543, 2544, 2552, 2555, 2556, 2557].map(t => [t, 10000]),
  ...[2129, 2130, 2131, 2132, 2133, 2134, 2135, 2136, 2137, 2138, 2139, 2140, 2141, 2142, 2143, 2144, 2145, 2146, 2147, 2148, 2149, 2150, 2151, 2152, 2153, 2154, 2155, 2156, 2157, 2158, 2159, 2160, 2254, 2524, 2525, 2533, 2534, 2549, 2550, 2551, 2574, 2576, 2577, 2578, 2581, 2582, 2585, 2586].map(t => [t, 500])]);
// Pins reduced to what a planner needs: extractors [product, expiry, heads, quantity per cycle, cycle seconds] (the last two when known),
// factories (schematic), goods held in storage pins with their combined hold, and everything stored.
export function summarizePins(planet) {
  const ext = [], fac = [], store = new Map(), vault = new Map();
  let cap = 0;
  for (const pin of planet.pins || []) {
    const x = pin.extractor_details;
    if (x) ext.push([x.product_type_id, pin.expiry_time || null, x.heads?.length || 0, ...(num(x.qty_per_cycle) !== undefined && num(x.cycle_time) > 0 ? [x.qty_per_cycle, x.cycle_time] : [])]);
    else if (pin.factory_details) fac.push(pin.factory_details.schematic_id);
    const room = hold.get(pin.type_id);
    if (room) cap += room;
    for (const c of pin.contents || []) { store.set(c.type_id, (store.get(c.type_id) || 0) + (c.amount || 0)); if (room) vault.set(c.type_id, (vault.get(c.type_id) || 0) + (c.amount || 0)); }
  }
  return {ext: ext.slice(0, 20), fac: fac.slice(0, 20), store: [...store].slice(0, 20), links: Array.isArray(planet.links) ? planet.links.length : 0, ...(cap ? {cap, vault: [...vault].slice(0, 20)} : {})};
}
export const PIN_REFRESH = 45 * 60000;
/** list: ESI's planet list, or undefined when it did not change. Pins are read for the planets whose summary is oldest, while the budget allows. */
export async function stepPlanets(list, old, {get, room, now = Date.now()}) {
  const prior = new Map((old?.planets || []).map(p => [p.id, p]));
  const planets = list ? list.slice(0, MAX_PLANETS).map(p => ({...(prior.get(p.planet_id) || {}), id: p.planet_id, type: p.planet_type, system: p.solar_system_id, level: p.upgrade_level, num: p.num_pins, updated: p.last_update})) : [...prior.values()];
  const due = planets.filter(p => !p.pins || now - (p.pinsAt || 0) > PIN_REFRESH).sort((a, b) => (a.pinsAt || 0) - (b.pinsAt || 0));
  for (const p of due) {
    if (room() < 1) break;
    try { p.pins = summarizePins(await get(p.id)); p.pinsAt = now; } catch { break; }
  }
  return {planets, pending: planets.some(p => !p.pins)};
}

// ── Events: what changed between two syncs (no ESI calls), kept three days for the alert pass ──
const DAY = 86400000;
const DONE = new Set(['finished', 'finished_issuer', 'finished_contractor']);
// An order that left the live list waits in `pending` (with when it vanished) until the order history lists it, because ESI
// caches orders/history/ for an hour: reading the history only on the run the order vanished would lose a fill or label it an
// expiry. Waiting costs no request (the history is read on its own schedule), where ignoring its cache would cost one per
// pending order run. Cancelled ones are dropped, and so is anything still unexplained after a day.
export const PENDING_ORDER_TTL = DAY;
export function trackOrders(prior, next, now = Date.now()) {
  const oldOrders = prior?.operations?.orders?.value, newOrders = next.operations?.orders?.value, held = prior?.pendingOrders || [];
  if (!Array.isArray(oldOrders) || !Array.isArray(newOrders)) return {events: [], pending: held};
  const live = new Set(newOrders.map(o => o.order_id)), history = new Map((next.operations?.orderHistory?.value || []).map(h => [h.order_id, h]));
  const waiting = new Map(held.map(o => [o.order_id, o]));
  for (const o of oldOrders) if (!live.has(o.order_id) && !waiting.has(o.order_id)) waiting.set(o.order_id, {order_id: o.order_id, type_id: o.type_id, is_buy_order: Boolean(o.is_buy_order), vanishedAt: now});
  const events = [], pending = [];
  for (const o of waiting.values()) {
    if (live.has(o.order_id)) continue;
    const h = history.get(o.order_id);
    if (h) { if (h.state !== 'cancelled') events.push({k: `order-end:${o.order_id}`, kind: h.volume_remain === 0 ? 'order-filled' : 'order-expired', type: o.type_id, buy: Boolean(o.is_buy_order), at: now}); }
    else if (now - o.vanishedAt < PENDING_ORDER_TTL) pending.push(o);
  }
  return {events, pending};
}
export function diffEvents(prior, next, now = Date.now()) {
  const ops = prior?.operations || {}, cur = next.operations || {}, out = trackOrders(prior, next, now).events;
  const oldContracts = ops.contracts?.value, newContracts = cur.contracts?.value;
  if (Array.isArray(oldContracts) && Array.isArray(newContracts)) {
    const before = new Map(oldContracts.map(c => [c.contract_id, c.status]));
    for (const c of newContracts) {
      const was = before.get(c.contract_id);
      if (was === undefined || was === c.status) continue;
      if (c.status === 'in_progress') out.push({k: `contract:${c.contract_id}:accepted`, kind: 'contract-accepted', contract: c.type, at: now});
      else if (DONE.has(c.status)) out.push({k: `contract:${c.contract_id}:completed`, kind: 'contract-completed', contract: c.type, at: now});
    }
  }
  const oldLosses = ops.killmails?.value?.losses, newLosses = cur.killmails?.value?.losses;
  if (Array.isArray(oldLosses) && Array.isArray(newLosses)) {
    const had = new Set(oldLosses.map(l => l.id));
    for (const l of newLosses) if (!had.has(l.id)) out.push({k: `loss:${l.id}`, kind: 'loss', type: l.ship, at: now});
  }
  const keep = (prior?.events || []).filter(e => now - e.at < 3 * DAY && !out.some(n => n.k === e.k));
  return [...keep, ...out].slice(-30);
}
