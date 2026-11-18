import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOrder, daysLeft, outcome, historySummary} from '../orders.js';
import {compactOrders, compactHistory, compactContracts, compactBlueprints, compactStandings, summarizeKill, summarizePins, stepKillmails, stepPlanets, diffEvents, fitCollector, MAX_ORDERS, MAX_CONTRACTS} from '../worker/pilotdata.js';

const JITA = 60003760, AMARR = 60008494, now = Date.parse('2026-11-18T12:00:00Z');
const regions = [{region: 10000002, data: {types: {34: {s: [[JITA, 5, 1e6], [60000001, 6, 10]], b: [[JITA, 4.6, 1e6]]}, 35: {s: [[60000001, 12, 5]], b: []}}}}];
const order = (extra = {}) => ({order_id: 1, type_id: 34, location_id: JITA, region_id: 10000002, is_buy_order: false, price: 5, volume_remain: 10, volume_total: 20, issued: '2026-11-10T12:00:00Z', duration: 90, ...extra});

test('a sell order at the lowest ask is the best price, a higher one is outbid by the difference', () => {
  assert.deepEqual(checkOrder(order(), regions), {state: 'best'});
  assert.deepEqual(checkOrder(order({price: 5.004}), regions), {state: 'best'}, 'within half a cent counts as equal');
  const out = checkOrder(order({price: 7.5}), regions);assert.equal(out.state, 'outbid');assert.equal(out.scope, 'station');assert.equal(out.by, 2.5);
  assert.deepEqual(checkOrder(order({price: 4}), regions), {state: 'best'}, 'cheaper than the market is not outbid');
});
test('a buy order loses to a higher bid', () => {
  assert.deepEqual(checkOrder(order({is_buy_order: true, price: 4.6}), regions), {state: 'best'});
  const out = checkOrder(order({is_buy_order: true, price: 4}), regions);assert.equal(out.state, 'outbid');assert.ok(Math.abs(out.by - 0.6) < 1e-9);
});
test('a station that is not in the snapshot is compared with the best in its region', () => {
  const out = checkOrder(order({location_id: 1035466617946, price: 5.5}), regions);assert.deepEqual([out.state, out.scope, out.by], ['outbid', 'region', 0.5]);
  assert.deepEqual(checkOrder(order({location_id: 1035466617946, price: 5}), regions), {state: 'best'});
});
test('an unknown region or an item the snapshot does not hold is not checked', () => {
  assert.deepEqual(checkOrder(order({region_id: 10000043}), regions), {state: 'unchecked'});
  assert.deepEqual(checkOrder(order({type_id: 999}), regions), {state: 'unchecked'});
  assert.deepEqual(checkOrder(order(), []), {state: 'unchecked'});
  assert.deepEqual(checkOrder(order(), undefined), {state: 'unchecked'});
  assert.deepEqual(checkOrder(order({is_buy_order: true, type_id: 35, price: 1}), regions), {state: 'best'}, 'an item with no bids at all has nobody above you');
});
test('days left counts up to the expiry and never goes below zero', () => {
  assert.equal(daysLeft(order({issued: '2026-11-10T12:00:00Z', duration: 90}), now), 82);
  assert.equal(daysLeft(order({issued: '2026-11-18T06:00:00Z', duration: 1}), now), 1);
  assert.equal(daysLeft(order({issued: '2026-01-01T00:00:00Z', duration: 3}), now), 0);
});
test('history: filled, expired and cancelled, with the ISK that changed hands in the last 30 days', () => {
  const list = [order({volume_remain: 0, volume_total: 10, price: 100}), order({volume_remain: 4, volume_total: 10, price: 10, state: 'expired', is_buy_order: true}), order({state: 'cancelled'}), order({issued: '2026-06-01T00:00:00Z', duration: 90, volume_remain: 0})];
  assert.deepEqual([outcome(list[0]), outcome(list[1]), outcome(list[2])], ['filled', 'expired', 'cancelled']);
  assert.deepEqual(historySummary(list, now), {filled: 1, expired: 1, cancelled: 1, sold: 1000 + 50, bought: 60});
  assert.deepEqual(historySummary(undefined, now), {filled: 0, expired: 0, cancelled: 0, sold: 0, bought: 0});
});

