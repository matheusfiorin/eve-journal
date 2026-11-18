import test from 'node:test';
import assert from 'node:assert/strict';
// ui/ modules touch the browser at import time: give them just enough of it.
const store = new Map();
globalThis.localStorage = {getItem:k => store.get(k) ?? null, setItem:(k, v) => store.set(k, String(v)), removeItem:k => store.delete(k)};
globalThis.matchMedia = () => ({matches:false});
globalThis.location = {href:'https://example.test/app/'};
// A fake ESI that counts its calls. bad: station ids that answer 500.
const calls = [], bad = new Set();
globalThis.fetch = async url => {
  const u = String(url); calls.push(u);
  await new Promise(r => setTimeout(r, 1));
  const station = u.match(/universe\/stations\/(\d+)\//), corp = u.match(/corporations\/(\d+)\//);
  const json = body => new Response(JSON.stringify(body), {status:200, headers:{'Content-Type':'application/json'}});
  if (station) return bad.has(Number(station[1])) ? new Response('{}', {status:500}) : json({owner:1000000 + Number(station[1]) % 3});
  if (corp) return json({faction_id:500001});
  throw new Error(`unexpected ${u}`);
};
let n = 0;
const fresh = () => import(`../ui/brokers.js?${n++}`); // a new module instance reads localStorage again, like a page load
const stationCalls = () => calls.filter(u => /universe\/stations\//.test(u)).length;

test('owners are asked for once per station, and concurrent callers share the request in flight', async () => {
  const {resolveOwners, ownerOf} = await fresh();
  calls.length = 0;
  const [a, b] = await Promise.all([resolveOwners([60000001, 60000002, 60000001]), resolveOwners([60000002, 60000003])]);
  assert.equal(stationCalls(), 3, 'three stations, three requests, however many callers');
  assert.ok(a && b);assert.deepEqual(ownerOf(60000001), {corp:1000001, faction:500001});
  calls.length = 0;assert.equal(await resolveOwners([60000001, 60000002, 60000003]), false);assert.equal(calls.length, 0, 'known ones cost nothing');
  assert.equal(stationCalls(), 0);
  assert.equal(await resolveOwners([30000142, 12]), false, 'ids that are not NPC stations are never asked');assert.equal(calls.length, 0);
});

test('a failed station is not asked again for 24 hours, even after a reload', async () => {
  bad.add(60000009);
  const first = await fresh();calls.length = 0;
  assert.equal(await first.resolveOwners([60000009]), false);assert.equal(stationCalls(), 1);
  assert.equal(await first.resolveOwners([60000009]), false);assert.equal(stationCalls(), 1, 'not again in this page');
  const reloaded = await fresh();
  await reloaded.resolveOwners([60000009]);assert.equal(stationCalls(), 1, 'not again after a reload');
  assert.ok(JSON.parse(store.get('eve.station-owners-failed:v1')).some(([id]) => id === 60000009));
  // A day later it is tried again, and success clears the failure.
  bad.delete(60000009);
  assert.equal(await reloaded.resolveOwners([60000009], Date.now() + 25 * 3600000), true);assert.equal(stationCalls(), 2);
  assert.deepEqual(reloaded.ownerOf(60000009).faction, 500001);
  assert.ok(!JSON.parse(store.get('eve.station-owners-failed:v1')).some(([id]) => id === 60000009));
});

test('the fee book waits for the hubs only, not for every station in the market book', async () => {
  const {brokerFor, learnOwners} = await fresh();
  const stations = new Map([[60003760, {system:30000142}], [60008494, {system:30002187}], [60011866, {system:30002659}]]);
  for (let i = 0; i < 300; i++) stations.set(60100000 + i, {system:30000001 + i});
  calls.length = 0;
  const broker = await brokerFor({private:true, ops:{}}, null, {}, {stations});
  assert.equal(broker.hubs.length, 3);assert.equal(stationCalls(), 3, '3 hub stations out of 303, not 303');
  // Rows on screen ask for theirs, and a redraw is requested once.
  calls.length = 0;let redraws = 0;
  await learnOwners([60100001, 60100002, 60003760], () => redraws++);
  assert.equal(stationCalls(), 2);assert.equal(redraws, 1);
  await learnOwners([60100001, 60100002], () => redraws++);assert.equal(redraws, 1, 'nothing new, no redraw');
});
