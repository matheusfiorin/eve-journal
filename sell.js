// Sell planner: where to sell what the pilots carry (ship holds and station hangars) and each ship's route, for the most
// ISK after sales tax and expected gank loss, at a price per jump. Pure; ui/haulworker.js runs it off the page.
//
// How it works, in four steps:
// 1. Candidate stations: every station within maxJumps is priced by an upper bound (the whole cargo sold into the orders
//    it can fill, ignoring min volumes and the other ship). The ships' own stations and the pickups always count; the
//    rest alternate between the best bound net of the jumps to get there and the best bound outright.
// 2. Each ship alone: every set of up to maxStops candidates, with every pickup choice. Selling is order-independent
//    (each unit goes to the best order any stop on the trip can fill), so the book is worked once per set; the visiting
//    orders then only change jumps and gank loss, and are tried cheapest first until none can beat the best (branch
//    and bound on the jump cost, since loss is never negative).
// 3. Two ships: every pair from each ship's shortlist, in both orders, against one shared book and hangar, then each
//    ship's best reply to the other. More ships: each in turn replies to the ones before it. Together: one stop list
//    for the fleet. A ship never sees volume another already filled, or hangar units another already took.
// 4. The plans shown: selling where each ship stands, the best score, the most ISK, and up to three more points on the
//    jumps-against-ISK frontier.
import {paths, hops, systemIndex, secClass} from './route.js';
import {systemRisk} from './hauling.js';

export const SELL_DEFAULTS = {perJump:1e6, maxJumps:15, lowsec:false, together:false, returnHome:false, maxStops:3, candidates:8, hull:'destroyer', keep:20};
const MASK_BITS = 30; // candidate stops are the bits of one integer

