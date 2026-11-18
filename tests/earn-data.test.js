import test from 'node:test';
import assert from 'node:assert/strict';
import {owned, ownedLabel, library} from '../blueprints.js';
import {colony, colonies, extractor, storage, planetName, SOON} from '../colonies.js';
import {brokerFee, feeBook, standingOf} from '../standings.js';
import {evaluate, rank, wingAssign, buildSeconds} from '../industry.js';
import {book, stationTrades, manufacturing} from '../market.js';

const rows = [[2456, 1, 0, 8, 12, 0, 60003760], [3000, 0, 2, 4, 6, 7, 60003760], [3000, 0, 0, 0, 0, 0], [4000, 0, 1, 0, 0, 1]];
test('blueprints: an original beats a copy, and labels say what the pilot has', () => {
  const m = owned(rows);
  assert.equal(m.get(2456).kind, 'bpo');assert.equal(ownedLabel(m.get(2456)), 'Owned (ME 8/TE 12)');
  assert.equal(ownedLabel(m.get(4000)), 'Copy, 1 run');assert.equal(ownedLabel(owned([[1, 0, 1, 0, 0, 3]]).get(1)), 'Copy, 3 runs');
  assert.equal(owned(undefined).size, 0);
});
test('the blueprint library filters by name, kind, ME and TE, originals first', () => {
  const names = {2456: 'Hobgoblin I Blueprint', 3000: 'Tritanium Blueprint', 4000: 'Atron Blueprint'};
  const all = library(rows, id => names[id]);
  assert.deepEqual(all.map(b => b.name), ['Hobgoblin I Blueprint', 'Atron Blueprint', 'Tritanium Blueprint']);
  assert.deepEqual(library(rows, id => names[id], 'copy').map(b => b.type), [3000, 4000].sort((a, b) => names[a].localeCompare(names[b])) );
  assert.deepEqual(library(rows, id => names[id], 'hobgoblin').map(b => b.type), [2456]);
  assert.deepEqual(library(rows, id => names[id], 'me 8').map(b => b.type), [2456]);
  assert.equal(library([[9, 1, 0, 0, 0, 0]], () => undefined)[0].name, 'Type 9');
});

