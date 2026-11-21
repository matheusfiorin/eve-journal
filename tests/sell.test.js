import test from 'node:test';
import assert from 'node:assert/strict';
import {graph} from '../route.js';
import {book} from '../market.js';
import {planSell, inRange, toSellMessage, planSellMessage} from '../sell.js';
import {syntheticMarket} from './helpers/synthetic.js';

// A line of systems 1–n (all high-sec unless `sec` says otherwise), station 100+i in system i, plus `extra` stations.
const line = (n, {sec = () => 0.9, region = () => 7, extra = []} = {}) => graph({
  systems:Object.fromEntries(Array.from({length:n}, (_, k) => { const i = k + 1; return [i, [`S${i}`, sec(i), region(i), [i - 1, i + 1].filter(x => x >= 1 && x <= n)]]; })),
  stations:[...Array.from({length:n}, (_, k) => [101 + k, k + 1, 0, `Station ${k + 1}`]), ...extra]
});
let orderNo = 0;
const buy = (g, loc, price, volume, range = 'station', minVolume = 1) => ({order:++orderNo, loc, system:g.stations.get(loc).system, price, volume, minVolume, range});
const ship = (pilot, station, g, capacity = 375) => ({pilot, name:`${pilot}'s Coercer`, shipType:16236, capacity, system:g.stations.get(station).system, station});
const hold = (pilot, type, qty, m3 = 1) => ({type, qty, m3, from:{kind:'ship', pilot}});
const hangar = (station, type, qty, m3 = 1) => ({type, qty, m3, from:{kind:'hangar', station}});
const run = (g, {lots, ships, quotes, options = {}, salesTax = 0}) => planSell({g, lots, ships, quotes:new Map(Object.entries(quotes).map(([t, q]) => [Number(t), q])), stations:new Map(), salesTax, risk:{now:0}, options});
const plan = (out, key) => out.plans.find(p => p.key === key || p.also.includes(key));
const sales = p => p.ships.flatMap(s => s.stops.flatMap(st => st.sales.map(x => ({...x, pilot:s.pilot, station:st.station}))));
const soldOf = (p, type) => sales(p).filter(x => x.type === type).reduce((v, x) => v + x.qty, 0);
// Every plan: no order filled past its volume, no hold past its capacity (packaged m³), pickups before any sale of them.
function sound(out, {quotes, ships, lots}) {
  const volume = new Map(Object.values(quotes).flat().map(q => [q.order, q.volume])), m3 = new Map(lots.map(l => [l.type, l.m3]));
  for (const p of out.plans) {
    const filled = new Map();
    for (const x of sales(p)) { filled.set(x.order, (filled.get(x.order) || 0) + x.qty); assert.ok(x.qty >= 1); }
    for (const [order, q] of filled) assert.ok(q <= volume.get(order), `${p.key}: order ${order} sold ${q} of ${volume.get(order)}`);
    for (const s of p.ships) {
      const cap = ships.find(x => x.pilot === s.pilot).capacity, aboard = lots.filter(l => l.from.kind === 'ship' && l.from.pilot === s.pilot).reduce((v, l) => v + l.qty * l.m3, 0);
      const picked = s.stops.flatMap(st => st.pickups).reduce((v, x) => v + x.qty * m3.get(x.type), 0);
      if (picked) assert.ok(aboard + picked <= cap + 1e-9, `${p.key}: ${s.pilot} carries ${aboard + picked} m³ in ${cap}`);
      const first = s.stops.findIndex(st => st.pickups.length);
      if (first > 0) assert.ok(s.stops.slice(0, first).every(st => !st.sales.length), 'nothing is sold before the pickup');
    }
  }
}

