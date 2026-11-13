import test from 'node:test';
import assert from 'node:assert/strict';
import {graph, paths, leg, facilities} from '../route.js';
import {book, hauls, stationTrades} from '../market.js';
import {plan, bestOrder} from '../hauling.js';
import {syntheticMarket} from './helpers/synthetic.js';
import * as ref from './helpers/reference.js';

// One 5,400-system payload shared by every test here (building it takes a moment).
const data = syntheticMarket(), g = graph(data.universe), market = book(data.regions);
const timed = fn => { const t = performance.now(); const out = fn(); return [out, performance.now() - t]; };
// The best of a few runs, so a busy CI machine doesn't fail a budget that is 10 to 100 times the real cost.
const best = (fn, runs = 3) => Math.min(...Array.from({length:runs}, () => timed(fn)[1]));

test('paths() returns the same routes, costs and reach as the reference Dijkstra', () => {
  const sources = [...data.hubs, data.ids[0], data.ids[2500], data.ids.at(-1)];
  for (const from of sources) for (const opts of [{safe:true}, {safe:false}]) {
    const a = paths(g, from, opts), b = ref.paths(g, from, opts);
    for (const id of g.systems.keys()) {
      assert.equal(a.reachable(id), b.reachable(id));
      assert.equal(a.cost(id), b.cost(id));
      assert.deepEqual(a.path(id), b.path(id), `path ${from} → ${id}`);
    }
  }
});
test('paths() with a pricing function, forbidden systems and unknown gates matches the reference', () => {
  const weight = id => id % 7 === 0 ? Infinity : 1 + (id % 13) / 4;
  for (const from of data.hubs.slice(0, 3)) {
    const a = paths(g, from, {weight}), b = ref.paths(g, from, {weight});
    for (const id of data.ids.filter((_, i) => i % 11 === 0)) { assert.equal(a.cost(id), b.cost(id)); assert.deepEqual(a.path(id), b.path(id)); }
  }
  // A gate to a system the map doesn't list is a dead end; a start the map doesn't list reaches only itself.
  const odd = graph({systems:{1:['A', 0.9, 7, [2, 99]], 2:['B', 0.2, 7, [1, 3]], 3:['C', -0.5, 7, [2]]}});
  for (const from of [1, 3, 99, 5]) for (const opts of [{safe:true}, {safe:false}]) {
    const a = paths(odd, from, opts), b = ref.paths(odd, from, opts);
    for (const id of [1, 2, 3, 99, 5, 12345]) { assert.equal(a.reachable(id), b.reachable(id), `${from}→${id}`); assert.equal(a.cost(id), b.cost(id)); assert.deepEqual(a.path(id), b.path(id)); }
  }
});
test('hauls() returns the same best haul per item as pricing every sell × buy pair', () => {
  const volumeOf = id => data.types[id]?.v;
  for (const opts of [{salesTax:0.075, cargo:5000}, {salesTax:0.04, cargo:60, limit:500}, {salesTax:0.075, cargo:1e6, budget:5e6, limit:500}, {salesTax:0.5, cargo:300, budget:1e9, limit:25}]) {
    const o = {volumeOf, ...opts};
    assert.deepEqual(hauls(market, o), ref.hauls(market, o));
  }
  // Orders in any sequence (a market that wasn't sorted by book()), with ties on profit.
  const loose = {items:new Map([[1, {sells:[{loc:1, price:10, volume:5}, {loc:2, price:8, volume:5}, {loc:3, price:9, volume:100}], buys:[{loc:4, price:20, volume:5}, {loc:5, price:30, volume:2}, {loc:1, price:40, volume:9}]}]]), stations:new Map()};
  const o = {salesTax:0, cargo:100, volumeOf:() => 1};
  assert.deepEqual(hauls(loose, o), ref.hauls(loose, o));
});
test('bestOrder() matches pricing every order up to 6 stops between the ends, and stays sensible beyond', () => {
  let seed = 3; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 3; n <= 8; n++) for (const end of ['fixed', 'free', 'return']) for (let round = 0; round < 6; round++) {
    // Whole-number costs make ties common, which is where a different search order would show.
    const cost = Array.from({length:n}, (_, i) => Array.from({length:n}, (_, j) => i === j ? 0 : 1 + Math.floor(R() * 6)));
    const middle = n - 1 - (end === 'fixed' ? 1 : 0);
    const got = bestOrder(cost, {end});
    if (middle <= 6) assert.deepEqual(got, ref.bestOrder(cost, {end}), `${n} stops, ${end}`);
    assert.equal(got[0], 0); assert.deepEqual([...got].sort((a, b) => a - b), [...Array(n).keys()]);
    if (end === 'fixed') assert.equal(got.at(-1), n - 1);
  }
});

