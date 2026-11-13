import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyMeta, fingerprint, changesFor, markApplied, applyRemote, handOver, dirty} from '../ui/syncplan.js';
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
