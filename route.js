// Routing over the gate map the pipeline stores, plus picking safe, cheap NPC facilities nearby.
export const LOW_SEC_PENALTY = 50; // like the in-game "safer" route: a low/null-sec jump costs 50 high-sec jumps

// EVE shows security rounded to one decimal, except anything just above zero shows as 0.1.
export const secShown = sec => sec > 0 && sec < 0.05 ? 0.1 : Math.round(sec * 10) / 10;
export const secClass = sec => secShown(sec) >= 0.5 ? 'hi' : secShown(sec) > 0 ? 'low' : 'null';

export function graph(universe) {
  const systems = new Map(), stations = new Map();
  for (const [id, [name, sec, region, links, belts = 0]] of Object.entries(universe?.systems || {})) systems.set(Number(id), {id:Number(id), name, sec, region, links, belts});
  for (const [id, system, flags, name] of universe?.stations || []) stations.set(id, {id, system, flags, name});
  return {systems, stations};
}
// Single-source Dijkstra with a small binary heap; `path(to)` rebuilds the jump list.
export function paths(g, from, {safe = true} = {}) {
  const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]];
  const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, id] = pop();
    if (d > dist.get(id)) continue;
    for (const next of g.systems.get(id)?.links || []) {
      const cost = d + (safe && secClass(g.systems.get(next)?.sec ?? -1) !== 'hi' ? LOW_SEC_PENALTY : 1);
      if (cost < (dist.get(next) ?? Infinity)) { dist.set(next, cost); prev.set(next, id); push([cost, next]); }
    }
  }
  return {
    reachable:to => dist.has(to),
    path(to) {
      if (!dist.has(to)) return null;
      const list = [to];
      while (list[0] !== from) list.unshift(prev.get(list[0]));
      return list;
    }
  };
}
export function leg(g, from, to, cache = new Map()) {
  if (!cache.has(from)) cache.set(from, paths(g, from));
  const list = cache.get(from).path(to);
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
