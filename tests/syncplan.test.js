import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyMeta, fingerprint, changesFor, markApplied, applyRemote, handOver, dirty, mergePref, prefStep, ageMarks, MARK_DAYS} from '../ui/syncplan.js';
const A = 2124810474, B = 2124815118;
const goal = {id:'g1', title:'Fly a Heron', pilot:'Both pilots', done:false};
const entry = {id:'e1', title:'First trip', pilot:'Fiofka', date:'2026-11-01', body:'Notes'};
const data = (goals = [], entries = []) => ({version:1, goals, entries});
let n = 0; const newId = () => `new-${++n}`;

test('first sync uploads everything; once applied nothing is pending', () => {
  const d = data([goal], [entry]);
  const changes = changesFor(d, emptyMeta(), A);
  assert.deepEqual(changes.map(c => [c.kind, c.id, c.base]), [['goal', 'g1', 0], ['entry', 'e1', 0]]);
  const meta = markApplied(emptyMeta(), [{kind:'goal', id:'g1', rev:1}, {kind:'entry', id:'e1', rev:2}], new Map(changes.map(c => [`${c.kind}:${c.id}`, c])), A);
  assert.deepEqual(changesFor(d, meta, A), []);
  assert.equal(meta.known['entry:e1'].owner, A);
});

test('edits and deletes become changes against the agreed rev; only one session sends goals; entries go with their owner', () => {
  const meta = {cursor:{}, known:{'goal:g1':{rev:1, owner:0, fp:fingerprint(goal)}, 'entry:e1':{rev:2, owner:A, fp:fingerprint(entry)}}};
  const d = data([{...goal, done:true}], []);
  assert.deepEqual(changesFor(d, meta, A).map(c => [c.id, c.base, c.record?.done ?? null]), [['g1', 1, true], ['e1', 2, null]]);
  assert.deepEqual(changesFor(d, meta, B, {goals:false}), [], 'B neither sends goals nor A\'s entry');
  const fresh = {...entry, id:'e2', pilot:'Decxus'};
  assert.deepEqual(changesFor(data([], [fresh]), emptyMeta(), B, {ownerOf:e => e.pilot === 'Decxus' ? B : A}).map(c => c.id), ['e2']);
  assert.deepEqual(changesFor(data([], [fresh]), emptyMeta(), A, {ownerOf:e => e.pilot === 'Decxus' ? B : A}), []);
});

test('a record unchanged here takes the server version, including deletes', () => {
  const meta = {cursor:{}, known:{'goal:g1':{rev:1, owner:0, fp:fingerprint(goal)}}};
  const r = applyRemote(data([goal]), meta, [{kind:'goal', id:'g1', rev:5, record:{...goal, done:true}}], A);
  assert.equal(r.data.goals[0].done, true); assert.equal(r.meta.known['goal:g1'].rev, 5); assert.equal(dirty(r.data, r.meta, 'goal', 'g1'), false);
  const gone = applyRemote(r.data, r.meta, [{kind:'goal', id:'g1', rev:6, record:null}], A);
  assert.deepEqual(gone.data.goals, []); assert.deepEqual(changesFor(gone.data, gone.meta, A), []);
  assert.equal(applyRemote(gone.data, gone.meta, [{kind:'goal', id:'g1', rev:5, record:goal}], A).data.goals.length, 0, 'an older rev is ignored');
});

test('both sides edited: the server keeps the id and this device keeps a conflict copy that uploads', () => {
  const meta = {cursor:{}, known:{'entry:e1':{rev:2, owner:A, fp:fingerprint(entry)}}};
  const r = applyRemote(data([], [{...entry, body:'Local words'}]), meta, [{kind:'entry', id:'e1', rev:3, record:{...entry, body:'Remote words'}}], A, newId, Date.parse('2026-11-13'));
  assert.equal(r.copies, 1);
  assert.deepEqual(r.data.entries.map(e => [e.id, e.body, e.title]), [['e1', 'Remote words', 'First trip'], ['new-1', 'Local words', 'First trip (conflict copy)']]);
  assert.deepEqual(changesFor(r.data, r.meta, A).map(c => c.id), ['new-1']);
  assert.equal(r.data.entries[1].updatedAt, Date.parse('2026-11-13'), 'the copy is stamped as edited now');
});

