// Routing over the gate map the pipeline stores, plus picking safe, cheap NPC facilities nearby.
export const LOW_SEC_PENALTY = 50; // like the in-game "safer" route: a low/null-sec jump costs 50 high-sec jumps

// EVE shows security rounded to one decimal, except anything just above zero shows as 0.1.
export const secShown = sec => sec > 0 && sec < 0.05 ? 0.1 : Math.round(sec * 10) / 10;
export const secClass = sec => secShown(sec) >= 0.5 ? 'hi' : secShown(sec) > 0 ? 'low' : 'null';

export function graph(universe) {
  const systems = new Map(), stations = new Map();
  for (const [id, [name, sec, region, links, belts = 0, pos = null, p2 = null, constellation = null]] of Object.entries(universe?.systems || {})) systems.set(Number(id), {id:Number(id), name, sec, region, links, belts, pos, p2, constellation});
  for (const [id, system, flags, name] of universe?.stations || []) stations.set(id, {id, system, flags, name});
  const g = {systems, stations, regions:universe?.regions || {}, constellations:universe?.constellations || {}};
  numbered(g);
  return g;
}
// Systems numbered 0..n-1 once per graph, with the gates in flat arrays: what paths() runs on instead of Maps.
// A gate to an id the map doesn't list gets a number too (a dead end with no security), as it always had a distance.
const NUMBERED = new WeakMap();
function numbered(g) {
  let n = NUMBERED.get(g);
  if (n) return n;
  const index = new Map(), ids = [];
  const number = id => { if (!index.has(id)) { index.set(id, ids.length); ids.push(id); } };
  for (const id of g.systems.keys()) number(id);
  for (const s of g.systems.values()) for (const to of s.links || []) number(to);
  const size = ids.length, start = new Int32Array(size + 1), hi = new Uint8Array(size);
  let edges = 0;
  for (let i = 0; i < size; i++) { const s = g.systems.get(ids[i]); start[i] = edges; edges += s?.links?.length || 0; hi[i] = s && secClass(s.sec) === 'hi' ? 1 : 0; }
  start[size] = edges;
  const to = new Int32Array(edges);
  for (let i = 0; i < size; i++) { const links = g.systems.get(ids[i])?.links || []; for (let k = 0; k < links.length; k++) to[start[i] + k] = index.get(links[k]); }
  // The heap's two parallel arrays are scratch space shared by every search on this graph (each search finishes before the next).
  NUMBERED.set(g, n = {index, ids, start, to, hi, heapCost:new Float64Array(edges + 1), heapNode:new Int32Array(edges + 1)});
  return n;
}
// Single-source Dijkstra with a binary heap over typed arrays; `path(to)` rebuilds the jump list.
// `weight(id)` prices entering a system; by default a jump costs 1, or LOW_SEC_PENALTY into low/null-sec when safe.
// Ties break exactly as the original Map-and-pairs heap did: same push order, same comparisons.
export function paths(g, from, {safe = true, weight} = {}) {
  const {index, ids, start, to, hi, heapCost:hc, heapNode:hn} = numbered(g), src = index.get(from);
  if (src === undefined) return {reachable:t => t === from, cost:t => t === from ? 0 : undefined, path:t => t === from ? [from] : null};
  const dist = new Float64Array(ids.length).fill(Infinity), prev = new Int32Array(ids.length).fill(-1);
  let len = 0;
  const push = (c, v) => { let i = len++; while (i > 0) { const p = (i - 1) >> 1; if (hc[p] <= c) break; hc[i] = hc[p]; hn[i] = hn[p]; i = p; } hc[i] = c; hn[i] = v; };
  dist[src] = 0; push(0, src);
  while (len) {
    const d = hc[0], at = hn[0], c = hc[--len], v = hn[len];
    if (len) { let i = 0; for (;;) { const l = 2 * i + 1; if (l >= len) break; const m = l + 1 < len && hc[l + 1] < hc[l] ? l + 1 : l; if (hc[m] >= c) break; hc[i] = hc[m]; hn[i] = hn[m]; i = m; } hc[i] = c; hn[i] = v; }
    if (d > dist[at]) continue;
    for (let k = start[at]; k < start[at + 1]; k++) {
      const next = to[k], step = weight ? weight(ids[next]) : safe && !hi[next] ? LOW_SEC_PENALTY : 1;
      if (!Number.isFinite(step)) continue;
      const cost = d + step;
      if (cost < dist[next]) { dist[next] = cost; prev[next] = at; push(cost, next); }
    }
  }
  return {
    reachable:t => { const i = index.get(t); return i !== undefined && dist[i] < Infinity; },
    cost:t => { const i = index.get(t); return i !== undefined && dist[i] < Infinity ? dist[i] : undefined; },
    path(t) {
      let i = index.get(t);
      if (i === undefined || dist[i] === Infinity) return null;
      const list = [];
      for (; i !== src; i = prev[i]) list.push(ids[i]);
      list.push(from);
      return list.reverse();
    }
  };
}
// Each system's number in the arrays that hops() returns.
export const systemIndex = g => numbered(g).index;
// Gate jumps from one system to every system within `max`, whatever the security: how a buy order's range is counted.
// An Int16Array by systemIndex(g); -1 beyond `max` or unreachable.
export function hops(g, from, max = Infinity) {
  const {index, start, to, ids} = numbered(g), dist = new Int16Array(ids.length).fill(-1), src = index.get(from);
  if (src === undefined) return dist;
  const queue = new Int32Array(ids.length);
  let head = 0, tail = 0;
  dist[src] = 0; queue[tail++] = src;
  while (head < tail) {
    const at = queue[head++], d = dist[at];
    if (d >= max) continue;
    for (let k = start[at]; k < start[at + 1]; k++) if (dist[to[k]] < 0) { dist[to[k]] = d + 1; queue[tail++] = to[k]; }
  }
  return dist;
}
// One gate route; `safe:false` allows the shortest path through low/null-sec. The cache is keyed per mode.
export function leg(g, from, to, cache = new Map(), {safe = true} = {}) {
  const key = safe ? from : `${from}:unsafe`;
  if (!cache.has(key)) cache.set(key, paths(g, from, {safe}));
  const list = cache.get(key).path(to);
  if (!list) return null;
  const systems = list.map(id => g.systems.get(id));
  return {from, to, systems, jumps:list.length - 1, risky:systems.slice(1).filter(s => secClass(s.sec) !== 'hi').length};
}
// NPC stations with a service (1 factory, 2 lab) in high-sec within reach, cheapest index first, then closest.
export function facilities(g, from, flag, indexOf, {maxJumps = 10, limit = 3} = {}) {
  const route = paths(g, from), seen = new Set(), out = [];
  for (const station of g.stations.values()) {
    const system = g.systems.get(station.system);
    if (!(station.flags & flag) || seen.has(system.id) || secClass(system.sec) !== 'hi') continue;
    const list = route.path(system.id);
    if (!list || list.length - 1 > maxJumps || list.slice(1).some(id => secClass(g.systems.get(id).sec) !== 'hi')) continue;
    const index = indexOf(system.id);
    if (!Number.isFinite(index)) continue;
    seen.add(system.id);
    out.push({station, system, jumps:list.length - 1, index});
  }
  return out.sort((a, b) => a.index - b.index || a.jumps - b.jumps).slice(0, limit);
}
// The closest of several places (anything with a `system`), by safe route from `from`.
export function nearest(g, from, places, cache = new Map()) {
  let best = null;
  const cost = r => r.jumps + r.risky * LOW_SEC_PENALTY;
  for (const place of places) {
    const route = place?.system ? leg(g, from, place.system, cache) : null;
    if (route && (!best || cost(route) < cost(best.route))) best = {place, route};
  }
  return best;
}
const slug = name => encodeURIComponent(name.replaceAll(' ', '_'));
export const dotlanSystem = name => `https://evemaps.dotlan.net/system/${slug(name)}`;
export const dotlanRoute = names => `https://evemaps.dotlan.net/route/${names.map(slug).join(':')}`;