test('the range rule: station, solar system, n jumps, region', () => {
  assert.equal(inRange('station', {sameStation:true, sameSystem:true}), true);
  assert.equal(inRange('station', {sameSystem:true, jumps:0}), false);
  assert.equal(inRange('solarsystem', {sameSystem:true}), true);
  assert.equal(inRange('solarsystem', {sameRegion:true, jumps:1}), false);
  assert.equal(inRange(2, {jumps:2}), true);
  assert.equal(inRange(2, {jumps:3}), false);
  assert.equal(inRange(1, {sameSystem:true}), true, 'a ranged order covers its own system');
  assert.equal(inRange('region', {sameRegion:true, jumps:40}), true);
  assert.equal(inRange('region', {jumps:1}), false);
  // The same rule inside the planner. Systems 1–5 are one region, 6 another; the ship is docked in system 1.
  const g = line(6, {region:i => i === 6 ? 8 : 7, extra:[[203, 3, 0, 'Second station in 3']]});
  const here = quotes => plan(run(g, {lots:[hold('A', 1, 10)], ships:[ship('A', 101, g)], quotes:{1:quotes}}), 'here');
  assert.equal(soldOf(here([buy(g, 103, 100, 50, 2)]), 1), 10, 'a 2-jump order two jumps away');
  assert.equal(soldOf(here([buy(g, 103, 100, 50, 1)]), 1), 0, 'a 1-jump order two jumps away');
  assert.equal(soldOf(here([buy(g, 103, 100, 50, '2')]), 1), 10, 'ranges as strings of digits are jumps');
  assert.equal(soldOf(here([buy(g, 105, 100, 50, 'region')]), 1), 10, 'a region order anywhere in the region');
  assert.equal(soldOf(here([buy(g, 106, 100, 50, 'region')]), 1), 0, 'not from another region');
  assert.equal(soldOf(here([buy(g, 103, 100, 50, 'solarsystem'), buy(g, 101, 100, 50, 'solarsystem')]), 1), 10);
  // A station order at 203 and a solar-system order at 103: docking at 203 fills both.
  const qs = [buy(g, 203, 1e6, 5, 'station'), buy(g, 103, 9e5, 5, 'solarsystem')];
  const best = plan(run(g, {lots:[hold('A', 1, 10)], ships:[ship('A', 101, g)], quotes:{1:qs}}), 'best');
  assert.deepEqual(best.ships[0].stops.map(s => s.station), [203]);
  assert.deepEqual(sales(best).map(x => [x.order, x.qty, x.orderLoc]), [[qs[0].order, 5, 203], [qs[1].order, 5, 103]]);
  assert.deepEqual(best.ships[0].route, [1, 2, 3]);
});

test('min volume: a sale is at least the minimum, or all that is left of the order', () => {
  const g = line(2);
  const at = (volume, min) => { const quotes = {1:[buy(g, 101, 200, volume, 'station', min), buy(g, 101, 100, 100)]}; return [plan(run(g, {lots:[hold('A', 1, 30)], ships:[ship('A', 101, g)], quotes}), 'here'), quotes[1]]; };
  let [p, [high, low]] = at(100, 50);
  assert.deepEqual(sales(p).map(x => [x.order, x.qty]), [[low.order, 30]], '30 units can’t fill a 50-unit minimum');
  [p, [high, low]] = at(20, 50);
  assert.deepEqual(sales(p).map(x => [x.order, x.qty]), [[high.order, 20], [low.order, 10]], 'only 20 left: all 20 is enough');
  [p, [high]] = at(100, 30);
  assert.deepEqual(sales(p).map(x => [x.order, x.qty]), [[high.order, 30]]);
});

test('one shared book: never sold twice across two ships or across stops', () => {
  const g = line(5);
  const quotes = {1:[buy(g, 101, 100, 120)]}, lots = [hold('A', 1, 100), hold('B', 1, 100)], ships = [ship('A', 101, g), ship('B', 101, g)];
  const out = run(g, {lots, ships, quotes});
  sound(out, {quotes, ships, lots});
  for (const p of out.plans) assert.equal(soldOf(p, 1), 120, p.key);
  const here = plan(out, 'here');
  assert.equal(here.unsold.reduce((v, u) => v + u.qty, 0), 80);
  assert.ok(here.unsold.every(u => u.reason === 'no buyer on route'));
  // One ship, a region order every stop can fill and a station order further on: the region order counts once.
  const q2 = {1:[buy(g, 103, 100, 50, 'region'), buy(g, 105, 90, 50), buy(g, 104, 95, 30)]}, l2 = [hold('A', 1, 200)], s2 = [ship('A', 101, g)];
  const o2 = run(g, {lots:l2, ships:s2, quotes:q2, options:{perJump:1}});
  sound(o2, {quotes:q2, ships:s2, lots:l2});
  const most = plan(o2, 'most');
  assert.equal(soldOf(most, 1), 130);
  // The region order reaches home already, so it fills there, once; the station orders fill where they are.
  assert.deepEqual(most.ships[0].stops.map(s => [s.station, s.sales.map(x => [x.order, x.qty])]), [[101, [[q2[1][0].order, 50]]], [104, [[q2[1][2].order, 30]]], [105, [[q2[1][1].order, 50]]]]);
});