test('a local edit survives a remote delete, a remote edit restores a local delete, and identical edits are no conflict', () => {
  const meta = {cursor:{}, known:{'goal:g1':{rev:1, owner:0, fp:fingerprint(goal)}}};
  const kept = applyRemote(data([{...goal, done:true}]), meta, [{kind:'goal', id:'g1', rev:2, record:null}], A);
  assert.equal(kept.data.goals[0].done, true); assert.deepEqual(changesFor(kept.data, kept.meta, A).map(c => [c.id, c.base]), [['g1', 2]]);
  const back = applyRemote(data([]), meta, [{kind:'goal', id:'g1', rev:2, record:{...goal, title:'Renamed'}}], A);
  assert.equal(back.data.goals[0].title, 'Renamed');
  const twin = applyRemote(data([{...goal, done:true}]), meta, [{kind:'goal', id:'g1', rev:2, record:{...goal, done:true}}], A);
  assert.equal(twin.copies, 0); assert.equal(twin.data.goals.length, 1);
});

test('an entry another pilot owns is left with that pilot instead of being copied under a new id', () => {
  const meta = handOver(emptyMeta(), [{kind:'entry', id:'e1'}], B);
  const d = data([], [entry]);
  assert.deepEqual(changesFor(d, meta, A), [], 'A stops sending it');
  assert.deepEqual(changesFor(d, meta, B).map(c => [c.id, c.base]), [['e1', 0]], 'B sends it when connected here, and the server reconciles');
  const r = applyRemote(d, meta, [{kind:'entry', id:'e1', rev:4, record:entry}], B);
  assert.equal(r.copies, 0); assert.equal(r.data.entries.length, 1);
});

test('updatedAt and fields from a newer build travel with records: a stamp change is an edit, extras survive a conflict copy', () => {
  const stamped = {...goal, updatedAt:1000, plan:{ships:['Heron']}};
  const meta = {cursor:{}, known:{'goal:g1':{rev:1, owner:0, fp:fingerprint(stamped)}}};
  assert.equal(dirty(data([{...stamped, updatedAt:2000}]), meta, 'goal', 'g1'), true);
  const r = applyRemote(data([{...stamped, done:true, updatedAt:5000}]), meta, [{kind:'goal', id:'g1', rev:2, record:{...stamped, title:'Remote', updatedAt:3000}}], A, () => 'copy', 4000);
  assert.deepEqual(r.data.goals.map(g => [g.id, g.title, g.updatedAt, g.plan?.ships[0]]), [['g1', 'Remote', 3000, 'Heron'], ['copy', 'Fly a Heron (conflict copy)', 5001, 'Heron']], 'never older than the local edit it copies');
});

