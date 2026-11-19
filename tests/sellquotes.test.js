import test from 'node:test';
import assert from 'node:assert/strict';
import {graph} from '../route.js';

// ui/state.js reads the browser at load; the quote code only needs these.
globalThis.localStorage ??= {getItem:() => null, setItem() {}};
globalThis.matchMedia ??= () => ({matches:false});
globalThis.location ??= {href:'http://x/'};
const {candidateRegions, toQuote, createQuotes, typeInfo, resetTypeInfo} = await import('../ui/sellquotes.js');

const order = (id, price, extra = {}) => ({order_id:id, location_id:60000000 + id, system_id:1, price, volume_remain:10, min_volume:1, range:'station', ...extra});
// A fake ESI: pages of orders per "region:type"; counts calls and the most in flight at once.
function fake(books, {delay = 0, expires = null} = {}) {
  const f = {calls:[], active:0, peak:0, async fetch(region, type, page) {
    f.calls.push([region, type, page]); f.active++; f.peak = Math.max(f.peak, f.active);
    await new Promise(r => setTimeout(r, delay)); f.active--;
    const pages = books[`${region}:${type}`] || [[]];
    if (pages instanceof Error) throw pages;
    return {rows:pages[page - 1] || [], pages:pages.length, expires};
  }};
  return f;
}

test('orders map to the planner quote shape, with ranges as numbers', () => {
  assert.deepEqual(toQuote(order(5, 9.5, {range:'3', min_volume:4, volume_remain:77}), 10000002), {order:5, loc:60000005, system:1, region:10000002, price:9.5, volume:77, minVolume:4, range:3});
  assert.equal(toQuote(order(1, 1, {range:'region'}), 1).range, 'region');
  assert.equal(toQuote(order(1, 1, {range:'solarsystem'}), 1).range, 'solarsystem');
  assert.equal(toQuote(order(1, 1, {range:'40'}), 1).range, 40);
  assert.equal(toQuote({order_id:1, location_id:2, system_id:3, price:1, volume_remain:1, range:'station'}, 1).minVolume, 1);
});

test('candidate regions: the starts first, then the hubs, then what is within reach', () => {
  const g = graph({systems:{1:['A', 0.9, 100, [2]], 2:['B', 0.9, 100, [1, 3]], 3:['C', 0.9, 200, [2, 4]], 4:['D', 0.9, 300, [3, 5]], 5:['E', 0.9, 400, [4]], 6:['F', 0.9, 500, []]}, stations:[]});
  assert.deepEqual(candidateRegions(g, {starts:[2], hubs:[6]}), [100, 500]);
  assert.deepEqual(candidateRegions(g, {starts:[2], hubs:[6], maxJumps:2}), [100, 500, 200, 300]);
  assert.deepEqual(candidateRegions(g, {starts:[1], hubs:[], maxJumps:0}), [100]);
  assert.deepEqual(candidateRegions(g, {starts:[99], hubs:[7]}), [], 'unknown systems add nothing');
});

test('every page is fetched, and the book is cached for five minutes', async () => {
  const f = fake({'1:34':[[order(1, 5), order(2, 9)], [order(3, 7)]]});
  let t = 1000; const q = createQuotes({fetchPage:f.fetch, now:() => t});
  const a = await q.load([34], [1]);
  assert.deepEqual(a.quotes.get(34).map(x => x.price), [9, 7, 5], 'best price first, all pages');
  assert.equal(a.calls, 2);
  t += 299000; const b = await q.load([34], [1]);
  assert.equal(b.calls, 0); assert.equal(b.cached, 1); assert.equal(f.calls.length, 2);
  assert.equal(b.at, 1000, 'the quote age is when it was fetched');
  t += 2000; assert.equal((await q.load([34], [1])).calls, 2, 'refetched after five minutes');
});