test('compaction keeps only the fields the app reads, and caps the lists', () => {
  assert.deepEqual(Object.keys(compactOrders([{...order(), junk: 1, min_volume: 1}])[0]).includes('junk'), false);
  assert.equal(compactOrders(Array.from({length: 500}, (_, i) => order({order_id: i}))).length, MAX_ORDERS);
  const open = Array.from({length: 150}, (_, i) => ({contract_id: i, type: 'courier', status: 'outstanding', date_issued: '2026-11-01T00:00:00Z'}));
  const list = compactContracts([{contract_id: 999, status: 'deleted'}, {contract_id: 1000, status: 'finished', date_issued: '2026-11-17T00:00:00Z'}, ...open]);
  assert.equal(list.length, MAX_CONTRACTS);assert.ok(!list.some(c => c.contract_id === 999));assert.equal(list[0].status, 'outstanding', 'open contracts come first');
  assert.equal(compactContracts([{contract_id: 1, status: 'outstanding', title: 'x'.repeat(500)}])[0].title.length, 60);
  assert.deepEqual(compactStandings([{from_id: 1, from_type: 'faction', standing: 0.123}, {from_id: 2, from_type: 'agent', standing: -5}, {from_id: 3, from_type: 'agent'}]), [[2, 'agent', -5], [1, 'faction', 0.12]]);
  assert.deepEqual(compactBlueprints([{type_id: 1, quantity: -1, runs: -1, material_efficiency: 10, time_efficiency: 4}, {type_id: 1, quantity: -2, runs: 3}, {type_id: 1, quantity: -2, runs: 2}]), {count: 3, types: [[1, 1, 2, 10, 4, 5]]});
  assert.equal(compactHistory([order({issued: '2025-01-01T00:00:00Z', duration: 90})], now).length, 0);
});
test('the fit collector keeps rows of the ship only and is bounded', () => {
  const c = fitCollector(1001);c.add([{type_id: 1, location_id: 1001, location_flag: 'LoSlot0', quantity: 1}, {type_id: 2, location_id: 7, location_flag: 'LoSlot0'}, {type_id: 3, location_id: 1001}]);
  assert.deepEqual(c.result(), {ship: 1001, items: [[1, 'LoSlot0', 1]]});
  assert.equal(fitCollector(undefined).result(), undefined);
  const big = fitCollector(1);big.add(Array.from({length: 1000}, () => ({type_id: 1, location_id: 1, location_flag: 'Cargo', quantity: 1})));assert.equal(big.result().items.length, 150);
});
test('killmail steps read each new kill once, spend only what the budget leaves, and queue the rest', async () => {
  const mk = id => ({victim: {character_id: id % 2 ? 7 : 8, ship_type_id: 605, damage_taken: 99}, solar_system_id: 30000142, killmail_time: `2026-11-1${id}T00:00:00Z`, attackers: [{final_blow: true, corporation_id: 55}]});
  let budget = 2;const read = [];
  const ctx = {id: 7, room: () => budget, get: async (kid) => { budget--; read.push(kid); return mk(kid); }};
  const list = [1, 2, 3, 4].map(i => ({killmail_id: i, killmail_hash: `h${i}`}));
  const first = await stepKillmails(list, undefined, ctx);
  assert.deepEqual(read, [1, 2]);assert.deepEqual(first.losses.map(l => l.id), [1]);assert.deepEqual(first.seen, [2]);assert.deepEqual(first.wait.map(w => w[0]), [3, 4]);
  budget = 5;read.length = 0;
  const second = await stepKillmails(undefined, first, ctx);
  assert.deepEqual(read, [3, 4]);assert.deepEqual(second.losses.map(l => l.id).sort(), [1, 3]);assert.deepEqual(second.wait, []);
  assert.equal(second.losses[0].ship, 605);assert.equal(second.losses[0].corp, 55);
  budget = 5;read.length = 0;await stepKillmails(list, second, ctx);assert.deepEqual(read, [], 'known kills are never read again');
  // A detail that fails stays in the queue and stops the step instead of burning the budget.
  let tries = 0;const flaky = await stepKillmails([{killmail_id: 9, killmail_hash: 'z'}], undefined, {id: 7, room: () => 9, get: async () => { tries++; throw new Error('503'); }});
  assert.equal(tries, 1);assert.deepEqual(flaky.wait, [[9, 'z']]);
});
test('a planet step reads the oldest pins first within the budget, and says when some are still missing', async () => {
  const list = [1, 2, 3].map(i => ({planet_id: i, planet_type: 'lava', solar_system_id: 9, upgrade_level: 2, num_pins: 3, last_update: 'x'}));
  let budget = 2;const read = [];
  const get = async p => { budget--; read.push(p); return {pins: [{extractor_details: {product_type_id: 2268, heads: [{}, {}]}, expiry_time: 'e'}, {factory_details: {schematic_id: 5}}, {contents: [{type_id: 1, amount: 3}, {type_id: 1, amount: 4}]}], links: [{}]}; };
  const a = await stepPlanets(list, undefined, {get, room: () => budget, now});
  assert.deepEqual(read, [1, 2]);assert.equal(a.pending, true);assert.deepEqual(a.planets[0].pins, {ext: [[2268, 'e', 2]], fac: [5], store: [[1, 7]], links: 1});
  budget = 9;read.length = 0;
  const b = await stepPlanets(undefined, a, {get, room: () => budget, now});
  assert.deepEqual(read, [3]);assert.equal(b.pending, false);
  budget = 9;read.length = 0;await stepPlanets(list, b, {get, room: () => budget, now: now + 10 * 60000});assert.deepEqual(read, [], 'fresh pins are not read again');
  await stepPlanets(list, b, {get, room: () => budget, now: now + 2 * 3600000});assert.deepEqual(read.sort(), [1, 2, 3], 'old pins are');
  assert.deepEqual(summarizePins({}), {ext: [], fac: [], store: [], links: 0});
  assert.equal(summarizeKill({killmail_id: 1, victim: {}, attackers: []}).attackers, 0);
});
test('events come from what changed between two syncs, are kept three days and are not repeated', () => {
  const o = (order_id, extra = {}) => ({order_id, type_id: 34, is_buy_order: false, issued: '2026-11-10T00:00:00Z', duration: 90, ...extra});
  const prior = {operations: {orders: {value: [o(1), o(2), o(3), o(4, {issued: '2026-08-20T12:00:00Z', duration: 90})]}, contracts: {value: [{contract_id: 7, status: 'outstanding'}, {contract_id: 8, status: 'in_progress'}]}, killmails: {value: {losses: [{id: 1}]}}}};
  const next = {operations: {orders: {value: []}, orderHistory: {value: [o(1, {volume_remain: 0}), o(2, {volume_remain: 5, state: 'expired'}), o(3, {state: 'cancelled', volume_remain: 4})]},
    contracts: {value: [{contract_id: 7, type: 'courier', status: 'in_progress'}, {contract_id: 8, type: 'courier', status: 'finished'}, {contract_id: 9, status: 'in_progress'}]}, killmails: {value: {losses: [{id: 2, ship: 605}, {id: 1}]}}}};
  const events = diffEvents(prior, next, now);
  assert.deepEqual(events.map(e => e.kind).sort(), ['contract-accepted', 'contract-completed', 'loss', 'order-expired', 'order-expired', 'order-filled']);
  assert.ok(!events.some(e => e.k === 'order-end:3'), 'a cancelled order is the pilot\'s own doing');
  assert.equal(events.find(e => e.kind === 'order-expired' && e.k === 'order-end:4').type, 34, 'gone with no history, within an hour of its end, is expiry');
  assert.deepEqual(diffEvents(undefined, next, now), [], 'the first sync is a baseline, not a flood');
  const later = diffEvents({...prior, events}, {operations: {}}, now + 2 * 86400000);assert.equal(later.length, events.length, 'kept for the alert pass');
  assert.equal(diffEvents({...prior, events}, {operations: {}}, now + 4 * 86400000).length, 0, 'and dropped after three days');
});
