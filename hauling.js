// Hauling: risk per system from real kill data, risk-weighted routes through N waypoints, and the best stop order.
// Pure functions; the UI supplies the gate map, the pipeline's kill history and live zKillboard killmails.
import {paths, secClass} from './route.js';

// Hull classes: cargo limit (m³), how well each survives a gank (tank) or slips a gate camp (evade), seconds per jump.
export const HULLS = {
  br:{name:'Blockade runner', cargo:10000, tank:0.4, evade:0.15, jump:35, why:'Covert-ops cloak and fast align: hard to catch at a gate.'},
  t1:{name:'T1 industrial', cargo:40000, tank:1, evade:1, jump:55, why:'Cheap, but slow and paper-thin.'},
  dst:{name:'Deep space transport', cargo:62500, tank:0.5, evade:0.6, jump:60, why:'Heavy tank and a warp-core bonus.'},
  freighter:{name:'Freighter', cargo:1100000, tank:1.3, evade:1, jump:120, why:'Huge hold, very slow align: the classic gank target.'}
};
export function suggestHull(volume, value) {
  if (volume <= HULLS.br.cargo) return 'br';
  if (volume <= HULLS.t1.cargo && value < 300e6) return 't1';
  if (volume <= HULLS.dst.cargo) return 'dst';
  return 'freighter';
}

const isGate = id => id >= 50000000 && id < 60000000;
const PODS = new Set([670, 33328]);
// Summarise the last hour of zKillboard killmails per system: kills at each gate, smartbombs, interdictors, attackers.
export function campIntel(kills, {combat = {}, gateTo = new Map(), now = Date.now(), window = 3600} = {}) {
  const sb = new Set(combat.sb || []), dictor = new Set(combat.dictor || []), out = new Map();
  for (const k of kills || []) {
    if (k.zkb?.npc) continue;
    const time = Date.parse(k.killmail_time), age = (now - time) / 1000;
    if (!(age >= 0 && age <= window)) continue;
    const s = out.get(k.solar_system_id) || {kills:0, pods:0, gates:{}, gateKills:0, sb:0, dictor:0, last:0, ships:{}, value:0};
    s.kills++; s.value += k.zkb?.totalValue || 0; s.last = Math.max(s.last, time);
    if (PODS.has(k.victim?.ship_type_id)) s.pods++;
    if (isGate(k.zkb?.locationID)) {
      s.gateKills++;
      const to = gateTo.get(k.zkb.locationID) ?? '?', g = s.gates[to] ||= {n:0, last:0};
      g.n++; g.last = Math.max(g.last, time);
    }
    if (k.attackers?.some(a => sb.has(a.weapon_type_id))) s.sb++;
    if (k.attackers?.some(a => dictor.has(a.ship_type_id))) s.dictor++;
    for (const a of k.attackers || []) if (a.ship_type_id) s.ships[a.ship_type_id] = (s.ships[a.ship_type_id] || 0) + 1;
    out.set(k.solar_system_id, s);
  }
  return out;
}

// Chance of losing the ship while passing through one system.
// Background: ship kills per hour (decayed 24 h and 7 d) divided by ships passing per hour, floored by security,
// scaled by how attractive the cargo is (high-sec gankers pick fat targets; low-sec camps shoot anything) and the hull.
// Live camp: kills on the gates you use in the last hour, fading over ~20 minutes, worse with smartbombs or bubbles.
const FLOOR = {hi:0.0002, low:0.005, null:0.02};
export function systemRisk(system, {history = {}, traffic = {}, live = new Map(), value = 0, hull = 't1', via = [], now = Date.now()} = {}) {
  const sec = secClass(system.sec), h = HULLS[hull];
  const [d24 = 0, d168 = 0] = history[system.id] || [];
  const rate = 0.6 * d24 / 24 + 0.4 * d168 / 168, passing = Math.max(traffic[system.id] || 0, 30);
  const attract = sec === 'hi' ? Math.min(8, Math.max(0.05, (value / 1e8) ** 0.7)) : 1 + Math.min(value / 1e9, 2);
  const background = Math.min(0.9, Math.max(rate / passing, FLOOR[sec]) * attract * h.tank);
  const camp = live.get(system.id);
  let fresh = 0;
  if (camp) {
    const known = via.length && Object.keys(camp.gates).some(k => k !== '?');
    for (const [to, g] of Object.entries(camp.gates)) {
      if (known && to !== '?' && !via.includes(Number(to))) continue;
      fresh += g.n * Math.exp(-(now - g.last) / 1200000) * (known && to === '?' ? 0.5 : 1);
    }
  }
  const bubbles = camp?.dictor && sec !== 'hi';
  const evade = hull === 'br' && bubbles ? 0.6 : h.evade;
  const campRisk = fresh ? 1 - Math.exp(-0.35 * fresh * (camp.sb ? 1.5 : 1) * (bubbles ? 2 : 1) * evade) : 0;
  return {p:1 - (1 - background) * (1 - campRisk), background, camp:campRisk, rate, passing};
}

