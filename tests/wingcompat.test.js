// The wing room across app versions. The two pilots may run different builds against one backend, so:
//  - the room must accept every frame the app merged in PR #4 sent (android/app/src/test/resources/wing/v1-client-frames.json, which
//    WingCompatTest.kt proves is that app's exact output), and what it sends back must stay readable by that app;
//  - the frames the room sends are recorded in android/app/src/test/resources/wing/{room-frames,push-data}.json. This test fails when the
//    room drifts from them (UPDATE_FIXTURES=1 rewrites them after a deliberate change); WingCompatTest.kt decodes the same files with the
//    old and the current Kotlin protocol, and builds the notifications from the push data;
//  - a room database from before the status, ack and session types is migrated in place.
import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile, writeFile} from 'node:fs/promises';
import {generateKeyPairSync} from 'node:crypto';
import {WingRoom, PROTOCOL, SCHEMA_VERSION, STATUS_TTL} from '../worker/wingroom.js';

const FIO = 2124810474, DEC = 2124815118, JITA = 30000142, PERIMETER = 30000144, AMARR = 30002187, T0 = 1800000000000;
const dir = new URL('../android/app/src/test/resources/wing/', import.meta.url), read = async f => JSON.parse(await readFile(new URL(f, dir), 'utf8'));
const UPDATE = !!process.env.UPDATE_FIXTURES;
mock.timers.enable({apis: ['Date'], now: T0});
test.after(() => mock.timers.reset());

function fakeState(raw = new DatabaseSync(':memory:')) {
  const sockets = [];
  return {raw, sockets, storage: {sql: {exec(text, ...bind) { const st = raw.prepare(text); return {toArray: () => st.columns().length ? st.all(...bind) : (st.run(...bind), [])}; }}, setAlarm: async () => {}},
    acceptWebSocket(ws) { sockets.push(ws); }, getWebSockets: () => sockets.filter(w => !w.closed)};
}
function fakeSocket() { return {sent: [], closed: false, att: null, send(m) { this.sent.push(JSON.parse(m)); }, serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att; }, close() { this.closed = true; }, last(type) { return [...this.sent].reverse().find(m => m.type === type); }}; }
function room(env = {}, extra = {}, raw) { const state = fakeState(raw), r = new WingRoom(state, env, extra); return {state, r, join(pilot, name) { const ws = fakeSocket(); r.attach(ws, pilot, name); return ws; }}; }
const send = (r, ws, msg) => r.webSocketMessage(ws, JSON.stringify(msg));
// Random ids (session ids) become stable names, in order of appearance, so a recording can be compared.
const stable = value => { const seen = new Map(); return JSON.parse(JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, id => { if (!seen.has(id)) seen.set(id, `uuid-${seen.size + 1}`); return seen.get(id); })); };
async function matchesFixture(name, actual) {
  actual = stable(actual);
  if (UPDATE) await writeFile(new URL(name, dir), JSON.stringify(actual, null, 1) + '\n');
  assert.deepEqual(actual, await read(name), `${name} is out of date: the room's frames changed (UPDATE_FIXTURES=1 records them; check an app from PR #4 still reads them)`);
}

test('an app from PR #4 talks to the room: every frame it sends is accepted and answered in a shape it reads', async () => {
  const frames = await read('v1-client-frames.json'), {r, join} = room(), a = join(FIO, 'Fiofka'), b = join(DEC, 'Decxus');
  b.sent.length = 0;
  for (const [name, frame] of Object.entries(frames)) {
    a.sent.length = 0;
    await send(r, a, frame);
    assert.ok(!a.sent.some(m => m.type === 'error'), `${name}: ${JSON.stringify(a.sent)}`);
  }
  // The wingmate got them with the server's `from` and `at`, whatever the old app put there.
  assert.deepEqual(b.last('timer.remove').timer, {id: 'gas1', owner: FIO});
  assert.equal(b.last('plan.share').plan.title, 'Jita to Amarr'); assert.deepEqual(b.last('plan.share').plan.route, [JITA, PERIMETER, AMARR]);
  assert.deepEqual([b.last('ping').kind, b.last('ping').text, b.last('ping').from], ['undock', undefined, FIO], 'the last ping sent was the plain one');
  assert.equal(b.last('presence').presence.find(p => p.pilot === FIO).timers, 1);
  // A rejoin gets the old app's snapshot fields, with the plan and the pings in the flat shape it reads.
  const s = join(DEC, 'Decxus').sent[0];
  for (const k of ['type', 'from', 'at', 'timers', 'items', 'presence']) assert.ok(k in s, `state.${k} is still sent`);
  assert.deepEqual(s.items.map(i => i.type), ['plan.share', 'ping', 'ping']);
  assert.deepEqual(s.items[1], {type: 'ping', id: 'c5', from: FIO, at: T0, kind: 'custom', text: 'Bring paste', system: JITA});
  assert.equal(s.proto, PROTOCOL);
});