const JITA = 60003760;
const market = book([{data:{name:'The Forge', stations:{[JITA]:[30000142, 'Jita']}, types:{2454:{d:2000, s:[[JITA, 10000, 500]], b:[]}, 34:{d:1e7, s:[[JITA, 5, 1e7]], b:[]}}}}]);
const hob = {type:2454, bp:2456, n:'Hobgoblin I', cat:'Drone', q:1, t:300, rank:1, limit:300, price:250000, m:[[34, 1000]]};
const fees = {salesTax:0.075, brokerFee:0.03}, base = {book:market, adjusted:new Map([[34, 4]]), fees, index:0.01, researchIndex:0.01, levels:{massProduction:3}};
test('an owned original is not bought, starts from its own ME and is researched only up to the target', () => {
  const none = evaluate(hob, base), bpo = evaluate(hob, {...base, owned:() => ({kind:'bpo', me:4, te:0})}), done = evaluate(hob, {...base, owned:() => ({kind:'bpo', me:10, te:20})});
  assert.equal(bpo.price, 0);assert.equal(bpo.listPrice, 250000);assert.equal(bpo.research.from, 4);assert.equal(bpo.me, 10);
  assert.ok(bpo.research.cost < none.research.cost && bpo.research.seconds < none.research.seconds);
  assert.ok(Math.abs(bpo.payback - (bpo.research.cost / bpo.profitDay + bpo.research.seconds / 86400)) < 1e-9, 'payback has no blueprint price');
  assert.ok(bpo.invest < none.invest);
  assert.equal(done.research.cost, 0);assert.equal(done.research.seconds, 0);
});
test('an owned copy uses its own ME, is never researched and caps the batch at its runs', () => {
  const bpc = evaluate(hob, {...base, owned:() => ({kind:'bpc', me:2, te:10, runs:3})});
  assert.equal(bpc.me, 2);assert.equal(bpc.research.cost, 0);assert.equal(bpc.runs, 3);assert.equal(bpc.unitsPerDay, 3);
  assert.equal(bpc.price, 0);
  const none = evaluate(hob, base);assert.ok(bpc.materialCost > none.materialCost, 'ME 2 uses more material than ME 10');
});
test('time efficiency shortens builds and lifts the slot capacity', () => {
  assert.equal(buildSeconds(300, {}, 20), 240);assert.equal(buildSeconds(300, {}), 300);
  const m = book([{data:{name:'x', stations:{}, types:{2454:{d:1e6, s:[[1, 10000, 1]], b:[]}, 34:{d:1, s:[[1, 5, 1]], b:[]}}}}]);
  const a = evaluate(hob, {book:m, adjusted:new Map(), fees}), b = evaluate(hob, {book:m, adjusted:new Map(), fees, owned:() => ({kind:'bpo', me:0, te:20})});
  assert.ok(b.unitsPerDay > a.unitsPerDay);
});
test('the wing plan gives a product to the pilot who owns its blueprint, and never twice', () => {
  const pick = (bp, profitDay, own) => ({bp, n:`P${bp}`, profitDay, invest:100, affordable:true, profit:1, payback:1, margin:0.3, flags:[], ...(own ? {owned:{kind:'bpo'}} : {})});
  const me = [pick(1, 1000), pick(2, 500)], them = [pick(1, 900, true), pick(2, 400)];
  const [a, b] = wingAssign([{ranked:rank(me), slots:1, budget:1e6}, {ranked:rank(them), slots:1, budget:1e6}]);
  assert.deepEqual(b.chosen.map(c => c.bp), [1], 'the owner builds it');
  assert.deepEqual(a.chosen.map(c => c.bp), [2]);
  const [x, y] = wingAssign([{ranked:rank(me), slots:1, budget:1e6}, {ranked:rank(them.map(t => ({...t, owned:undefined})) ), slots:1, budget:1e6}]);
  assert.deepEqual([x.chosen[0].bp, y.chosen[0].bp], [1, 2], 'priority order when nobody owns one');
});

const now = Date.parse('2026-11-18T12:00:00Z'), iso = h => new Date(now + h * 3600000).toISOString();
test('extractors: expired, expiring within a day, running, and the rate per hour', () => {
  assert.equal(extractor([2268, iso(-1), 4], now).state, 'expired');
  assert.equal(extractor([2268, iso(23), 4], now).state, 'soon');assert.equal(extractor([2268, iso(25), 4], now).state, 'ok');
  assert.equal(extractor([2268, null, 4], now).state, 'unknown');
  assert.equal(extractor([2268, iso(30), 4, 1200, 1800], now).perHour, 2400);assert.equal(extractor([2268, iso(30), 4], now).perHour, null);
  assert.equal(SOON, 86400000);
});
test('storage fill is held volume over the hold, and unknown until every volume is', () => {
  const pins = {cap:12000, vault:[[2268, 600], [2073, 100]]};
  assert.deepEqual(storage(pins, id => ({2268:5, 2073:3})[id]), {cap:12000, held:3300, fill:0.275});
  assert.deepEqual(storage(pins, id => id === 2268 ? 5 : undefined), {cap:12000, held:null, fill:null});
  assert.equal(storage({}, () => 1), null);assert.equal(storage({cap:100, vault:[[1, 1000]]}, () => 1).fill, 1);
});
test('colonies: needing attention first, with level, pins and when the game last refreshed them', () => {
  const planets = [
    {id:1, type:'barren', system:1, level:3, num:9, updated:iso(-5), pins:{ext:[[2268, iso(40), 2, 600, 1800]], fac:[1], store:[], links:3}},
    {id:2, type:'lava', system:1, level:5, num:12, updated:iso(-30), pins:{ext:[[2268, iso(-2), 2], [2073, iso(10), 1]], fac:[], store:[], links:1}},
    {id:3, type:'gas', system:1, level:0, num:1, updated:iso(-1)}];
  const list = colonies(planets, now);
  assert.deepEqual(list.map(c => [c.id, c.worst]), [[2, 'expired'], [1, 'ok'], [3, null]]);
  const c = colony(planets[0], now);assert.equal(c.name, 'Barren');assert.equal(c.pinCount, 9);assert.equal(c.perHour, 1200);assert.equal(c.updated, now - 5 * 3600000);
  assert.equal(colony(planets[2], now).pending, true);assert.equal(planetName('storm'), 'Storm');
  assert.equal(colony(planets[1], now).ext[0].state, 'expired', 'the soonest expiry comes first');
});