test('the hold limit counts packaged m³; the best ISK per m³ goes aboard first', () => {
  const g = line(2);
  const quotes = {1:[buy(g, 101, 100, 1000)], 2:[buy(g, 101, 1000, 1000)]};
  const lots = [hangar(101, 1, 100, 5), hangar(101, 2, 10, 10)], ships = [ship('A', 102, g)];
  const out = run(g, {lots, ships, quotes, options:{perJump:1}});
  sound(out, {quotes, ships, lots});
  const best = plan(out, 'best'), stop = best.ships[0].stops[0];
  assert.equal(stop.station, 101);
  assert.deepEqual(stop.pickups.sort((a, b) => a.type - b.type), [{type:1, qty:55}, {type:2, qty:10}], '100 m³ of the dearer item, then 275 m³ of the other');
  assert.deepEqual(best.unsold, [{type:1, qty:45, reason:'no room', station:101}]);
  // What the ship already holds takes room too.
  const o2 = run(g, {lots:[...lots, hold('A', 3, 100, 2)], ships, quotes, options:{perJump:1}});
  assert.equal(plan(o2, 'best').ships[0].stops[0].pickups.reduce((v, x) => v + x.qty * (x.type === 1 ? 5 : 10), 0), 175);
});

test('a ship picks up from a hangar before it sells, and the trip starts there', () => {
  const g = line(5);
  const quotes = {1:[buy(g, 105, 1e6, 100)], 2:[buy(g, 105, 1e6, 100)]};
  const lots = [hangar(103, 1, 10), hold('A', 2, 5)], ships = [ship('A', 101, g)];
  const out = run(g, {lots, ships, quotes});
  sound(out, {quotes, ships, lots});
  const best = plan(out, 'best'), s = best.ships[0];
  assert.deepEqual(s.stops.map(x => [x.station, x.pickups.length, x.sales.length]), [[103, 1, 0], [105, 0, 2]]);
  assert.deepEqual(s.route, [1, 2, 3, 4, 5]);
  assert.equal(best.jumps, 4);
  assert.equal(soldOf(best, 1), 10);
  const here = plan(out, 'here');
  assert.deepEqual(here.unsold.find(u => u.type === 1), {type:1, qty:10, reason:'not picked up', station:103});
});

test('selling here: ranged orders that reach the station sell with no jumps', () => {
  const g = line(6);
  const quotes = {1:[buy(g, 104, 500, 100, 5)], 2:[buy(g, 106, 500, 100, 4)]};
  const out = run(g, {lots:[hold('A', 1, 10), hold('A', 2, 10)], ships:[ship('A', 101, g)], quotes, salesTax:0.04});
  const here = plan(out, 'here');
  assert.equal(here.jumps, 0); assert.equal(here.expectedLoss, 0);
  assert.equal(soldOf(here, 1), 10, 'three jumps inside a range of five');
  assert.equal(soldOf(here, 2), 0, 'five jumps is out of a range of four');
  assert.equal(here.net, 10 * 500 * 0.96);
  assert.deepEqual(here.ships[0].stops.map(s => s.station), [101]);
  assert.ok(Math.abs(here.soldShare - 0.5) < 1e-9, 'half the value sold');
});