test('an app from before ops and adds reads a session that has them, and the room refuses what a newer or older app gets wrong', async () => {
  const {r, join} = room(), a = join(FIO, 'Fiofka'), b = join(DEC, 'Decxus');
  await send(r, a, {type: 'session.start', session: {activity: 'mining', goal: 5e8}});
  await send(r, a, {type: 'session.op', op: {id: 'g1', gas: 30375, startedAt: T0, units: 1, m3: 0.1, value: 36000, futureField: true}});
  await send(r, b, {type: 'session.add', amount: 5e6, newerField: 1});
  const s = a.last('session.update').session;
  // The old fields stay where they were, and the totals only gained keys.
  for (const k of ['id', 'activity', 'goal', 'startedBy', 'startedAt', 'contrib']) assert.ok(k in s, k);
  assert.deepEqual([s.contrib[FIO].mined, s.contrib[DEC].added, s.contrib[FIO].isk, s.contrib[FIO].timers], [36000, 5e6, 0, 0]);
  await send(r, a, {type: 'session.end'});
  assert.deepEqual(a.last('session.end').session.totals, {isk: 0, units: 0, timers: 0, systems: 0, mined: 36000, added: 5e6, value: 5036000});
  // An old session in storage (no ops, no adds) has zero totals and takes ops.
  await send(r, a, {type: 'session.start', session: {activity: 'mining'}});
  assert.ok(!('ops' in r.snapshot().session) && !('adds' in r.snapshot().session), 'a session without ops looks exactly as before');
});

test('a client that knows more or less than the room gets an error frame it can ignore, and nothing else changes', async () => {
  const {r, join} = room(), a = join(FIO, 'Fiofka'), b = join(DEC, 'Decxus'), before = b.sent.length;
  for (const type of ['teleport', 'timer.upsert.v9', '', undefined, 42]) await send(r, a, {type, id: 'x', anything: {nested: true}});
  assert.deepEqual([...new Set(a.sent.filter(m => m.type === 'error').map(m => m.code))], ['unknown_type']);
  assert.equal(b.sent.length, before, 'the wingmate hears nothing of it');
  // Fields a newer app adds to a known type are ignored, not refused.
  a.sent.length = 0;
  await send(r, a, {type: 'ping', kind: 'help', text: 'x', priority: 'urgent', v: 9, extra: {a: 1}});
  assert.ok(!a.sent.some(m => m.type === 'error')); assert.equal(b.last('ping').kind, 'help'); assert.ok(!('priority' in b.last('ping')));
  await send(r, a, {type: 'presence', timers: 2, online: true, battery: 40, proto: 3});
  assert.equal(b.last('presence').presence.find(p => p.pilot === FIO).timers, 2);
});

test('the room\'s frames are what the fixtures say (the Kotlin tests read the same files with the old and the new app)', async () => {
  const {r, join} = room(), a = join(FIO, 'Fiofka'), b = join(DEC, 'Decxus'), frames = {};
  const take = (type, label = type) => { frames[label] = b.last(type); };
  frames.state_empty = a.sent[0];
  await send(r, a, {type: 'timer.upsert', id: 'm1', timer: {id: 'gas1', kind: 'gas', label: 'Gas site', startedAt: T0, durationMs: 900000, meta: {site: 'Barren Perimeter Reservoir'}}}); take('timer.upsert');
  await send(r, a, {type: 'timer.remove', id: 'm2', timer: {id: 'gas1'}}); take('timer.remove');
  await send(r, a, {type: 'timer.upsert', id: 'm3', timer: {id: 'gas2', kind: 'gas', label: 'Gas site', startedAt: T0, durationMs: 900000}});
  await send(r, a, {type: 'ping', id: 'p1', kind: 'help', text: 'Tackled', system: JITA}); take('ping');
  await send(r, a, {type: 'plan.share', id: 'pl1', plan: {kind: 'haul', title: 'Jita to Amarr', summary: 'Two trips', route: [JITA, PERIMETER, AMARR]}}); take('plan.share');
  await send(r, a, {type: 'status', id: 's1', status: {system: JITA, docked: false, shipType: 17478, ship: 'Retriever', activity: 'mining', destination: AMARR, route: [JITA, PERIMETER, AMARR]}}); take('status');
  await send(r, b, {type: 'ack', id: 'k1', ref: 'p1', kind: 'onit'}); frames.ack = a.last('ack');
  await send(r, b, {type: 'session.start', id: 'ss1', session: {activity: 'mining', goal: 50000000, where: JITA, title: 'Belt run'}}); take('session.start');
  await send(r, b, {type: 'session.contrib', id: 'ss2', contrib: {isk: 1200000, units: 3400}}); take('session.update');
  await send(r, a, {type: 'session.op', id: 'op1', op: {id: 'gas2', timer: 'gas2', gas: 30375, startedAt: T0, units: 410, m3: 41, value: 14800000}}); take('session.update', 'session.update_op');
  await send(r, b, {type: 'session.add', id: 'ad1', amount: 12000000, note: 'Sold the paste'}); take('session.update', 'session.update_add');
  frames.state_rich = join(DEC, 'Decxus').sent[0];
  await send(r, a, {type: 'session.end', id: 'ss3'}); take('session.end');
  frames.state_after = join(DEC, 'Decxus').sent[0];
  await send(r, a, {type: 'status', id: 's2', status: {share: false}}); take('status', 'status_clear');
  await send(r, a, {type: 'nope'}); frames.error = a.last('error');
  take('presence');
  await matchesFixture('room-frames.json', frames);
});