// Route modes: what a jump is worth against risk. Weight of entering a system = 1 + (value ÷ ISK per jump) × −ln(1 − p),
// so a route minimises jumps × time value + cargo value × −ln(survival).
export const MODES = {safest:{label:'Safest', perJump:2e4}, balanced:{label:'Balanced', perJump:1e6}, shortest:{label:'Shortest', perJump:Infinity}};
function weigher(g, ctx, {mode, lowsec, avoid, allow}) {
  const scale = (ctx.value + 1e6) / MODES[mode].perJump, memo = new Map();
  return id => {
    if (avoid.has(id) && !allow.has(id)) return Infinity;
    const system = g.systems.get(id);
    if (!lowsec && secClass(system.sec) !== 'hi' && !allow.has(id)) return Infinity;
    if (!memo.has(id)) memo.set(id, -Math.log(1 - Math.min(0.99, systemRisk(system, ctx).p)));
    return 1 + (Number.isFinite(scale) ? scale : 1e-6) * memo.get(id);
  };
}
// Visit order: the start stays first; the end is fixed, free, or a return to the start. Exact up to 8 stops, else nearest neighbour + 2-opt.
export function bestOrder(cost, {end = 'fixed'} = {}) {
  const n = cost.length;
  if (n <= 2) return [...Array(n).keys()];
  const last = end === 'fixed' ? n - 1 : null, middle = [...Array(n).keys()].slice(1).filter(i => i !== last);
  const total = order => { let t = 0; for (let i = 1; i < order.length; i++) t += cost[order[i - 1]][order[i]]; return t + (end === 'return' ? cost[order[order.length - 1]][0] : 0); };
  const wrap = mid => [0, ...mid, ...(last === null ? [] : [last])];
  if (middle.length <= 8) {
    let best = null, bestCost = Infinity;
    const permute = (rest, acc) => {
      if (!rest.length) { const o = wrap(acc), c = total(o); if (c < bestCost) { bestCost = c; best = o; } return; }
      for (let i = 0; i < rest.length; i++) permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
    };
    permute(middle, []);
    return best;
  }
  const mid = [], left = new Set(middle);
  let at = 0;
  while (left.size) { const next = [...left].reduce((a, b) => cost[at][b] < cost[at][a] ? b : a); mid.push(next); left.delete(next); at = next; }
  let order = wrap(mid), improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < order.length - 2; i++) for (let j = i + 1; j < order.length - (last === null ? 0 : 1); j++) {
      const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
      if (total(candidate) < total(order) - 1e-9) { order = candidate; improved = true; }
    }
  }
  return order;
}

// Plan a trip through waypoints (system IDs) in one mode. Returns every system passed with its risk and the totals.
export function plan(g, waypoints, ctx, {mode = 'balanced', lowsec = false, avoid = new Set(), optimize = false, end = 'fixed'} = {}) {
  const allow = new Set(waypoints), weight = weigher(g, ctx, {mode, lowsec, avoid, allow}), searches = new Map();
  const search = from => { if (!searches.has(from)) searches.set(from, paths(g, from, {weight})); return searches.get(from); };
  let order = waypoints.map((_, i) => i);
  if (optimize && waypoints.length > 2) {
    const cost = waypoints.map(a => waypoints.map(b => a === b ? 0 : search(a).cost(b) ?? 1e9));
    order = bestOrder(cost, {end});
  }
  const stops = order.map(i => waypoints[i]);
  if (end === 'return') stops.push(waypoints[0]);
  const route = [stops[0]], legs = [];
  for (let i = 1; i < stops.length; i++) {
    const list = search(stops[i - 1]).path(stops[i]);
    if (!list) return {stops, legs, unreachable:[stops[i - 1], stops[i]]};
    legs.push({from:stops[i - 1], to:stops[i], jumps:list.length - 1});
    route.push(...list.slice(1));
  }
  // Price each system with the gates actually used (arrival from the previous system, departure to the next).
  const steps = route.map((id, i) => {
    const system = g.systems.get(id), via = [route[i - 1], route[i + 1]].filter(x => x !== undefined && x !== id);
    return {system, stop:stops.includes(id), via, ...systemRisk(system, {...ctx, via})};
  });
  const survival = steps.reduce((t, s) => t * (1 - s.p), 1);
  const jumps = route.length - 1;
  return {mode, stops, legs, route, steps, jumps, survival, expectedLoss:(ctx.value + 0) * (1 - survival), minutes:jumps * HULLS[ctx.hull || 't1'].jump / 60,
    lowsec:steps.some(s => secClass(s.system.sec) !== 'hi')};
}
