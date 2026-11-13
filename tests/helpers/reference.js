// Straightforward reference versions of the planners (Map-based Dijkstra, every sell × buy pair, every stop order),
// kept only so tests can check the optimised ones in route.js, market.js and hauling.js return exactly the same answers.
import {secClass, LOW_SEC_PENALTY} from '../../route.js';

export function paths(g, from, {safe = true, weight} = {}) {
  const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]];
  const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, id] = pop();
    if (d > dist.get(id)) continue;
    for (const next of g.systems.get(id)?.links || []) {
      const step = weight ? weight(next) : safe && secClass(g.systems.get(next)?.sec ?? -1) !== 'hi' ? LOW_SEC_PENALTY : 1;
      if (!Number.isFinite(step)) continue;
      const cost = d + step;
      if (cost < (dist.get(next) ?? Infinity)) { dist.set(next, cost); prev.set(next, id); push([cost, next]); }
    }
  }
  return {
    reachable:to => dist.has(to), cost:to => dist.get(to),
    path(to) {
      if (!dist.has(to)) return null;
      const list = [to];
      while (list[0] !== from) list.unshift(prev.get(list[0]));
      return list;
    }
  };
}

export function hauls(market, {salesTax, cargo, volumeOf, budget = Infinity, limit = 60}) {
  const out = [];
  for (const [type, item] of market.items) {
    const m3 = volumeOf(type);
    if (!(m3 > 0)) continue;
    let best = null;
    for (const from of item.sells) for (const to of item.buys) {
      if (from.loc === to.loc) continue;
      const unit = to.price * (1 - salesTax) - from.price;
      if (unit <= 0) continue;
      const units = Math.min(from.volume, to.volume, Math.floor(cargo / m3), Math.floor(budget / from.price));
      if (units < 1) continue;
      const profit = unit * units;
      if (!best || profit > best.profit) best = {type, from, to, unit, units, profit, invest:from.price * units, m3:units * m3};
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.profit - a.profit).slice(0, limit);
}

// The cheapest order through every middle stop, found by pricing all of them (first one wins a tie).
export function bestOrder(cost, {end = 'fixed'} = {}) {
  const n = cost.length;
  if (n <= 2) return [...Array(n).keys()];
  const last = end === 'fixed' ? n - 1 : null, middle = [...Array(n).keys()].slice(1).filter(i => i !== last);
  const total = order => { let t = 0; for (let i = 1; i < order.length; i++) t += cost[order[i - 1]][order[i]]; return t + (end === 'return' ? cost[order[order.length - 1]][0] : 0); };
  const wrap = mid => [0, ...mid, ...(last === null ? [] : [last])];
  let best = null, bestCost = Infinity;
  const permute = (rest, acc) => {
    if (!rest.length) { const o = wrap(acc), c = total(o); if (c < bestCost) { bestCost = c; best = o; } return; }
    for (let i = 0; i < rest.length; i++) permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
  };
  permute(middle, []);
  return best;
}