test('the room\'s pushes say what happened in a shape the app reads, and carry no location', async () => {
  const calls = [], fetchImpl = async (url, init) => { calls.push({url: String(url), init}); return String(url).includes('oauth2') ? new Response(JSON.stringify({access_token: 'at', expires_in: 3600})) : new Response('{}'); };
  const raw = new DatabaseSync(':memory:');
  raw.exec(await readFile(new URL('../worker/migrations/0013_push_tokens.sql', import.meta.url), 'utf8'));
  raw.prepare('INSERT INTO push_tokens (token, character_id, updated_at) VALUES (?, ?, ?), (?, ?, ?)').run('t-dec', DEC, 1, 't-fio', FIO, 2);
  const DB = {prepare(sql) { return {bind(...v) { const st = raw.prepare(sql); return {all: async () => ({results: st.all(...v)}), run: async () => st.run(...v)}; }}; }};
  const key = generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey.export({type: 'pkcs8', format: 'pem'});
  const {r, join} = room({DB, FCM_SERVICE_ACCOUNT: JSON.stringify({client_email: 'svc@x', private_key: key}), FCM_PROJECT_ID: 'p'}, {fetchImpl});
  const out = {}, last = () => JSON.parse(calls.filter(c => c.url.includes('messages:send')).at(-1).init.body).message;
  const a = join(FIO, 'Fiofka'), b = join(DEC, 'Decxus');
  // The receiver has the app closed (their socket is shut), so the room pushes; the sender's own socket stays open.
  const as = async (sender, name, msg) => { const [mine, theirs] = sender === FIO ? [a, b] : [b, a]; mine.closed = false; theirs.closed = true; const n = calls.length; await send(r, mine, msg); if (calls.filter(c => c.url.includes('messages:send')).length > n) out[name] = last(); calls.length = 0; };
  await as(FIO, 'timer.start', {type: 'timer.upsert', timer: {id: 'g1', kind: 'gas', label: 'Gas site', startedAt: T0 - 1000, durationMs: 60000, meta: {where: JITA}}});
  await as(FIO, 'ping.help', {type: 'ping', id: 'p1', kind: 'help', system: JITA});
  await as(FIO, 'ping.custom', {type: 'ping', id: 'p2', kind: 'custom', text: 'Bring paste', system: JITA});
  await as(FIO, 'plan.share', {type: 'plan.share', id: 'pl1', plan: {kind: 'haul', title: 'Jita to Amarr', route: [JITA, PERIMETER, AMARR]}});
  await as(FIO, 'status', {type: 'status', status: {system: JITA, destination: AMARR, route: [JITA, AMARR], activity: 'hauling'}});
  await as(FIO, 'session.start', {type: 'session.start', session: {activity: 'mining', where: JITA, title: 'Belt run'}});
  await as(FIO, 'session.op', {type: 'session.op', op: {id: 'gas2', gas: 30375, startedAt: T0, units: 410, m3: 41, value: 14800000}});
  await as(FIO, 'session.add', {type: 'session.add', id: 'ad1', amount: 12000000, note: 'Sold the paste'});
  await as(DEC, 'ack.seen', {type: 'ack', ref: 'p1', kind: 'seen'});
  await as(DEC, 'ack.onit', {type: 'ack', ref: 'p1', kind: 'onit'});
  await as(DEC, 'ack.cant', {type: 'ack', ref: 'p2', kind: 'cant'});
  await as(DEC, 'ack.plan', {type: 'ack', ref: 'pl1', kind: 'onit'});
  await as(FIO, 'session.end', {type: 'session.end'});
  // A timer reaching its end tells the owner's wingmate.
  b.closed = true; a.closed = false; mock.timers.setTime(T0 + 61000); await r.alarm(); if (calls.length) out['timer.end'] = last();
  const data = Object.fromEntries(Object.entries(out).map(([k, m]) => [k, m.data]));
  assert.deepEqual(Object.keys(data), ['timer.start', 'ping.help', 'ping.custom', 'plan.share', 'session.start', 'session.add', 'ack.onit', 'ack.cant', 'ack.plan', 'session.end', 'timer.end'], 'a status and a plain "seen" never push; every other event does');
  for (const m of Object.values(out)) assert.equal(m.android.priority, 'high');
  // No location: not the system a ping was sent from, not a status or a plan's route, not a timer's site or a session's system.
  for (const [k, d] of Object.entries(data)) {
    assert.deepEqual(Object.keys(d).filter(x => /system|route|where|destination|dock|ship|meta/i.test(x)), [], `${k} carries a location field`);
    assert.ok(!Object.values(d).some(v => /3000\d{4}/.test(v)), `${k} carries a system id`);
  }
  await matchesFixture('push-data.json', data);
  mock.timers.setTime(T0);
});