test('broker fee: 3% less 0.3% per level, 0.03% per faction point and 0.02% per corporation point, never under 1%', () => {
  const eq = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  eq(brokerFee(), 0.03);eq(brokerFee(5), 0.015);eq(brokerFee(5, 5, 5), 0.015 - 0.0015 - 0.001);
  eq(brokerFee(5, 10, 10), 0.01);eq(brokerFee(5, 10, 10), 0.015 - 0.003 - 0.002);
  eq(brokerFee(5, 99, 99), 0.01, 'standings count to 10 and no more');eq(brokerFee(0, -10, -10), 0.03 + 0.003 + 0.002, 'bad standings raise it');
  eq(brokerFee(3, 0, 10), 0.03 - 0.009 - 0.002);
});
test('the fee book reads standings toward the station owner, and says when it could not', () => {
  const standings = [[500001, 'faction', 4], [1000035, 'npc_corp', 6], [3009, 'agent', 9]];
  const owner = loc => loc === 1 ? {corp:1000035, faction:500001} : loc === 2 ? {corp:1000035} : undefined;
  const b = feeBook({level:4, standings, owner});
  assert.equal(standingOf(standings, 500001, 'faction'), 4);assert.equal(standingOf(standings, 5, 'faction'), 0);
  assert.ok(Math.abs(b.at(1) - brokerFee(4, 4, 6)) < 1e-12);assert.equal(b.explain(1).applied, true);
  assert.ok(Math.abs(b.at(2) - brokerFee(4, 0, 6)) < 1e-12, 'a corporation without a faction');
  assert.deepEqual([b.explain(3).applied, b.explain(3).why, b.at(3)], [false, 'owner unknown', brokerFee(4)]);
  const noStand = feeBook({level:4, standings:undefined, owner});assert.equal(noStand.explain(1).applied, false);assert.equal(noStand.at(1), brokerFee(4));
});
test('station trades and builds use the fee at the station they trade in', () => {
  const m = book([{data:{name:'F', stations:{1:[1, 'A'], 2:[1, 'B']}, types:{34:{d:1000, s:[[1, 110, 1e5], [2, 110, 1e5]], b:[[1, 100, 1e5], [2, 100, 1e5]]}, 35:{d:1, s:[[1, 5, 1e5]], b:[]}}}}]);
  const lo = stationTrades(m, {salesTax:0.05, brokerFee:0.03, brokerAt:loc => loc === 1 ? 0.01 : 0.03});
  assert.deepEqual(lo.map(x => x.loc), [1], 'station 2 loses money at 3%');
  assert.ok(Math.abs(lo[0].unit - (110 * (1 - 0.05 - 0.01) - 100 * 1.01)) < 1e-9);
  const plain = stationTrades(m, {salesTax:0.05, brokerFee:0.02});assert.ok(Math.abs(plain[0].unit - (110 * 0.93 - 102)) < 1e-9);
  const recipes = {34:{q:1, m:[[35, 1]]}};
  const mf = manufacturing(m, recipes, {salesTax:0.05, brokerFee:0.03, brokerAt:() => 0.01, adjusted:new Map()});
  assert.ok(Math.abs(mf[0].revenue - 110 * 0.94) < 1e-9);
});