test('together the fleet flies one route and pays its jumps once; split each ship goes its own way', () => {
  const g = line(5);
  const quotes = {1:[buy(g, 101, 1e6, 100)], 2:[buy(g, 105, 1e6, 100)]};
  const lots = [hold('A', 1, 10), hold('B', 2, 10)], ships = [ship('A', 103, g), ship('B', 103, g)];
  const split = plan(run(g, {lots, ships, quotes}), 'best');
  assert.deepEqual(split.ships.map(s => s.stops.map(x => x.station)), [[101], [105]]);
  assert.equal(split.jumps, 4, 'two ships, two jumps each');
  assert.equal(split.together, false);
  const out = run(g, {lots, ships, quotes, options:{together:true}});
  sound(out, {quotes, ships, lots});
  const fleet = plan(out, 'best');
  assert.equal(fleet.together, true);
  assert.deepEqual(fleet.ships[0].route, fleet.ships[1].route);
  assert.equal(fleet.ships[0].route.length - 1, 6);
  assert.equal(fleet.jumps, 6, 'the fleet route, counted once');
  assert.equal(fleet.net, split.net);
  assert.ok(Math.abs(fleet.score - (fleet.net - fleet.expectedLoss - 6e6)) < 1e-6);
});

test('return home adds the trip back', () => {
  const g = line(4);
  const quotes = {1:[buy(g, 103, 1e7, 100)]}, lots = [hold('A', 1, 10)], ships = [ship('A', 101, g)];
  const away = plan(run(g, {lots, ships, quotes}), 'best');
  assert.deepEqual(away.ships[0].route, [1, 2, 3]); assert.equal(away.jumps, 2);
  const back = plan(run(g, {lots, ships, quotes, options:{returnHome:true}}), 'best');
  assert.deepEqual(back.ships[0].route, [1, 2, 3, 2, 1]); assert.equal(back.jumps, 4);
  assert.deepEqual(back.ships[0].stops.map(s => s.station), [103]);
  assert.ok(back.score < away.score);
});

test('the price per jump decides which plan is best', () => {
  const g = line(5);
  const quotes = {1:[buy(g, 101, 90, 1e4), buy(g, 105, 100, 1e4)]}, lots = [hold('A', 1, 1000)], ships = [ship('A', 101, g)];
  const cheap = run(g, {lots, ships, quotes, options:{perJump:100}}), dear = run(g, {lots, ships, quotes, options:{perJump:1e6}});
  assert.deepEqual(plan(cheap, 'best').ships[0].stops.map(s => s.station), [105]);
  assert.equal(plan(dear, 'best').key, 'here');
  assert.equal(plan(dear, 'most').jumps, 4, 'the most ISK is still offered');
  assert.equal(plan(dear, 'most').net, 1e5);
});

test('a floor stops sales below it, and the planner never sells for nothing', () => {
  const g = line(2);
  const quotes = {1:[buy(g, 101, 50, 100), buy(g, 101, 0, 100)], 2:[buy(g, 101, 70, 100), buy(g, 101, 40, 100)]};
  const lots = [hold('A', 1, 10), hold('A', 2, 20)], ships = [ship('A', 101, g)];
  const out = run(g, {lots, ships, quotes, options:{floor:new Map([[1, 60], [2, 60]])}}), here = plan(out, 'here');
  assert.equal(soldOf(here, 1), 0);
  assert.deepEqual(sales(here).map(x => [x.type, x.qty, x.price]), [[2, 20, 70]]);
  assert.deepEqual(here.unsold, [{type:1, qty:10, reason:'below floor', pilot:'A'}]);
  assert.deepEqual(out.notes, [{kind:'below-floor', type:1, floor:60, best:50}]);
  assert.deepEqual(out.unsold, [{type:1, qty:10, reason:'below floor'}]);
  assert.equal(soldOf(plan(run(g, {lots, ships, quotes, options:{floor:new Map([[1, 40]])}}), 'here'), 1), 10);
});

test('notes: thin books, no buyer within range, no quotes', () => {
  const g = line(8);
  const quotes = {1:[buy(g, 101, 100, 100)], 2:[buy(g, 108, 100, 100)]};
  const lots = [hold('A', 1, 60), hold('A', 2, 5), hold('A', 3, 5)];
  const out = run(g, {lots, ships:[ship('A', 101, g)], quotes, options:{maxJumps:5}});
  assert.deepEqual(out.notes.map(n => [n.kind, n.type]).sort(), [['no-buyer', 2], ['no-quotes', 3], ['thin', 1]]);
  assert.equal(out.notes.find(n => n.kind === 'thin').share, 0.6);
  assert.deepEqual(out.unsold.map(u => [u.type, u.reason]).sort(), [[2, 'no buyer in range'], [3, 'no quotes']]);
  assert.equal(out.plans.length, 1, 'nothing worth flying for: only selling here');
});