test('a room database from before status, acknowledgements and sessions is migrated in place, and a second wake changes nothing', async () => {
  // What the room from PR #4 left in storage: the two tables it created, with a timer and a ping in them and no version row.
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE timers (id TEXT PRIMARY KEY, owner INTEGER NOT NULL, data TEXT NOT NULL, ends_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, notified INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE items (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);`);
  const t = {id: 'gas1', kind: 'gas', label: 'Gas site', startedAt: T0 - 60000, durationMs: 900000, owner: DEC, shared: true, meta: {}};
  raw.prepare('INSERT INTO timers VALUES (?, ?, ?, ?, ?, 0)').run('gas1', DEC, JSON.stringify(t), T0 + 840000, T0 + 840000 + 86400000);
  raw.prepare('INSERT INTO items (data) VALUES (?)').run(JSON.stringify({type: 'ping', id: 'old1', from: DEC, at: T0 - 5000, kind: 'omw'}));
  const {r, join} = room({}, {}, raw);
  const a = join(FIO, 'Fiofka'), s = a.sent[0];
  assert.deepEqual(s.timers.map(x => x.id), ['gas1']); assert.deepEqual(s.items.map(x => x.id), ['old1']);
  assert.deepEqual([s.statuses, s.session, s.sessions], [[], null, []]);
  const version = () => raw.prepare("SELECT value FROM room_meta WHERE key = 'schema'").get().value;
  assert.equal(version(), String(SCHEMA_VERSION));
  // The new features work on the migrated database, and an old item can be answered (its row has no acks yet).
  await send(r, a, {type: 'status', status: {system: JITA}}); await send(r, a, {type: 'session.start', session: {activity: 'mining'}});
  await send(r, a, {type: 'ack', ref: 'old1', kind: 'onit'});
  assert.equal(r.snapshot().items[0].acks[FIO].kind, 'onit'); assert.equal(r.snapshot().statuses.length, 1); assert.ok(r.snapshot().session);
  // The room wakes again (the Durable Object is evicted and rebuilt): same schema, same data, no error.
  const again = room({}, {}, raw).r.snapshot();
  assert.deepEqual(again.timers.map(x => x.id), ['gas1']); assert.equal(again.statuses.length, 1); assert.ok(again.session);
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
  assert.deepEqual(tables, ['items', 'room_meta', 'sessions', 'statuses', 'timers']);
  // A database written by a newer room (a higher version) is left as it is.
  raw.prepare("UPDATE room_meta SET value = ? WHERE key = 'schema'").run(String(SCHEMA_VERSION + 1));
  room({}, {}, raw); assert.equal(version(), String(SCHEMA_VERSION + 1));
  // Old statuses still expire on the migrated database.
  mock.timers.setTime(T0 + STATUS_TTL + 1); assert.equal(room({}, {}, raw).r.snapshot().statuses.length, 0); mock.timers.setTime(T0);
});

test('the deploy needs no new Durable Object migration: the class and its SQLite storage are unchanged since the first release', async () => {
  const deploy = await readFile(new URL('../scripts/deploy-backend.mjs', import.meta.url), 'utf8');
  assert.match(deploy, /migrations:\[\{tag:'v1',new_sqlite_classes:\['WingRoom'\]\}\]/);
  assert.equal((deploy.match(/tag:'/g) || []).length, 1, 'a rename, deletion or new class needs its own tag; added tables do not');
});
