// Journal sync: when a browser turns it on, goals and Logbook entries are kept on the wing backend too, so a new device,
// cleared site data or Safari's 7-day clearing loses nothing. This browser's copy stays the working copy and syncs on
// load, when the tab comes back, every few minutes, and shortly after each change. Goals go to the wing; an entry goes
// to the pilot it's written for when that pilot is connected here, else to the pilot flying here (see syncplan.js).
import {validateBackup} from '../model.js';
import {S} from './state.js';
import {$, plural} from './shared.js';
import {emptyMeta, changesFor, markApplied, applyRemote, handOver, pendingCount} from './syncplan.js';

const SYNC = 'eve-journal-sync:v1', CHUNK = 40, EVERY = 5 * 60000, DEBOUNCE = 1500;
let state = read(), running = null, again = false, lastError = null, lastAt = 0, copies = 0, timer;

function read() {
  try { const v = JSON.parse(localStorage.getItem(SYNC) || 'null'); if (v?.known && v?.cursor) return {on:Boolean(v.on), cursor:v.cursor, known:v.known}; } catch { /* Start over; the server copy is intact. */ }
  return {on:false, ...emptyMeta()};
}
function write(next) { state = next; try { localStorage.setItem(SYNC, JSON.stringify(state)); } catch { /* Kept for this page. */ } }
export const syncOn = () => state.on;

// The wing's other pilot (an entry the server says isn't this pilot's belongs to them).
const otherPilot = id => S.pilots.find(p => p.id && p.id !== id)?.id ?? -1;
// Connected pilots, the pilot flying here first (their session sends the goals).
function pilots() {
  if (!S.backend) return [];
  return S.pilots.filter(p => p.id && S.backend.has(p.id)).sort((a, b) => (b.name === S.me) - (a.name === S.me));
}
function ownerOf(list) {
  return entry => (list.find(p => p.name === entry?.pilot) || list[0])?.id;
}
// Drop anything the server sends that this browser wouldn't accept from a backup file.
function valid(records) {
  return records.filter(r => {
    if (r.record === null) return true;
    try { validateBackup({version:1, goals:r.kind === 'goal' ? [r.record] : [], entries:r.kind === 'entry' ? [r.record] : []}); return r.record.id === r.id; } catch { return false; }
  });
}

// Fold results into the latest saved journal in one synchronous step (load, merge, save), so an edit this tab saved
// while a request was out is never overwritten.
function fold({remote = [], applied = [], denied = [], deniedFor = null, cursor = {}}) {
  let data = S.store.load(), meta = read();
  for (const [id, list, sent] of applied) meta = markApplied(meta, list, sent, id);
  for (const [id, list] of remote) { const r = applyRemote(data, meta, valid(list), id); data = r.data; meta = r.meta; copies += r.copies; }
  if (denied.length) meta = handOver(meta, denied, otherPilot(deniedFor));
  for (const [id, rev] of Object.entries(cursor)) meta.cursor = {...meta.cursor, [id]:Math.max(meta.cursor[id] || 0, rev)};
  const changed = JSON.stringify(data) !== JSON.stringify(S.data);
  S.data = changed ? S.store.save(data) : data;
  write({...meta, on:state.on});
  if (changed) document.dispatchEvent(new Event('data-change'));
}

async function run() {
  const list = pilots();
  if (!list.length) { lastError = 'Connect a pilot to sync.'; return; }
  const owner = ownerOf(list);
  // Pull what other devices sent since last time.
  const remote = [], cursor = {};
  for (const p of list) {
    let since = read().cursor[p.id] || 0, page, records = [];
    do { page = await S.backend.journalPull(p.id, since); records.push(...page.records); since = page.rev; } while (page.more);
    remote.push([p.id, records]); cursor[p.id] = since;
  }
  fold({remote, cursor});
  // Send what changed here.
  for (const [i, p] of list.entries()) {
    const changes = changesFor(S.data, state, p.id, {goals:i === 0, ownerOf:owner});
    for (let at = 0; at < changes.length; at += CHUNK) {
      const chunk = changes.slice(at, at + CHUNK), reply = await S.backend.journalPush(p.id, chunk);
      fold({applied:[[p.id, reply.applied, new Map(chunk.map(c => [`${c.kind}:${c.id}`, c]))]], remote:[[p.id, reply.conflicts]], denied:reply.denied, deniedFor:p.id});
    }
  }
  lastError = null; lastAt = Date.now();
}

export function sync() {
  if (!state.on || !S.backend || !S.store || S.store.locked) { render(); return Promise.resolve(); }
  if (running) { again = true; return running; }
  render(true);
  const go = async () => { try { await run(); } catch (error) { lastError = error.message; } };
  running = (navigator.locks ? navigator.locks.request('eve-journal-sync', go) : go()).finally(() => {
    running = null; render(); document.dispatchEvent(new Event('journal-synced'));
    if (again) { again = false; sync(); }
  });
  return running;
}

export function render(busy = false) {
  const box = $('#journal-sync'), status = $('#journal-sync-status');
  if (!box || !status) return;
  box.checked = state.on; box.disabled = Boolean(S.store?.locked);
  const list = pilots(), pending = state.on && S.store && !S.store.locked ? pendingCount(S.data, state, list.map(p => p.id), ownerOf(list)) : 0;
  status.classList.toggle('error', Boolean(state.on && lastError));
  status.textContent = !state.on ? 'Off: goals and entries stay only in this browser.'
    : busy ? 'Syncing…'
    : lastError ? `Not synced: ${lastError} Changes stay here and go out on the next sync.`
    : lastAt ? `Synced at ${new Date(lastAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}.${pending ? ` ${plural(pending, 'change')} waiting.` : ''}${copies ? ` ${plural(copies, 'record')} edited on two devices at once ${copies === 1 ? 'was' : 'were'} kept as a “(conflict copy)”.` : ''}`
    : 'On. Waiting for the first sync…';
}
// Sync is on and the last attempt didn't fail: the Backup card can stop nagging about exports.
export const synced = () => state.on && !lastError;

function schedule() {
  clearTimeout(timer);
  if (state.on) timer = setTimeout(() => { const list = pilots(); if (pendingCount(S.data, state, list.map(p => p.id), ownerOf(list))) sync(); else render(); }, DEBOUNCE);
}
export function wire() {
  $('#journal-sync').onchange = event => {
    write({...read(), on:event.target.checked});
    if (state.on) sync(); else { lastError = null; render(); document.dispatchEvent(new Event('journal-synced')); }
    document.dispatchEvent(new Event('data-change'));
  };
  document.addEventListener('data-change', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastAt > 30000) sync(); });
  setInterval(() => { if (!document.hidden) sync(); }, EVERY);
  window.addEventListener('storage', event => { if (event.key === SYNC) { state = read(); render(); } });
  render();
}