test('ESI Expires shortens the cache', async () => {
  const f = fake({'1:34':[[order(1, 5)]]}, {expires:61000});
  let t = 1000; const q = createQuotes({fetchPage:f.fetch, now:() => t});
  await q.load([34], [1]); t = 60000;
  assert.equal((await q.load([34], [1])).cached, 1);
  t = 62000; assert.equal((await q.load([34], [1])).cached, 0);
});

test('without X-Pages a full page means another, and a short page is the last', async () => {
  const full = Array.from({length:1000}, (_, i) => order(i + 1, 1)), calls = [];
  const q = createQuotes({fetchPage:async (r, t, page) => { calls.push(page); return {rows:page === 1 ? full : [order(5000, 2)], pages:null, expires:null}; }});
  const out = await q.load([34], [1]);
  assert.deepEqual(calls, [1, 2]); assert.equal(out.quotes.get(34).length, 1001);
});

test('the same book asked twice at once is one call', async () => {
  const f = fake({'1:34':[[order(1, 5)]]}, {delay:10});
  const q = createQuotes({fetchPage:f.fetch});
  const [a, b] = await Promise.all([q.load([34], [1]), q.load([34], [1])]);
  assert.equal(f.calls.length, 1); assert.equal(a.quotes.get(34).length, 1); assert.equal(b.quotes.get(34).length, 1);
});

test('at most six calls run at a time', async () => {
  const f = fake({}, {delay:5});
  await createQuotes({fetchPage:f.fetch}).load([34, 35, 36, 37], [1, 2, 3, 4, 5]);
  assert.equal(f.calls.length, 20); assert.ok(f.peak <= 6 && f.peak >= 2, `peak ${f.peak}`);
});

test('a plan stops at 150 calls and says so; what it skipped is the least relevant', async () => {
  const f = fake({}), regions = Array.from({length:40}, (_, i) => i + 1);
  const out = await createQuotes({fetchPage:f.fetch}).load([1, 2, 3, 4], regions);
  assert.equal(f.calls.length, 150); assert.equal(out.calls, 150); assert.equal(out.capped, true); assert.equal(out.skipped, 10);
  const asked = new Set(f.calls.map(c => c[0]));
  assert.ok(asked.has(1) && !asked.has(40), 'earlier regions go first');
  assert.equal((await createQuotes({fetchPage:fake({}).fetch}).load([1], [1, 2])).capped, false);
});

test('a failed book is reported and the rest still arrive; a rate limit stops the plan', async () => {
  const bad = Object.assign(new Error('x'), {status:500}), f = fake({'1:34':bad, '2:34':[[order(1, 5)]]});
  const out = await createQuotes({fetchPage:f.fetch}).load([34], [1, 2]);
  assert.deepEqual(out.failed, [{region:1, type:34, status:500}]); assert.equal(out.quotes.get(34).length, 1);
  const limited = Object.assign(new Error('x'), {status:420}), g = fake({'1:34':limited});
  const done = await createQuotes({fetchPage:g.fetch, concurrency:1}).load([34], [1, 2, 3]);
  assert.equal(g.calls.length, 1); assert.equal(done.skipped, 2);
});

test('type info: packaged volume first, hull capacity, one call per type', async () => {
  resetTypeInfo();
  const asked = [], rows = {34:{name:'Tritanium', volume:0.01, packaged_volume:0.01}, 16236:{name:'Coercer', volume:92000, packaged_volume:5000, capacity:375}, 9:{name:'Odd', volume:3}};
  const get = async id => { asked.push(id); if (!rows[id]) throw new Error('404'); return rows[id]; };
  const out = await typeInfo([34, 16236, 9], get);
  assert.deepEqual([...out.keys()], [34, 16236, 9]);
  assert.equal(out.get(16236).volume, 5000); assert.equal(out.get(16236).capacity, 375); assert.equal(out.get(9).volume, 3);
  await typeInfo([34, 16236], get); assert.equal(asked.filter(x => x === 34).length, 1);
});
