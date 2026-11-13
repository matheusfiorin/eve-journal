// Journal sync bookkeeping, kept free of the DOM so it can be tested in Node. The journal itself stays the plain
// {version, goals, entries} object; sync remembers beside it, per record, the server rev it last agreed on and a
// fingerprint of the record at that moment. A record whose fingerprint differs has changed on this device.
//   meta = {cursor:{[pilotId]:rev}, known:{'goal:id':{rev, owner, fp}}}   (fp '-' = deleted on the server)
// Goals belong to the wing (owner 0); an entry belongs to the pilot whose session uploaded it. Pilot preferences
// (kind 'pref', bottom of this file) ride the same protocol but merge instead of making conflict copies.
import {editedAt, PREF_MARKS} from '../model.js';
export const keyOf = (kind, id) => `${kind}:${id}`;
export const emptyMeta = () => ({cursor:{}, known:{}});
const GONE = '-';

// FNV-1a over the record's JSON (records come out of validateBackup, so key order is stable).
export function fingerprint(record) {
  if (!record) return GONE;
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(record)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
const list = kind => kind === 'goal' ? 'goals' : 'entries';
const find = (data, kind, id) => data[list(kind)].find(r => r.id === id) || null;
function put(data, kind, id, record) {
  const items = data[list(kind)], at = items.findIndex(r => r.id === id);
  const next = record ? (at < 0 ? [...items, record] : items.map((r, i) => i === at ? record : r)) : items.filter(r => r.id !== id);
  return {...data, [list(kind)]:next};
}
const same = (a, b) => fingerprint(a) === fingerprint(b);
const isPref = kind => kind === 'pref';
// Changed here since the last agreed version (a record never synced counts as changed).
export function dirty(data, meta, kind, id) {
  const known = meta.known[keyOf(kind, id)], local = find(data, kind, id);
  return known ? known.fp !== fingerprint(local) : Boolean(local);
}

// What this pilot's session should send: changed goals (only when goals is true, so one session sends them) and
// changed entries this pilot owns. ownerOf(entry) names the pilot for an entry the server hasn't seen yet.
export function changesFor(data, meta, pilotId, {goals = true, ownerOf = () => pilotId} = {}) {
  const out = [];
  const consider = (kind, id, record) => {
    const known = meta.known[keyOf(kind, id)];
    if (!dirty(data, meta, kind, id)) return;
    if (kind === 'goal' ? !goals : (known?.owner ?? ownerOf(record)) !== pilotId) return;
    if (!record && (!known || known.fp === GONE)) return;
    out.push({kind, id, base:known?.rev || 0, record:record || null});
  };
  for (const g of data.goals) consider('goal', g.id, g);
  for (const e of data.entries) consider('entry', e.id, e);
  for (const k of Object.keys(meta.known)) {
    const [kind, ...rest] = k.split(':'), id = rest.join(':');
    if (!isPref(kind) && !find(data, kind, id)) consider(kind, id, null);
  }
  return out;
}
export const pendingCount = (data, meta, ids, ownerOf) => ids.reduce((n, id, i) => n + changesFor(data, meta, id, {goals:i === 0, ownerOf}).length, 0);

// The server accepted these changes: the sent version is now the agreed one. If the record changed again meanwhile,
// its fingerprint no longer matches and it stays pending.
export function markApplied(meta, applied, sent, pilotId) {
  const known = {...meta.known};
  for (const a of applied) {
    const k = keyOf(a.kind, a.id), record = sent.get(k)?.record ?? null;
    if (!a.rev) delete known[k];
    else known[k] = {rev:a.rev, owner:a.kind === 'goal' ? 0 : pilotId, fp:fingerprint(record), ...(isPref(a.kind) ? {record} : {})};
  }
  return {...meta, known};
}

// Fold server records into the journal. A record unchanged here takes the server's version (or is deleted). When
// both sides changed it, nothing is lost: the server's version keeps the id and this device's version stays as a
// "(conflict copy)" with a new id, which then uploads like any new record. A local edit beats a remote delete, and a
// remote edit brings back a record deleted here. The copy is stamped as edited now, so a later backup merge keeps it.
export function applyRemote(data, meta, records, pilotId, newId = () => crypto.randomUUID(), now = Date.now()) {
  let next = data, copies = 0;
  const known = {...meta.known};
  for (const r of records) {
    const k = keyOf(r.kind, r.id), mine = known[k];
    if (mine && r.rev <= mine.rev) continue; // Already have this version (or a newer one).
    // A preference isn't part of the journal: keep the server copy beside it for prefStep to merge with.
    if (isPref(r.kind)) { known[k] = {rev:r.rev, owner:pilotId, fp:fingerprint(r.record), record:r.record}; continue; }
    const local = find(next, r.kind, r.id), changed = mine ? mine.fp !== fingerprint(local) : Boolean(local);
    const agreed = {rev:r.rev, owner:r.kind === 'goal' ? 0 : pilotId, fp:fingerprint(r.record)};
    if (!changed || same(local, r.record)) { next = put(next, r.kind, r.id, r.record); known[k] = agreed; continue; }
    if (!r.record) { known[k] = agreed; continue; } // Deleted there, edited here: keep the edit; it re-uploads.
    if (!local) { next = put(next, r.kind, r.id, r.record); known[k] = agreed; continue; }
    const copy = {...local, id:newId(), title:`${local.title.slice(0, 140)} (conflict copy)`, updatedAt:editedAt(local, now)};
    next = put(put(next, r.kind, r.id, r.record), r.kind, copy.id, copy);
    known[k] = agreed; copies++;
  }
  return {data:next, meta:{...meta, known}, copies};
}

// The server refused these ids because another pilot already owns an entry with that id (e.g. both merged the same
// backup). Don't fork a copy: leave the record with that pilot, so it syncs (or reconciles) when their session is here.
export function handOver(meta, denied, owner) {
  const known = {...meta.known};
  for (const d of denied) {
    // A preference's id carries its pilot, so the server never denies one for ownership.
    if (isPref(d.kind)) continue;
    known[keyOf(d.kind, d.id)] = {rev:0, owner, fp:''};
  }
  return {...meta, known};
}

// ── Pilot preferences: 'explored' (Mark scanned systems) and 'haul' (the Haul plan). One record per pilot per name, id
// '<name>:<characterId>', so the server key (kind, id) stays unique and the id alone says whose it is. They live under
// their own localStorage keys, not in the journal; meta.known keeps the last agreed server record so the merge can run
// at any sync, for whichever pilot is flying here, even if that record was pulled while another pilot was.
export const MARK_DAYS = 90;
export const prefId = (name, pilotId) => `${name}:${pilotId}`;
// Scans older than 90 days no longer say anything about a system's sites (a re-scan refreshes the mark), and at most
// the newest PREF_MARKS are kept, so the map stops growing.
export function ageMarks(marks, now = Date.now()) {
  const cut = now - MARK_DAYS * 86400000;
  const kept = Object.entries(marks || {}).filter(([k, at]) => /^\d{8}$/.test(k) && Number.isSafeInteger(at) && at > cut);
  return Object.fromEntries(kept.sort((a, b) => b[1] - a[1]).slice(0, PREF_MARKS));
}
// The haul plan as saved by navigate.js, with every field present so fingerprints compare like with like.
const haulOf = h => ({stops:Array.isArray(h?.stops) ? h.stops : [], value:String(h?.value ?? ''), volume:String(h?.volume ?? ''), avoid:String(h?.avoid ?? ''), updatedAt:Number.isSafeInteger(h?.updatedAt) ? h.updatedAt : 0});
const local = (name, v, now) => name === 'explored' ? ageMarks(v, now) : haulOf(v);
// Scanned marks: the union, newest scan per system. Haul plan: the one saved last wins; on a tie the server's, so every
// device settles on the same plan. Neither makes a conflict copy: losing an older mark or plan costs nothing.
export function mergePref(name, here, there, now = Date.now()) {
  if (name === 'explored') { const out = {...there}; for (const [k, at] of Object.entries(here || {})) out[k] = Math.max(at, out[k] || 0); return ageMarks(out, now); }
  const a = haulOf(here);
  return there && haulOf(there).updatedAt >= a.updatedAt ? haulOf(there) : a;
}
const payload = (name, record) => !record ? null : name === 'explored' ? record.marks : haulOf(record);
const toRecord = (name, id, v) => name === 'explored' ? {id, marks:v} : {id, ...v};
// Merge this browser's copy with the last agreed server copy. save: the merged value when it differs from this
// browser's copy (else null). change: what to send when the merge differs from the server's copy. A browser that never
// marked a system or touched the plan sends nothing, so its defaults can't overwrite another device's plan.
export function prefStep(name, here, meta, pilotId, now = Date.now()) {
  const id = prefId(name, pilotId), known = meta.known[keyOf('pref', id)], mine = local(name, here, now);
  const merged = mergePref(name, mine, payload(name, known?.record), now), record = toRecord(name, id, merged);
  const worth = name === 'explored' ? Object.keys(merged).length > 0 : merged.updatedAt > 0;
  return {save:same(merged, mine) ? null : merged,
    change:(known ? known.fp !== fingerprint(record) : worth) ? {kind:'pref', id, base:known?.rev || 0, record} : null};
}