test('low-sec stays closed unless allowed', () => {
  const g = line(5, {sec:i => i === 3 ? 0.3 : 0.9});
  const quotes = {1:[buy(g, 105, 1e7, 100)]}, lots = [hold('A', 1, 10)], ships = [ship('A', 101, g)];
  assert.equal(plan(run(g, {lots, ships, quotes}), 'best').key, 'here');
  const open = plan(run(g, {lots, ships, quotes, options:{lowsec:true}}), 'best');
  assert.deepEqual(open.ships[0].route, [1, 2, 3, 4, 5]);
  assert.ok(open.expectedLoss > 0);
});

test('worked example: two Coercers docked together with a hangar load bigger than one hold', () => {
  // Home is station 101; a better market sits two jumps away at 103, and a region-wide ore order covers everything.
  const g = line(5);
  const quotes = {
    1:[buy(g, 101, 8e5, 100), buy(g, 103, 1e6, 30)],              // modules, 5 m³ each
    2:[buy(g, 101, 2e4, 1000), buy(g, 104, 2.6e4, 250, 'region')], // ore, 1 m³ each
    3:[buy(g, 103, 3e6, 20, 'solarsystem')]                         // something already aboard Fiofka
  };
  const lots = [hangar(101, 1, 50, 5), hangar(101, 2, 400, 1), hold('Fiofka', 3, 20, 2)];
  const ships = [ship('Fiofka', 101, g), ship('Decxus', 101, g)];
  const out = run(g, {lots, ships, quotes, salesTax:0.036});
  sound(out, {quotes, ships, lots});
  const here = plan(out, 'here'), best = plan(out, 'best');
  assert.equal(here.jumps, 0);
  assert.equal(soldOf(here, 3), 0, 'item 3 only sells in system 3');
  const picked = best.ships.flatMap(s => s.stops.flatMap(st => st.pickups));
  assert.ok(best.ships.every(s => s.stops[0].station === 101 && s.stops[0].pickups.length), 'both ships load at home');
  assert.ok(picked.filter(x => x.type === 1).reduce((v, x) => v + x.qty, 0) + picked.filter(x => x.type === 2).reduce((v, x) => v + x.qty, 0) / 5 <= 50 + 80, 'never more than the hangar holds');
  assert.equal(soldOf(best, 3), 20);
  assert.ok(sales(best).filter(x => x.order === quotes[1][1].order).reduce((v, x) => v + x.qty, 0) <= 30, 'the 30-unit order at 103 is filled once, across both ships');
  assert.ok(best.score > here.score && best.net > here.net);
  assert.ok(best.soldShare > 0.9);
  for (const p of out.plans) assert.ok(Math.abs(p.score - (p.net - p.expectedLoss - 1e6 * p.jumps)) < 1e-3, `${p.key}: score = net − loss − jumps × ISK per jump`);
  // Unsold hangar units stay in the hangar with a reason; what is sold plus what is left is what there was.
  for (const p of out.plans) for (const type of [1, 2]) {
    const left = p.unsold.filter(u => u.type === type).reduce((v, u) => v + u.qty, 0);
    assert.equal(soldOf(p, type) + left, type === 1 ? 50 : 400, `${p.key} type ${type}`);
  }
  assert.deepEqual(out.plans.map(p => p.key).slice(0, 1), ['here']);
  assert.equal(new Set(out.plans.map(p => JSON.stringify(p.ships))).size, out.plans.length, 'no plan twice');
});