const DAY = 86400000, NOW = Date.UTC(2026, 10, 13);
const known = (meta, records) => applyRemote(data(), meta, records, A).meta;
test('scanned marks merge as a union keeping the newest scan, and fade after 90 days', () => {
  const here = {30000142:NOW - DAY, 30003504:NOW - 5 * DAY}, there = {30000142:NOW - 3 * DAY, 30002187:NOW - 2 * DAY, 30000144:NOW - (MARK_DAYS + 1) * DAY};
  assert.deepEqual(mergePref('explored', here, there, NOW), {30000142:NOW - DAY, 30002187:NOW - 2 * DAY, 30003504:NOW - 5 * DAY});
  assert.deepEqual(mergePref('explored', here, there, NOW), mergePref('explored', there, here, NOW), 'either order gives the same marks');
  const many = Object.fromEntries(Array.from({length:1200}, (_, i) => [30000000 + i, NOW - i * 1000]));
  const kept = ageMarks(many, NOW);
  assert.equal(Object.keys(kept).length, 1000); assert.ok(kept[30000000] && !kept[30001100], 'the newest are kept');
});
test('the haul plan saved last wins; a tie goes to the server copy', () => {
  const a = {stops:['Jita', 'Amarr'], value:'1', volume:'2', avoid:'', updatedAt:10}, b = {stops:['Rens', 'Hek'], value:'3', volume:'4', avoid:'Uedama', updatedAt:20};
  assert.deepEqual(mergePref('haul', a, b).stops, ['Rens', 'Hek']); assert.deepEqual(mergePref('haul', b, a).stops, ['Rens', 'Hek']);
  assert.deepEqual(mergePref('haul', {...a, updatedAt:20}, b).stops, ['Rens', 'Hek']);
  assert.deepEqual(mergePref('haul', a, null), a);
});
test('a pref step merges with the last agreed server copy: it saves what is new here and sends what is new there', () => {
  // First sync: marks here go up; a browser with nothing marked and an untouched plan sends nothing.
  const first = prefStep('explored', {30000142:NOW - DAY}, emptyMeta(), A, NOW);
  assert.equal(first.save, null); assert.deepEqual(first.change, {kind:'pref', id:`explored:${A}`, base:0, record:{id:`explored:${A}`, marks:{30000142:NOW - DAY}}});
  assert.deepEqual([prefStep('explored', {}, emptyMeta(), A, NOW).change, prefStep('haul', {stops:['Jita', 'Amarr'], value:'1', volume:'2', avoid:''}, emptyMeta(), A, NOW).change], [null, null]);
  // Once applied, nothing is pending; the id is the pilot's own.
  const meta = markApplied(emptyMeta(), [{kind:'pref', id:`explored:${A}`, rev:4}], new Map([[`pref:explored:${A}`, first.change]]), A);
  assert.equal(prefStep('explored', {30000142:NOW - DAY}, meta, A, NOW).change, null);
  assert.notEqual(prefStep('explored', {30000142:NOW - DAY}, meta, B, NOW).change, null, 'another pilot flying here has their own record');
  // Another device marked a system: this browser saves the union and sends it back with the new base.
  const pulled = known(meta, [{kind:'pref', id:`explored:${A}`, rev:6, record:{id:`explored:${A}`, marks:{30002187:NOW - 2 * DAY}}}]);
  const both = prefStep('explored', {30000142:NOW - DAY}, pulled, A, NOW);
  assert.deepEqual(both.save, {30000142:NOW - DAY, 30002187:NOW - 2 * DAY}); assert.equal(both.change.base, 6);
  // Only theirs changed: save it here, nothing to send.
  const theirs = prefStep('explored', {}, pulled, A, NOW);
  assert.deepEqual(theirs.save, {30002187:NOW - 2 * DAY}); assert.equal(theirs.change, null);
});
test('a newer haul plan from another device replaces this one; an older one is overwritten', () => {
  const plan = updatedAt => ({id:`haul:${A}`, stops:['Jita', `Stop ${updatedAt}`], value:'1', volume:'2', avoid:'', updatedAt});
  const meta = known(emptyMeta(), [{kind:'pref', id:`haul:${A}`, rev:3, record:plan(20)}]);
  const {id, ...newer} = plan(20);
  assert.deepEqual(prefStep('haul', plan(10), meta, A).save, newer); assert.equal(prefStep('haul', plan(10), meta, A).change, null);
  const mine = prefStep('haul', {...plan(30), id:undefined}, meta, A);
  assert.equal(mine.save, null); assert.deepEqual([mine.change.base, mine.change.record.stops], [3, ['Jita', 'Stop 30']]);
});
test('prefs never become journal records or deletes, and a denied pref keeps its id', () => {
  const meta = known(emptyMeta(), [{kind:'pref', id:`haul:${A}`, rev:3, record:{id:`haul:${A}`, stops:[], value:'', volume:'', avoid:'', updatedAt:1}}]);
  assert.deepEqual(meta.known[`pref:haul:${A}`].rev, 3);
  assert.deepEqual(changesFor(data([goal]), meta, A).map(c => c.kind), ['goal'], 'the pref is not read as a deleted entry');
  const r = handOver(meta, [{kind:'pref', id:`haul:${A}`}], B);
  assert.deepEqual(r.known[`pref:haul:${A}`].rev, 3, 'a denied pref is left as it was');
});
