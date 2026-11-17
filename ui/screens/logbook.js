// Logbook: private journal entries with search and filters, drafts that survive reloads, and backup/restore.
import {validateBackup, mergeBackups, mergeSummary, editedAt, localDate, filterEntries} from '../../model.js';
import {S, KEY, DRAFT} from '../state.js';
import {$, esc, plural, when, clock, notice, toast, persist, go, openDrawer, closeDrawer} from '../shared.js';
import {readout} from './pilot.js';
import {syncOn, synced} from '../journalsync.js';

const CATEGORIES = '<option>Adventure</option><option>Milestone</option><option>Lesson learned</option><option>Fleet</option><option>Industry</option>';
export const markup = {logbook:`<div class="toolbar" role="toolbar" aria-label="Logbook">
  <label class="field--inline field--search"><span class="sr-only">Search entries</span><input id="journal-search" type="search" data-filter placeholder="Search titles and notes  /" autocomplete="off"></label>
  <label class="field--inline">Pilot<select id="journal-pilot"><option value="">All pilots</option></select></label>
  <label class="field--inline">Focus<select id="journal-category"><option value="">All entries</option>${CATEGORIES}</select></label>
  <p class="backup-chip" id="backup-chip"><span id="backup-age" role="status"></span><span aria-hidden="true"> · </span><button type="button" id="backup-now" class="btn--link">Back up now</button></p>
  <button type="button" id="new-entry" class="toolbar__end" aria-keyshortcuts="N" aria-controls="desk" aria-expanded="false">New entry</button></div>
 <div id="logbook-summary"></div>
 <div class="logbook">
  <section id="journal" class="card panel--primary logbook__list" aria-label="Entries"><h2 class="sr-only">Entries</h2><p id="entry-count" class="hint" role="status"></p><div id="entries"></div></section>
  <section class="card desk" id="desk" aria-labelledby="desk-title" hidden>
   <div class="panel__head"><h2 id="desk-title">New entry</h2><p id="draft-status" class="hint" role="status">Private draft · saved in this tab</p></div>
   <form id="journal-form"><label>Entry title<input name="title" maxlength="160" required placeholder="Our first trip into low-sec"></label><label class="desk__body">Private notes<textarea name="body" required maxlength="20000" rows="9" placeholder="What happened? What did you learn?"></textarea></label><div class="desk__meta"><label>Pilot<select name="pilot" class="pilot-select"></select></label><label>Date<input name="date" type="date" required></label><label>Focus<select name="category">${CATEGORIES}</select></label></div><div class="actions"><button id="entry-submit">Save entry locally</button><button id="cancel-entry-edit" type="button" class="secondary" hidden>Cancel edit</button><button id="discard-draft" type="button" class="secondary">Discard draft</button></div></form>
  </section>
 </div>
 <section class="card backup" aria-labelledby="backup-title"><div class="panel__head"><div><h2 id="backup-title">Backup</h2><p class="panel__sub">Entries, shared goals, systems you marked scanned and your haul plan live in this browser. Turn on sync to keep them on the wing backend and open them on your other devices, or export a backup file (entries and goals only).</p></div></div>
  <label class="switch sync-toggle"><input type="checkbox" id="journal-sync" role="switch"><span>Sync goals and entries with the wing backend</span></label>
  <p class="hint">Turn on in every browser you use. Goals are shared with your wingmate; an entry is kept for the pilot it's written for (or the pilot flying here), and only that pilot's sessions can read it. Stored encrypted.</p>
  <p id="journal-sync-status" class="hint" role="status"></p>
  <div class="backup__actions"><button id="export" class="secondary">Export backup</button><label class="import secondary-like">Restore or merge a backup<input id="import" type="file" accept="application/json,.json"></label><button id="recover" class="secondary" hidden>Download raw recovery file</button></div>
  <p id="backup-status" class="hint" role="status"></p><p id="backup-note" class="hint"></p></section>`};

let editingEntry = null, draftTimer;
// Read the draft before initialization resets the blank editor.
let recoveredDraft;
try { recoveredDraft = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); } catch { /* Ignore malformed drafts; never overwrite journal records. */ }