// Generous budgets (about 20 to 100 times what a laptop takes): they only exist so a regression back to the old
// O(n²) or O(n!) behaviour shows up as a failure.
test('planners stay fast on a New Eden sized payload', () => {
  const volumeOf = id => data.types[id]?.v;
  assert.ok(best(() => graph(data.universe)) < 400, 'graph()');
  assert.ok(best(() => book(data.regions)) < 600, 'book()');
  assert.ok(best(() => { const p = paths(g, data.hubs[0]); for (const id of g.systems.keys()) p.path(id); }) < 400, 'paths() + every path()');
  assert.ok(best(() => hauls(market, {salesTax:0.075, cargo:5000, volumeOf, limit:40})) < 250, 'hauls()');
  assert.ok(best(() => stationTrades(market, {salesTax:0.075, brokerFee:0.03})) < 250, 'stationTrades()');
  assert.ok(best(() => facilities(g, data.hubs[0], 1, () => 0.01)) < 400, 'facilities()');
  const cache = new Map();
  assert.ok(best(() => { for (const to of data.hubs) leg(g, data.hubs[0], to, cache); }) < 400, 'leg()');
  const cost = Array.from({length:9}, (_, i) => Array.from({length:9}, (_, j) => (i * 7 + j * 13) % 17 + 1));
  assert.ok(best(() => bestOrder(cost, {end:'free'})) < 400, 'bestOrder(), 8 middle stops falls back to the heuristic');
  // The Haul plan's worst case: 8 stops with the best order searched, in all three modes.
  const stops = [...data.hubs, data.ids[900], data.ids[2000]].slice(0, 8), ctx = {history:data.risk, traffic:{}, live:new Map(), value:1e8, hull:'t1', now:Date.now()};
  const [plans, ms] = timed(() => ['safest', 'balanced', 'shortest'].map(mode => plan(g, stops, ctx, {mode, lowsec:true, optimize:true})));
  assert.ok(plans.every(p => p.route?.length > 1 && !p.unreachable), 'every mode finds a route');
  assert.ok(ms < 3000, `plan() ×3 took ${Math.round(ms)} ms`);
});

test('the Haul plan runs the same in the Worker protocol and in the page fallback', async () => {
  const {planAll, snapshotOf, planModes} = await import('../ui/haulplan.js');
  const marketData = {universe:data.universe, meta:{data:{risk:{s:data.risk}, activity:{[data.hubs[0]]:[0, 0, 500]}}}};
  const snapshot = snapshotOf(marketData);
  assert.equal(snapshotOf(marketData), snapshot, 'one snapshot per market data');
  const stops = [data.hubs[0], data.hubs[1], data.hubs[2]], ctx = {live:new Map(), value:1e8, hull:'t1', now:1e12}, options = {lowsec:true, avoid:new Set(), optimize:true, end:'fixed'};
  // No Worker in Node: the fallback plans on the page's own graph.
  const page = await planAll(g, snapshot, stops, ctx, options);
  assert.deepEqual(page, planModes(g, stops, {history:snapshot.history, traffic:snapshot.traffic, ...ctx}, options));
  // The Worker's side, driven through its message handler: setup once, then plan; systems travel as ids.
  const out = []; globalThis.self = {postMessage:m => out.push(m)};
  await import('../ui/haulworker.js');
  globalThis.self.onmessage({data:{setup:snapshot}});
  globalThis.self.onmessage({data:{id:1, key:snapshot.key, stops, ctx, options}});
  globalThis.self.onmessage({data:{id:2, key:snapshot.key + 1, stops, ctx, options}});
  assert.equal(out[0].id, 1);
  for (const [mode, p] of Object.entries(out[0].plans)) {
    assert.deepEqual(p.route, page[mode].route);
    assert.deepEqual(p.steps.map(s => s.system), page[mode].steps.map(s => s.system.id));
    assert.equal(p.survival, page[mode].survival);
  }
  assert.match(out[1].error, /no map/, 'a plan for a snapshot the Worker never got is an error, not a guess');
  delete globalThis.self;
});