// The market's range rule: can a sale made while docked at a station fill a buy order?
export function inRange(range, {sameStation = false, sameSystem = false, sameRegion = false, jumps = Infinity} = {}) {
  if (range === 'station') return sameStation;
  if (range === 'solarsystem') return sameSystem;
  if (range === 'region') return sameRegion;
  return typeof range === 'number' && (sameSystem || jumps <= range);
}
const rangeOf = r => typeof r === 'string' && /^\d+$/.test(r) ? Number(r) : r;
const perms = list => list.length <= 1 ? [list] : list.flatMap((x, i) => perms([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [x, ...p]));
// Visiting orders of a set of stops; a pickup station in the set goes first (nothing is sold before the pickup).
const orders = (items, firsts) => { const head = items.filter(c => firsts.includes(c)), tail = items.filter(c => !firsts.includes(c)); return perms(head).flatMap(a => perms(tail).map(b => [...a, ...b])); };

export function planSell({g, lots = [], ships = [], quotes = new Map(), stations = new Map(), salesTax = 0, risk = {}, options = {}}) {
  const o = {...SELL_DEFAULTS, ...options}, floorOf = o.floor instanceof Map ? o.floor : new Map(o.floor || []);
  const keep = 1 - salesTax, notes = [];
  const sysOf = loc => g.stations.get(loc)?.system ?? stations.get(loc)?.system;
  const regionOf = (sys, loc) => g.systems.get(sys)?.region ?? stations.get(loc)?.region;
  const riskCtx = {history:risk.history || {}, traffic:risk.traffic || {}, live:risk.live || new Map(), now:risk.now ?? Date.now(), hull:o.hull};

  // Item types numbered 0..T-1; units in each ship's hold and in each pickup station's hangar.
  const typeIds = [], tNo = new Map(), m3 = [];
  for (const lot of lots) if (!tNo.has(lot.type)) { tNo.set(lot.type, typeIds.length); typeIds.push(lot.type); m3.push(0); }
  const T = typeIds.length;
  for (const lot of lots) { const t = tNo.get(lot.type); if (!(m3[t] > 0) && lot.m3 > 0) m3[t] = lot.m3; }
  const shipNo = new Map(ships.map((s, i) => [s.pilot, i]));
  const home = ships.map(s => ({sys:s.system ?? sysOf(s.station), loc:s.station ?? null}));
  const own = ships.map(() => new Float64Array(T)), picks = [], pNo = new Map(), stock = [], stray = [];
  for (const lot of lots) {
    const t = tNo.get(lot.type), qty = lot.qty > 0 ? lot.qty : 0;
    if (lot.from?.kind === 'hangar') {
      const loc = lot.from.station;
      if (!pNo.has(loc)) { pNo.set(loc, picks.length); picks.push({loc, sys:sysOf(loc)}); stock.push(new Float64Array(T)); }
      stock[pNo.get(loc)][t] += qty;
    } else if (shipNo.has(lot.from?.pilot)) own[shipNo.get(lot.from.pilot)][t] += qty;
    else stray.push({type:lot.type, qty, reason:'no ship'});
  }
  const free = ships.map((s, i) => Math.max(0, (s.capacity || 0) - own[i].reduce((v, q, t) => v + q * m3[t], 0)));

  // The buy orders, best price first per type, without those under the caller's floor.
  const ord = [], byType = typeIds.map(() => []), top = new Float64Array(T), quoted = new Uint8Array(T), floored = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const min = floorOf.get(typeIds[t]) ?? 0;
    for (const q of quotes.get(typeIds[t]) || []) {
      if (!(q.price > 0 && q.volume > 0)) continue;
      quoted[t] = 1; top[t] = Math.max(top[t], q.price);
      if (q.price < min) continue;
      const sys = q.system ?? sysOf(q.loc);
      byType[t].push(ord.length);
      ord.push({t, id:q.order, loc:q.loc, sys, reg:regionOf(sys, q.loc) ?? q.region, price:q.price, net:q.price * keep, volume:q.volume, min:Math.max(1, q.minVolume || 1), range:rangeOf(q.range)});
    }
    if (!quoted[t]) notes.push({kind:'no-quotes', type:typeIds[t]});
    else if (!byType[t].length) { floored[t] = 1; notes.push({kind:'below-floor', type:typeIds[t], floor:min, best:top[t]}); }
    byType[t].sort((a, b) => ord[b].price - ord[a].price || a - b);
  }
  // What a unit still aboard is worth: what is at stake in a gank, and the unsold part of the sold share.
  const worth = new Float64Array(T).map((_, t) => Math.max(top[t], floorOf.get(typeIds[t]) ?? 0) * keep);

  // Routes. Without low-sec every jump costs 1 and low/null-sec is closed; with it, route.js's safer-route weights.
  const low = new Set();
  for (const s of g.systems.values()) if (secClass(s.sec) !== 'hi') low.add(s.id);
  const hiOnly = id => low.has(id) || !g.systems.has(id) ? Infinity : 1;
  const searches = new Map(), lists = new Map();
  const search = from => { let p = searches.get(from); if (!p) searches.set(from, p = o.lowsec ? paths(g, from, {safe:true}) : paths(g, from, {weight:hiOnly})); return p; };
  const path = (a, b) => { const k = `${a}:${b}`; if (!lists.has(k)) lists.set(k, a === b ? [a] : search(a).path(b)); return lists.get(k); };
  const jumps = (a, b) => { const p = path(a, b); return p ? p.length - 1 : Infinity; };
  const reach = (a, b) => { if (a === b) return 0; if (!o.lowsec) return search(a).cost(b) ?? Infinity; const p = search(a).path(b); return p ? p.length - 1 : Infinity; };

  // Range checks: jumps from an order's system counted by one bounded search per system, out to its widest range.
  const idx = systemIndex(g), far = new Map(), hopsFrom = new Map();
  for (const r of ord) if (typeof r.range === 'number') far.set(r.sys, Math.max(far.get(r.sys) ?? 0, r.range));
  const apart = (a, b) => {
    if (a === b) return 0;
    let h = hopsFrom.get(a);
    if (!h) hopsFrom.set(a, h = hops(g, a, far.get(a) ?? 0));
    const i = idx.get(b), d = i === undefined ? -1 : h[i];
    return d < 0 ? Infinity : d;
  };
  const fillsAt = (r, loc, sys, reg) => inRange(r.range, {sameStation:loc === r.loc, sameSystem:sys !== undefined && sys === r.sys, sameRegion:reg !== undefined && reg === r.reg, jumps:typeof r.range === 'number' ? apart(r.sys, sys) : Infinity});

  // 1. Candidate stations.
  const starts = [...new Set([...home.map(h => h.sys), ...picks.map(p => p.sys)].filter(x => x !== undefined))];
  const Q = new Float64Array(T);
  for (const a of [...own, ...stock]) a.forEach((q, t) => { Q[t] += q; });
  const bySys = new Map(), fixed = new Map();
  const addStation = (loc, sys) => { if (sys === undefined) return; let l = bySys.get(sys); if (!l) bySys.set(sys, l = new Set()); l.add(loc); };
  for (const h of home) if (h.loc != null && h.sys !== undefined) fixed.set(h.loc, h.sys);
  for (const p of picks) if (p.sys !== undefined) fixed.set(p.loc, p.sys);
  for (const st of g.stations.values()) addStation(st.id, st.system);
  for (const [loc, st] of stations) addStation(loc, st.system);
  for (const [loc, sys] of fixed) addStation(loc, sys);
  const ownOrders = new Set(ord.filter(r => r.range === 'station').map(r => r.loc)), buyer = new Uint8Array(T);
  // Upper bound: everything sold into the best orders a station can fill, ignoring min volumes and the other ships.
  const bound = (loc, sys, reg) => {
    let v = 0;
    for (let t = 0; t < T; t++) {
      let left = Q[t];
      for (const i of byType[t]) {
        if (left <= 0) break;
        const r = ord[i];
        if (r.range === 'station' ? r.loc !== loc : !fillsAt(r, loc, sys, reg)) continue;
        const q = Math.min(left, r.volume);
        v += q * r.net; left -= q; buyer[t] = 1;
      }
    }
    return v;
  };
  const pool = [];
  for (const [sys, locs] of bySys) {
    let d = Infinity;
    for (const a of starts) d = Math.min(d, reach(a, sys));
    if (d > o.maxJumps) continue;
    const reg = regionOf(sys), sorted = [...locs].sort((a, b) => a - b);
    // Stations in one system fill the same ranged orders; only those with station-range orders of their own add to that.
    const bare = bound(null, sys, reg), mine = sorted.filter(l => ownOrders.has(l));
    for (const loc of mine) { const v = bound(loc, sys, reg); if (!fixed.has(loc) && v > 0) pool.push({loc, sys, v, d}); }
    if (!mine.length && !sorted.some(l => fixed.has(l)) && bare > 0) pool.push({loc:sorted[0], sys, v:bare, d});
  }
  const byNet = [...pool].sort((a, b) => (b.v - o.perJump * b.d) - (a.v - o.perJump * a.d) || a.d - b.d || a.loc - b.loc);
  const byRaw = [...pool].sort((a, b) => b.v - a.v || a.d - b.d || a.loc - b.loc);
  const cands = [...fixed].slice(0, MASK_BITS).map(([loc, sys]) => ({loc, sys})), taken = new Set(cands.map(c => c.loc));
  const room = Math.max(0, Math.min(o.candidates, MASK_BITS - cands.length));
  for (let i = 0, k = 0; k < room && i < pool.length; i++) for (const list of [byNet, byRaw]) {
    const c = list[i];
    if (k < room && !taken.has(c.loc)) { taken.add(c.loc); cands.push({loc:c.loc, sys:c.sys}); k++; }
  }
  const cmask = new Int32Array(ord.length);
  cands.forEach((c, k) => { c.reg = regionOf(c.sys, c.loc); for (let i = 0; i < ord.length; i++) if (fillsAt(ord[i], c.loc, c.sys, c.reg)) cmask[i] |= 1 << k; });
  const live = byType.map(list => list.filter(i => cmask[i]));
  const candAt = new Map(cands.map((c, k) => [c.loc, k]));
  for (let t = 0; t < T; t++) if (quoted[t] && !floored[t] && !buyer[t]) notes.push({kind:'no-buyer', type:typeIds[t], maxJumps:o.maxJumps});
  for (const p of picks) if (p.sys === undefined || !home.some(h => jumps(h.sys, p.sys) <= o.maxJumps)) notes.push({kind:'unreachable', station:p.loc});

  // Sell one ship's goods at a set of stops (a mask of candidates) into the book as it stands: its hold first, then hangar
  // units from the pickups `from`, as many as the free hold takes, the ones paying most per m³ first. Only units that sell
  // are picked up. Mutates rem and hang; undo() puts them back.
  const maskOf = stops => stops.reduce((m, c) => m | 1 << c, 0);
  function allocate(s, from, union, rem, hang) {
    const hq = new Float64Array(T), want = new Float64Array(T);
    let extra = 0;
    for (const p of from) for (let t = 0; t < T; t++) hq[t] += hang[p][t];
    for (let t = 0; t < T; t++) extra += hq[t] * m3[t];
    if (extra <= free[s]) want.set(hq);
    else {
      const chunks = [];
      for (let t = 0; t < T; t++) {
        let skip = own[s][t], left = hq[t];
        for (const i of live[t]) {
          if (left <= 0) break;
          if (!(cmask[i] & union)) continue;
          let q = rem[i];
          const u = Math.min(skip, q); skip -= u; q -= u;
          if (q <= 0) continue;
          q = Math.min(q, left); left -= q;
          chunks.push({t, q, d:m3[t] > 0 ? ord[i].net / m3[t] : Infinity});
        }
      }
      chunks.sort((a, b) => b.d - a.d);
      let space = free[s];
      for (const c of chunks) {
        const q = m3[c.t] > 0 ? Math.min(c.q, Math.floor(space / m3[c.t] + 1e-9)) : c.q;
        if (q > 0) { want[c.t] += q; space -= q * m3[c.t]; }
      }
    }
    const fills = [], took = [];
    for (let t = 0; t < T; t++) {
      let supply = own[s][t] + want[t], mine = own[s][t], fromHangar = 0;
      if (supply <= 0) continue;
      for (const i of live[t]) {
        if (supply <= 0) break;
        if (!(cmask[i] & union)) continue;
        const left = rem[i];
        if (left <= 0 || supply < Math.min(ord[i].min, left)) continue; // min volume: at least that many, or all that is left
        const q = Math.min(supply, left), held = Math.min(q, mine);
        rem[i] -= q; supply -= q; mine -= held; fromHangar += q - held;
        fills.push({i, t, q, own:held});
      }
      for (const p of from) {
        if (fromHangar <= 0) break;
        const x = Math.min(hang[p][t], fromHangar);
        if (x > 0) { hang[p][t] -= x; fromHangar -= x; took.push({p, t, q:x}); }
      }
    }
    return {fills, took};
  }
  // Which stops sell anything: each fill counts at the first stop on the trip that reaches its order. A stop that sells
  // nothing is a detour; the same trip without it sells the same.
  const busy = (fills, stops) => {
    const used = new Uint8Array(stops.length);
    for (const f of fills) { let k = 0; while (k < stops.length && !(cmask[f.i] & 1 << stops[k])) k++; if (k < stops.length) used[k] = 1; }
    return used;
  };
  const undo = ({fills, took}, rem, hang) => { for (const f of fills) rem[f.i] += f.q; for (const k of took) hang[k.p][k.t] += k.q; };
  const pickedAt = a => [...new Set(a.took.map(k => k.p))].sort((x, y) => x - y).map(p => picks[p].loc);

  // A ship's waypoints: where it is, the pickups it uses (merged into the first stop when that is the pickup station),
  // the stops, and home again if asked. `out` leaves the trip home out: maxJumps limits the way out.
  function trip(s, pickLocs, stops) {
    const w = [{sys:home[s].sys, loc:home[s].loc, kind:'start'}];
    for (const loc of pickLocs) if (!(stops.length && cands[stops[0]].loc === loc)) w.push({sys:sysOf(loc) ?? fixed.get(loc), loc, kind:'pickup'});
    stops.forEach((c, k) => w.push({sys:cands[c].sys, loc:cands[c].loc, kind:'stop', k}));
    if (o.returnHome && w.length > 1) w.push({sys:home[s].sys, loc:home[s].loc, kind:'home'});
    let out = 0, back = 0;
    for (let i = 1; i < w.length; i++) { const j = jumps(w[i - 1].sys, w[i].sys); if (w[i].kind === 'home') back += j; else out += j; }
    return {w, out, jumps:out + back};
  }
  // Expected gank loss: for every jump, the chance of dying there (having survived the ones before) × what is aboard:
  // units still to sell (hangar units only once picked up) and units that won't sell. systemRisk() returns the chance p.
  function lossOf(s, tr, a, stops, pickLocs) {
    const n = stops.length, ownAt = new Float64Array(n + 1), hangAt = new Float64Array(n + 1), sold = new Float64Array(T);
    for (const f of a.fills) {
      let k = 0;
      while (k < n && !(cmask[f.i] & 1 << stops[k])) k++;
      ownAt[k] += f.own * ord[f.i].net; hangAt[k] += (f.q - f.own) * ord[f.i].net; sold[f.t] += f.own;
    }
    for (let k = n - 1; k >= 0; k--) { ownAt[k] += ownAt[k + 1]; hangAt[k] += hangAt[k + 1]; }
    let kept = 0;
    for (let t = 0; t < T; t++) kept += (own[s][t] - sold[t]) * worth[t];
    const route = [tr.w[0].sys], value = [0];
    let picked = false;
    for (let i = 1; i < tr.w.length; i++) {
      const w = tr.w[i], next = w.kind === 'stop' ? w.k : w.kind === 'home' ? n : 0, v = kept + ownAt[next] + (picked ? hangAt[next] : 0);
      const list = path(tr.w[i - 1].sys, w.sys) || [];
      for (let j = 1; j < list.length; j++) { route.push(list[j]); value.push(v); }
      if (pickLocs.includes(w.loc)) picked = true;
    }
    let surv = 1, loss = 0;
    for (let j = 1; j < route.length; j++) {
      const system = g.systems.get(route[j]);
      if (!system || !(value[j] > 0)) continue;
      const via = [route[j - 1], route[j + 1]].filter(x => x !== undefined && x !== route[j]);
      const p = systemRisk(system, {...riskCtx, value:value[j], via}).p;
      loss += surv * p * value[j]; surv *= 1 - p;
    }
    return {loss, route};
  }

  // 2. One ship against the book and hangars as they stand: every stop set and pickup choice, best visiting order each.
  function solo(s, rem, hang) {
    const choices = [[]];
    picks.forEach((p, i) => { if (p.sys !== undefined && hang[i].some(q => q > 0) && jumps(home[s].sys, p.sys) <= o.maxJumps) choices.push([i]); });
    const out = [], sub = [];
    const consider = from => {
      const a = allocate(s, from, maskOf(sub), rem, hang), pickLocs = pickedAt(a);
      if (from.length && !pickLocs.length) { undo(a, rem, hang); return; } // the same as not picking up
      const net = a.fills.reduce((v, f) => v + f.q * ord[f.i].net, 0);
      const firsts = pickLocs.map(loc => candAt.get(loc)).filter(c => sub.includes(c));
      const trips = orders(sub, firsts).filter(perm => busy(a.fills, perm).every(Boolean)).map(perm => [perm, trip(s, pickLocs, perm)]).filter(([, tr]) => tr.out <= o.maxJumps).sort((x, y) => x[1].jumps - y[1].jumps);
      let best = -Infinity;
      for (const [k, [perm, tr]] of trips.entries()) {
        const bound = net - o.perJump * tr.jumps;
        if (k && bound <= best) break; // sorted by jumps: no later order can do better
        const score = bound - lossOf(s, tr, a, perm, pickLocs).loss;
        if (!k || score > best) { out.push({s, from, stops:perm, net, jumps:tr.jumps, score}); best = Math.max(best, score); }
      }
      undo(a, rem, hang);
    };
    const visit = from => {
      for (const c of choices) consider(c);
      if (sub.length < o.maxStops) for (let c = from; c < cands.length; c++) { sub.push(c); visit(c + 1); sub.pop(); }
    };
    visit(0);
    return out;
  }
  // The best few by score, plus the most ISK at each jump count (the frontier the pair search needs).
  const shortlist = list => {
    const out = new Set([...list].sort((a, b) => b.score - a.score).slice(0, o.keep)), byJumps = new Map();
    for (const e of list) if (!byJumps.has(e.jumps) || e.net > byJumps.get(e.jumps).net) byJumps.set(e.jumps, e);
    let most = -Infinity;
    for (const [, e] of [...byJumps].sort((a, b) => a[0] - b[0])) if (e.net > most) { most = e.net; out.add(e); }
    return [...out];
  };

  // 3. Ships in sequence against one book: each sees what the ones before it sold and picked up.
  const rem = Float64Array.from(ord, r => r.volume), hang = stock.map(a => a.slice());
  function run(seq, together, wantLoss) {
    const parts = [];
    for (const e of seq) { const a = allocate(e.s, e.from, maskOf(e.stops), rem, hang); parts.push({e, a, pickLocs:pickedAt(a)}); }
    for (let i = parts.length - 1; i >= 0; i--) undo(parts[i].a, rem, hang);
    // Together, the fleet calls at every pickup any of its ships uses.
    const fleet = together ? [...new Set(parts.flatMap(p => p.pickLocs))] : null;
    if (together) {
      const used = parts.map(p => busy(p.a.fills, p.e.stops)), stops = seq[0]?.stops.filter((_, k) => used.some(u => u[k])) || [];
      for (const p of parts) p.e = {...p.e, stops};
    } else for (const p of parts) { const used = busy(p.a.fills, p.e.stops); p.e = {...p.e, stops:p.e.stops.filter((_, k) => used[k])}; }
    seq = parts.map(p => p.e);
    let net = 0, sum = 0, most = 0, ok = true;
    for (const p of parts) {
      if (fleet) p.pickLocs = fleet;
      p.tr = trip(p.e.s, p.pickLocs, p.e.stops);
      p.net = p.a.fills.reduce((v, f) => v + f.q * ord[f.i].net, 0);
      net += p.net; sum += p.tr.jumps; most = Math.max(most, p.tr.jumps);
      if (p.tr.out > o.maxJumps) ok = false;
    }
    if (!ok) return null;
    // Flying together, the fleet's route is paid once: the time the longest ship's route takes.
    const jumps = together ? most : sum, r = {seq, together, net, jumps, parts};
    if (wantLoss(net, jumps)) {
      r.loss = 0;
      for (const p of parts) { Object.assign(p, lossOf(p.e.s, p.tr, p.a, p.e.stops, p.pickLocs)); r.loss += p.loss; }
      r.score = net - r.loss - o.perJump * jumps;
    }
    return r;
  }
  const records = [];
  let top1 = -Infinity;
  const record = (seq, together = false, force = false) => {
    const r = run(seq, together, (net, jumps) => force || net - o.perJump * jumps > top1);
    if (!r) return null;
    delete r.parts;
    records.push(r);
    if (r.score > top1) top1 = r.score;
    return r;
  };
  const shipValue = own.map(a => a.reduce((v, q, t) => v + q * worth[t], 0));
  const byValue = [...ships.keys()].sort((a, b) => shipValue[b] - shipValue[a] || a - b);
  const bestOf = list => list.reduce((b, e) => !b || e.score > b.score ? e : b, null);
  // A ship's best plan after the ships in `before` have sold.
  const reply = (before, s) => {
    const parts = before.map(e => allocate(e.s, e.from, maskOf(e.stops), rem, hang));
    const e = bestOf(solo(s, rem, hang));
    for (let i = parts.length - 1; i >= 0; i--) undo(parts[i], rem, hang);
    return e;
  };
  const strip = e => ({s:e.s, from:e.from, stops:e.stops});

  // Selling where each ship stands: its own station, with whatever the hangar there holds. Which ship sells first
  // decides how a shared hangar splits between the holds, so up to three ships try every order.
  const stay = s => ({s, from:home[s].loc != null && pNo.has(home[s].loc) ? [pNo.get(home[s].loc)] : [], stops:candAt.has(home[s].loc) ? [candAt.get(home[s].loc)] : []});
  const here = (ships.length <= 3 ? perms(byValue) : [byValue]).map(seq => record(seq.map(stay), false, true)).reduce((b, r) => !b || r.net > b.net + 1e-6 ? r : b, null);
  if (ships.length && o.together) {
    const all = picks.map((_, i) => i).filter(i => picks[i].sys !== undefined), sub = [];
    const visit = from => {
      const firsts = picks.map(p => candAt.get(p.loc)).filter(c => sub.includes(c));
      for (const perm of orders(sub, firsts)) record(byValue.map(s => ({s, from:all, stops:perm})), true);
      if (sub.length < o.maxStops) for (let c = from; c < cands.length; c++) { sub.push(c); visit(c + 1); sub.pop(); }
    };
    visit(0);
  } else if (ships.length === 1) {
    for (const e of shortlist(solo(0, rem, hang))) record([strip(e)]);
  } else if (ships.length === 2) {
    const [A, B] = [0, 1].map(s => shortlist(solo(s, rem, hang)).map(strip));
    for (const a of A) for (const b of B) { record([a, b]); record([b, a]); }
    // Each ship's best reply to the other's plan in the best pair, until neither improves.
    for (let round = 0; round < 3; round++) {
      const best = bestOf(records.filter(r => r.score !== undefined && !r.together));
      let better = false;
      for (const k of [0, 1]) {
        const first = best.seq[k], other = best.seq[1 - k].s, e = reply([first], other);
        const r = e && record([first, strip(e)]);
        if (r?.score > best.score + 1e-6) better = true;
      }
      if (!better) break;
    }
  } else {
    const seq = [];
    for (const s of byValue) { const e = reply(seq, s); if (e) seq.push(strip(e)); }
    record(seq);
  }

  // 4. The plans to show.
  const withLoss = r => r.score !== undefined ? r : Object.assign(r, run(r.seq, r.together, () => true), {parts:undefined});
  const scored = records.filter(r => r.score !== undefined);
  const best = scored.reduce((b, r) => !b || r.score > b.score + 1e-6 || (Math.abs(r.score - b.score) <= 1e-6 && r.jumps < b.jumps) ? r : b, null);
  const most = records.reduce((b, r) => !b || r.net > b.net + 1e-6 || (Math.abs(r.net - b.net) <= 1e-6 && r.jumps < b.jumps) ? r : b, null);
  const frontier = [];
  let mostNet = -Infinity;
  for (const r of [...records].sort((a, b) => a.jumps - b.jumps || b.net - a.net)) if (r.net > mostNet + 1e-6) { mostNet = r.net; frontier.push(withLoss(r)); }
  withLoss(most);
  const picked = [[here, 'here', 'Sell here'], [best, 'best', 'Best'], [most, 'most', 'Most ISK']];
  for (const r of frontier.filter(r => !picked.some(([x]) => x === r)).sort((a, b) => b.score - a.score).slice(0, 3)) picked.push([r, `j${r.jumps}`, `${r.jumps} jumps`]);
  const plans = [], seen = new Map(), thin = new Map();
  for (const [r, key, label] of picked) {
    if (!r) continue;
    const plan = build(r, key, label), sig = JSON.stringify(plan.ships.map(x => [x.route, x.stops]));
    if (seen.has(sig)) { seen.get(sig).also.push(key); continue; }
    seen.set(sig, plan); plans.push(plan);
  }
  plans.sort((a, b) => (a.key === 'here' ? -1 : 0) - (b.key === 'here' ? -1 : 0) || a.jumps - b.jumps);
  for (const [, n] of thin) notes.push(n);
  // What no plan can sell: no quotes, all under the floor, or no buyer within maxJumps.
  const unsold = [...stray];
  for (let t = 0; t < T; t++) if (Q[t] > 0 && (!quoted[t] || floored[t] || !buyer[t])) unsold.push({type:typeIds[t], qty:Q[t], reason:why(t)});
  return {plans, unsold, notes};

  // A plan in full: each ship's route, its stops with pickups and sales, and what is left unsold, and why.
  function build(r, key, label) {
    const res = run(r.seq, r.together, () => true), out = ships.map((sh, s) => ({pilot:sh.pilot, name:sh.name, route:[home[s].sys], stops:[], jumps:0, net:0, expectedLoss:0}));
    const left = stock.map(a => a.slice()), used = new Float64Array(ships.length), visited = new Set(), unsold = [];
    let umask = 0;
    const sold = new Float64Array(T);
    for (const p of res.parts) {
      const s = p.e.s, x = out[s], at = [];
      Object.assign(x, {route:p.route, jumps:p.tr.jumps, net:p.net, expectedLoss:p.loss});
      for (const w of p.tr.w) {
        if (w.kind === 'start' || w.kind === 'home') { at.push(null); continue; }
        const last = x.stops.at(-1);
        if (!last || last.station !== w.loc) x.stops.push({station:w.loc, system:w.sys, pickups:[], sales:[]});
        at.push(x.stops.at(-1));
      }
      for (const k of p.a.took) {
        left[k.p][k.t] -= k.q; used[s] += k.q * m3[k.t]; visited.add(k.p);
        const stop = x.stops.find(st => st.station === picks[k.p].loc);
        const row = stop.pickups.find(y => y.type === typeIds[k.t]);
        if (row) row.qty += k.q; else stop.pickups.push({type:typeIds[k.t], qty:k.q});
      }
      const n = p.e.stops.length, ownSold = new Float64Array(T);
      umask |= maskOf(p.e.stops);
      for (const f of p.a.fills) {
        let k = 0;
        while (k < n && !(cmask[f.i] & 1 << p.e.stops[k])) k++;
        const stop = at[p.tr.w.findIndex(w => w.kind === 'stop' && w.k === k)], r0 = ord[f.i];
        const row = stop.sales.find(y => y.order === r0.id);
        if (row) { row.qty += f.q; row.net += f.q * r0.net; } else stop.sales.push({type:typeIds[f.t], qty:f.q, price:r0.price, order:r0.id, orderLoc:r0.loc, net:f.q * r0.net});
        ownSold[f.t] += f.own; sold[f.t] += f.q;
      }
      for (let t = 0; t < T; t++) if (own[s][t] - ownSold[t] > 0) unsold.push({type:typeIds[t], qty:own[s][t] - ownSold[t], reason:why(t), pilot:ships[s].pilot});
    }
    const full = (p, t) => res.parts.some(q => q.e.from.includes(p) && free[q.e.s] - used[q.e.s] < m3[t]);
    left.forEach((a, p) => a.forEach((q, t) => {
      const calls = visited.has(p) || res.parts.some(x => x.e.from.includes(p));
      if (q > 0) unsold.push({type:typeIds[t], qty:q, reason:why(t, !calls ? 'not picked up' : full(p, t) ? 'no room' : null), station:picks[p].loc});
    }));
    unsold.push(...stray);
    // A book is thin when the plan takes more than half of what the orders its stops can reach hold.
    for (let t = 0; t < T; t++) {
      if (!sold[t]) continue;
      const book = live[t].reduce((v, i) => v + (cmask[i] & umask ? ord[i].volume : 0), 0), share = sold[t] / book;
      if (share > 0.5 && !(thin.get(t)?.share >= share)) thin.set(t, {kind:'thin', type:typeIds[t], qty:sold[t], volume:book, share, plan:key});
    }
    const kept = unsold.reduce((v, u) => v + u.qty * (tNo.has(u.type) ? worth[tNo.get(u.type)] : 0), 0);
    return {key, label, also:[], jumps:res.jumps, net:res.net, expectedLoss:res.loss, score:res.score, soldShare:res.net + kept > 0 ? res.net / (res.net + kept) : 0, together:!!r.together, ships:out, unsold};
  }
  function why(t, hangar) {
    if (!quoted[t]) return 'no quotes';
    if (floored[t]) return 'below floor';
    if (!buyer[t]) return 'no buyer in range';
    return hangar || 'no buyer on route';
  }
}

// Across the Worker boundary everything is plain arrays and objects: Maps travel as entry lists.
const entries = m => m instanceof Map ? [...m] : Array.isArray(m) ? m : Object.entries(m || {}).map(([k, v]) => [Number(k), v]);
export function toSellMessage({lots = [], ships = [], quotes, stations, salesTax = 0, risk = {}, options = {}}) {
  const {floor, ...rest} = options;
  return {lots, ships, quotes:entries(quotes), stations:entries(stations), salesTax, risk:{...risk, live:entries(risk.live)}, options:{...rest, ...(floor ? {floor:entries(floor)} : {})}};
}
export function fromSellMessage(msg, g) {
  const {floor, ...rest} = msg.options || {};
  return {...msg, g, quotes:new Map(msg.quotes || []), stations:new Map(msg.stations || []), risk:{...msg.risk, live:new Map(msg.risk?.live || [])}, options:{...rest, ...(floor ? {floor:new Map(floor)} : {})}};
}
export const planSellMessage = (g, msg) => planSell(fromSellMessage(msg, g));