function authorFilter() {
  const filter = $('#journal-pilot'), prior = filter.value;
  const authors = [...new Set([...S.pilots.map(p => p.name), ...S.data.entries.map(e => e.pilot)])];
  filter.innerHTML = '<option value="">All pilots</option>' + authors.map(n => `<option>${esc(n)}</option>`).join('');
  filter.value = authors.includes(prior) ? prior : '';
}
const excerpt = text => text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text;
function renderEntries() {
  const entries = filterEntries(S.data.entries, {query:$('#journal-search').value, pilot:$('#journal-pilot').value, category:$('#journal-category').value});
  const all = S.data.entries, last = [...all].sort((a, b) => b.date.localeCompare(a.date))[0], month = localDate().slice(0, 7);
  $('#logbook-summary').innerHTML = readout([['Entries', `<span class="num">${all.length}</span>`], ['Last entry', last ? `<span class="num">${esc(last.date)}</span>` : '—'], ['This month', `<span class="num">${all.filter(e => e.date.startsWith(month)).length}</span>`]]);
  $('#entry-count').textContent = entries.length === all.length ? `${plural(all.length, 'entry', 'entries')} · ${syncOn() ? 'private, synced' : 'private to this browser'}` : `${entries.length} of ${plural(all.length, 'entry', 'entries')} match`;
  $('#entries').innerHTML = entries.length ? `<ol class="entries">${entries.map((e, i) => `<li class="entry" data-row tabindex="${i ? -1 : 0}" style="--i:${i}" data-entry="${esc(e.id)}" data-pilot="${esc(String(e.pilot).toLowerCase())}">
      <time class="entry__date num" datetime="${esc(e.date)}">${esc(e.date)}</time>
      <div class="entry__main"><h3>${esc(e.title)}</h3><p class="entry__meta"><span class="who">${esc(e.pilot)}</span><span class="chip">${esc(e.category || 'Adventure')}</span></p><p class="entry__body">${esc(excerpt(e.body))}</p></div>
      <div class="entry__actions"><button data-edit-entry="${esc(e.id)}" class="secondary small">Edit</button><button data-delete-entry="${esc(e.id)}" class="secondary small" aria-label="Delete ${esc(e.title)}">Delete</button></div></li>`).join('')}</ol>`
    : `<div class="state"><p>${all.length ? '<b>No entries match.</b> Try a different search or filter.' : '<b>Every capsuleer starts somewhere.</b> Write your first entry: what you flew, where you went, what you learned.'}</p></div>`;
}
function readEntry(id) {
  const e = S.data.entries.find(x => x.id === id); if (!e) return;
  openDrawer({title:e.title, body:`<p class="entry__meta"><span class="num">${esc(e.date)}</span><span class="who" data-pilot="${esc(String(e.pilot).toLowerCase())}">${esc(e.pilot)}</span><span class="chip">${esc(e.category || 'Adventure')}</span></p><div class="reading">${esc(e.body)}</div>`,
    foot:`<button data-edit-entry="${esc(e.id)}" class="secondary">Edit</button><button data-delete-entry="${esc(e.id)}" class="secondary" aria-label="Delete ${esc(e.title)}">Delete</button>`});
}
// When this browser last exported a backup, so the Backup card can say how much is at risk.
const EXPORTED = 'eve-journal-exported:v1', NUDGE_DAYS = 14;
function exportedAt() { try { return Number(localStorage.getItem(EXPORTED)) || 0; } catch { return 0; } }
function renderBackupAge() {
  const records = S.data.goals.length + S.data.entries.length, at = exportedAt(), days = at ? Math.floor((Date.now() - at) / 86400000) : null;
  const kept = S.storageKept === false ? ' This browser has not agreed to keep its site data, so it may clear them when space runs low.' : '';
  const stale = records && !synced() && (days === null || days >= NUDGE_DAYS);
  $('#backup-chip').hidden = !records;
  $('#backup-age').textContent = !records ? '' : synced() && days === null ? 'Kept on the wing backend' : days === null ? 'Never exported' : `Last exported ${days ? plural(days, 'day', 'days') + ' ago' : 'today'}.`;
  $('#backup-chip').classList.toggle('is-stale', Boolean(stale));
  $('#backup-note').textContent = !records ? '' : synced() && days === null ? 'Sync keeps your records on the wing backend. Export a file too if you want an offline copy.' : days === null ? `A new device, clearing site data, or Safari after a week without a visit loses everything stored only here.${kept}` : `${stale ? 'Export again to keep recent changes safe.' : ''}${kept}`.trim();
}
export function render() { authorFilter(); renderEntries(); renderBackupAge(); }
function saveDraft() {
  clearTimeout(draftTimer);
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({...Object.fromEntries(new FormData($('#journal-form'))), editingEntry}));
    $('#draft-status').textContent = `Draft saved in this tab at ${clock(Date.now())}`;
  } catch { $('#draft-status').textContent = 'Draft could not be saved. Keep this tab open until you save the entry.'; }
}
// The writing desk stays folded away until someone asks for it (New entry, Edit, or a recovered draft).
function openDesk(open = true) {
  $('#desk').hidden = !open; $('#new-entry').setAttribute('aria-expanded', String(open)); $('#logbook .logbook').classList.toggle('logbook--writing', open);
}
export function resetEntry(preserveDraft = false) {
  openDesk(false);
  editingEntry = null; $('#journal-form').reset(); $('#journal-form').elements.date.value = localDate();
  $('#entry-submit').textContent = 'Save entry locally'; $('#cancel-entry-edit').hidden = true; $('#desk-title').textContent = 'New entry';
  try { if (!preserveDraft) sessionStorage.removeItem(DRAFT); } catch { /* Journal remains usable when draft storage is unavailable. */ }
  $('#draft-status').textContent = 'New private draft · saved in this tab as you type';
}
function editEntry(id) {
  const item = S.data.entries.find(e => e.id === id);
  if (!item) return;
  const f = $('#journal-form');
  if ((f.elements.title.value || f.elements.body.value) && !confirm('Replace your current draft with this entry?')) return;
  editingEntry = id;
  for (const key of ['title','body','date','pilot','category']) if (item[key] !== undefined) {
    if (key === 'category' && ![...f.elements.category.options].some(o => o.value === item.category)) f.elements.category.add(new Option(item.category, item.category));
    f.elements[key].value = item[key];
  }
  if (!item.category) f.elements.category.value = 'Adventure';
  $('#entry-submit').textContent = 'Save changes'; $('#cancel-entry-edit').hidden = false; $('#desk-title').textContent = 'Edit entry';
  closeDrawer(); go('logbook'); openDesk(); f.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start'}); f.elements.title.focus(); saveDraft();
}
export function restoreDraft() {
  if (!(recoveredDraft && typeof recoveredDraft.title === 'string' && typeof recoveredDraft.body === 'string' && recoveredDraft.title.length <= 160 && recoveredDraft.body.length <= 20000)) return;
  const f = $('#journal-form');
  for (const key of ['title','body','date','category','pilot']) if (typeof recoveredDraft[key] === 'string') {
    if (key === 'pilot' && ![...f.elements.pilot.options].some(o => o.value === recoveredDraft.pilot)) f.elements.pilot.add(new Option(recoveredDraft.pilot, recoveredDraft.pilot));
    f.elements[key].value = recoveredDraft[key];
  }
  editingEntry = S.data.entries.some(e => e.id === recoveredDraft.editingEntry) ? recoveredDraft.editingEntry : null;
  $('#entry-submit').textContent = editingEntry ? 'Save changes' : 'Save entry locally'; $('#cancel-entry-edit').hidden = !editingEntry; $('#desk-title').textContent = editingEntry ? 'Edit entry' : 'New entry';
  openDesk(); $('#draft-status').textContent = 'Recovered your private draft from this tab.'; saveDraft();
}
function download(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], {type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Restoring asks merge or replace in the drawer. Merge is the default (focused, and the only one-click choice):
// it never deletes and never puts back an older copy. Replace needs a second confirm because it can do both.
function restore(incoming) {
  const s = mergeSummary(S.data, incoming), ids = new Set([...incoming.goals, ...incoming.entries].map(r => r.id));
  const lost = [...S.data.goals, ...S.data.entries].filter(r => !ids.has(r.id)).length;
  openDrawer({title:'Restore a backup', body:`<p>This backup has ${plural(incoming.entries.length, 'entry', 'entries')} and ${plural(incoming.goals.length, 'goal')}.</p>
    <p><b>Merge</b> keeps the newer copy of each record: ${s.added} new here, ${s.newer} newer than the copy here, ${s.kept} older or the same, so the copy here stays. A record saved before edit times were recorded counts as oldest. Merge deletes nothing, so a record you deleted since this backup comes back.</p>
    <p class="alert danger">Replace everything makes this browser match the backup exactly. ${lost ? `${plural(lost, 'record')} not in the backup will be deleted` : 'Nothing here is missing from the backup'}, and newer edits are reverted to the backup's copies.${syncOn() ? ' With sync on, this also happens on your other devices and to your wingmate’s goals.' : ''} Export a backup first if you might want them.</p>`,
    foot:'<button type="button" class="secondary" data-close>Cancel</button><button type="button" data-restore="replace" class="secondary">Replace everything…</button><button type="button" data-restore="merge">Merge</button>'});
  const merge = $('#drawer-foot [data-restore=merge]');
  merge.focus();
  merge.onclick = () => { closeDrawer(); if (persist(mergeBackups(S.data, incoming))) toast(syncOn() ? 'Backup merged. The merged records sync next.' : 'Backup merged. These records stay private in this browser.', 'ok'); };
  $('#drawer-foot [data-restore=replace]').onclick = () => {
    if (!confirm(`Replace your whole journal with this backup? ${lost ? `${plural(lost, 'record')} will be deleted and ` : ''}any newer edits will be lost${syncOn() ? ', here and on every synced device' : ''}. This can't be undone.`)) return;
    closeDrawer(); if (persist(validateBackup(incoming))) toast('Journal replaced with the backup.', 'ok');
  };
}
export function wire() {
  if (S.store.locked) {
    document.querySelectorAll('#journal-form button,#import').forEach(b => b.disabled = true);
    $('#recover').hidden = false;
  }
  document.getElementById('logbook').classList.add('vk');
  document.addEventListener('data-change', render);
  document.addEventListener('journal-synced', renderBackupAge);
  // New entry (or n anywhere on the Logbook) puts the cursor in the writing desk.
  const compose = () => { const f = $('#journal-form'); openDesk(); f.scrollIntoView({block:'nearest'}); f.elements.title.focus(); };
  $('#new-entry').onclick = compose;
  $('#backup-now').onclick = () => $('#export').click();
  document.addEventListener('keydown', event => {
    if (event.key !== 'n' || $('#logbook').hidden || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]')) return;
    event.preventDefault(); compose();
  });
  $('#journal-form').onsubmit = event => {
    event.preventDefault(); clearTimeout(draftTimer);
    const fields = Object.fromEntries(new FormData(event.target));
    if (!fields.title.trim() || !fields.body.trim()) return;
    const prior = editingEntry && S.data.entries.find(e => e.id === editingEntry);
    if (editingEntry && !prior) { notice('This entry no longer exists. Cancel editing to save it as a new entry.'); return; }
    // Start from the saved entry so fields a newer build added to it survive an edit made here.
    const entry = {...prior, ...fields, title:fields.title.trim(), body:fields.body.trim(), id:editingEntry || crypto.randomUUID(), updatedAt:editedAt(prior)};
    if (persist({...S.data, entries:editingEntry ? S.data.entries.map(e => e.id === editingEntry ? entry : e) : [...S.data.entries, entry]})) { const edited = editingEntry; resetEntry(); toast(`${edited ? 'Entry updated' : 'Entry saved'}. ${syncOn() ? 'It syncs privately to your pilot.' : 'It stays private in this browser.'}`, 'ok'); }
  };
  $('#journal-form').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); });
  $('#journal-form').addEventListener('change', saveDraft);
  window.addEventListener('pagehide', () => { if ($('#journal-form').elements.title.value || $('#journal-form').elements.body.value) saveDraft(); });
  $('#cancel-entry-edit').onclick = () => { if (confirm('Discard the current edit? The saved entry will stay unchanged.')) { clearTimeout(draftTimer); resetEntry(); } };
  $('#discard-draft').onclick = () => { if (confirm('Discard this draft? Saved journal entries will stay unchanged.')) { clearTimeout(draftTimer); resetEntry(); } };
  $('#journal-search').oninput = renderEntries;
  $('#journal-pilot').onchange = renderEntries;
  $('#journal-category').onchange = renderEntries;
  document.addEventListener('click', event => {
    const row = event.target.closest('#entries [data-entry]');
    if (row && !event.target.closest('button')) readEntry(row.dataset.entry);
    const b = event.target.closest('button');
    if (b?.dataset.editEntry) editEntry(b.dataset.editEntry);
    if (b?.dataset.deleteEntry && confirm('Delete this private entry? Export a backup first if you want to keep it.')) {
      closeDrawer();
      if (persist({...S.data, entries:S.data.entries.filter(e => e.id !== b.dataset.deleteEntry)}) && editingEntry === b.dataset.deleteEntry) resetEntry();
    }
  });
  $('#export').onclick = () => {
    if (S.store.locked) { notice('Export is blocked because the journal could not be read. Use Download raw recovery file.'); return; }
    download(JSON.stringify(S.data, null, 2), `eve-journal-${localDate()}.json`);
    $('#backup-status').textContent = `Backup requested ${when(Date.now())}. It contains private notes.`;
    try { localStorage.setItem(EXPORTED, String(Date.now())); } catch { /* The reminder just stays. */ }
    renderBackupAge();
  };
  $('#recover').onclick = () => { try { download(localStorage.getItem(KEY) || '', `eve-journal-recovery-${localDate()}.json`); } catch { notice('Browser storage is inaccessible. Recovery requires access to this browser’s site data.'); } };
  $('#import').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 5000000) throw new Error('Backup must be under 5 MB.');
      restore(validateBackup(JSON.parse(await file.text())));
    } catch (error) { notice(`Import failed: ${error.message}`); }
    finally { event.target.value = ''; }
  };
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    // With sync on, tabs and devices change the journal all the time: adopt the saved copy (forms keep what's typed).
    if (syncOn() && !S.store.locked) { try { S.data = S.store.load(); document.dispatchEvent(new Event('data-change')); return; } catch { /* Fall through to the warning. */ } }
    notice('Another tab changed this journal. Reload before saving. Your current draft is preserved in this tab.');
  });
}
