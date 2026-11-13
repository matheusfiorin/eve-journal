// Journal sync bookkeeping, kept free of the DOM so it can be tested in Node. The journal itself stays the plain
// {version, goals, entries} object; sync remembers beside it, per record, the server rev it last agreed on and a
// fingerprint of the record at that moment. A record whose fingerprint differs has changed on this device.
//   meta = {cursor:{[pilotId]:rev}, known:{'goal:id':{rev, owner, fp}}}   (fp '-' = deleted on the server)
// Goals belong to the wing (owner 0); an entry belongs to the pilot whose session uploaded it.
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
    if (!find(data, kind, id)) consider(kind, id, null);
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
    else known[k] = {rev:a.rev, owner:a.kind === 'goal' ? 0 : pilotId, fp:fingerprint(record)};
  }
  return {...meta, known};
}

// Fold server records into the journal. A record unchanged here takes the server's version (or is deleted). When
// both sides changed it, nothing is lost: the server's version keeps the id and this device's version stays as a
// "(conflict copy)" with a new id, which then uploads like any new record. A local edit beats a remote delete, and a
// remote edit brings back a record deleted here.
export function applyRemote(data, meta, records, pilotId, newId = () => crypto.randomUUID()) {
  let next = data, copies = 0;
  const known = {...meta.known};
  for (const r of records) {
    const k = keyOf(r.kind, r.id), mine = known[k];
    if (mine && r.rev <= mine.rev) continue; // Already have this version (or a newer one).
    const local = find(next, r.kind, r.id), changed = mine ? mine.fp !== fingerprint(local) : Boolean(local);
    const agreed = {rev:r.rev, owner:r.kind === 'goal' ? 0 : pilotId, fp:fingerprint(r.record)};
    if (!changed || same(local, r.record)) { next = put(next, r.kind, r.id, r.record); known[k] = agreed; continue; }
    if (!r.record) { known[k] = agreed; continue; } // Deleted there, edited here: keep the edit; it re-uploads.
    if (!local) { next = put(next, r.kind, r.id, r.record); known[k] = agreed; continue; }
    const copy = {...local, id:newId(), title:`${local.title.slice(0, 140)} (conflict copy)`};
    next = put(put(next, r.kind, r.id, r.record), r.kind, copy.id, copy);
    known[k] = agreed; copies++;
  }
  return {data:next, meta:{...meta, known}, copies};
}

// The server refused these ids because another pilot owns an entry with the same id: give ours a new id.
export function reassign(data, meta, denied, newId = () => crypto.randomUUID()) {
  let next = data;
  const known = {...meta.known};
  for (const d of denied) {
    const local = find(next, d.kind, d.id);
    delete known[keyOf(d.kind, d.id)];
    if (local) { const id = newId(); next = put(put(next, d.kind, d.id, null), d.kind, id, {...local, id}); }
  }
  return {data:next, meta:{...meta, known}};
}