// The synthetic New Eden: two ships in one station, 40 item types in the holds and the hangar, live buy orders with
// every kind of range.
const data = syntheticMarket(), G = graph(data.universe), market = book(data.regions);
const RANGES = ['station', 'solarsystem', 'region', 1, 2, 3, 5, 10, 'region', 'station', 20, 40];
const types = [...market.items.keys()].slice(0, 40), bigQuotes = new Map();
for (const t of types) bigQuotes.set(t, market.items.get(t).buys.map((b, k) => ({order:t * 100 + k, loc:b.loc, system:market.stations.get(b.loc).system, region:market.stations.get(b.loc).region, price:b.price, volume:b.volume % 500 + 5, minVolume:k % 4 === 0 ? 10 : 1, range:RANGES[(t + k) % RANGES.length]})));
const [homeLoc, homeStation] = [...market.stations][0];
const bigLots = types.map((t, i) => ({type:t, qty:5 + i % 7, m3:Math.max(0.1, data.types[t].v / 10), from:i % 3 === 0 ? {kind:'ship', pilot:i % 2 ? 'Fiofka' : 'Decxus'} : {kind:'hangar', station:homeLoc}}));
const bigShips = ['Fiofka', 'Decxus'].map(pilot => ({pilot, capacity:375, system:homeStation.system, station:homeLoc}));
const bigInput = {lots:bigLots, ships:bigShips, quotes:bigQuotes, stations:market.stations, salesTax:0.036, risk:{now:1e12}, options:{}};

test('the sell planner stays fast on a New Eden sized map', () => {
  const input = {...bigInput, g:G, risk:{history:data.risk, now:1e12}};
  const times = [], outs = [];
  for (let k = 0; k < 3; k++) { const t = performance.now(); outs.push(planSell(input)); times.push(performance.now() - t); }
  // About 60–120 ms on a laptop; the budget only catches a fall back to per-pair searches or an exponential search.
  assert.ok(Math.min(...times) < 1500, `planSell took ${Math.round(Math.min(...times))} ms`);
  const out = outs[0];
  assert.deepEqual(outs[2], out, 'the same plans every time');
  const keys = out.plans.flatMap(p => [p.key, ...p.also]);
  for (const k of ['here', 'best', 'most']) assert.ok(keys.includes(k), k);
  assert.ok(out.plans.length <= 6);
  sound(out, {quotes:Object.fromEntries(bigQuotes), ships:bigShips, lots:bigLots});
  const best = plan(out, 'best'), most = plan(out, 'most');
  assert.ok(best.score >= plan(out, 'here').score && most.net >= best.net);
  for (const p of out.plans) for (const s of p.ships) assert.ok(s.jumps <= 15, 'within maxJumps');
  for (const opts of [{together:true}, {returnHome:true, lowsec:true}]) sound(planSell({...input, options:opts}), {quotes:Object.fromEntries(bigQuotes), ships:bigShips, lots:bigLots});
});

test('the Sell plan runs the same through the Worker message and in the page fallback', async () => {
  const {planSellInWorker, snapshotOf} = await import('../ui/haulplan.js');
  const marketData = {universe:data.universe, meta:{data:{risk:{s:data.risk}, activity:{}}}}, snapshot = snapshotOf(marketData);
  const input = {...bigInput, risk:{live:new Map([[homeStation.system, {gates:{}, sb:0, dictor:0}]]), now:1e12}, options:{floor:new Map([[types[0], 1]])}};
  const direct = planSell({...input, g:G, risk:{history:snapshot.history, traffic:snapshot.traffic, ...input.risk}});
  // No Worker in Node: the fallback plans on the page's own graph.
  assert.deepEqual(await planSellInWorker(G, snapshot, input), direct);
  // The message is plain data (it survives a structured clone) and plans the same.
  const msg = structuredClone(toSellMessage(input));
  assert.deepEqual(planSellMessage(G, {...msg, risk:{history:snapshot.history, traffic:snapshot.traffic, ...msg.risk}}), direct);
  // The Worker's side: setup once, then a 'sell' message; the haul protocol is untouched.
  const out = []; globalThis.self = {postMessage:m => out.push(m)};
  await import('../ui/haulworker.js');
  globalThis.self.onmessage({data:{setup:snapshot}});
  await globalThis.self.onmessage({data:{id:7, key:snapshot.key, sell:msg}});
  await globalThis.self.onmessage({data:{id:8, key:snapshot.key + 1, sell:msg}});
  assert.equal(out[0].id, 7);
  assert.deepEqual(out[0].sell, direct);
  assert.match(out[1].error, /no map/);
  delete globalThis.self;
});
