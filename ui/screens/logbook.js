// Logbook: private journal entries with search and filters, drafts that survive reloads, and backup/restore.
import {validateBackup, mergeBackups, localDate, filterEntries} from '../../model.js';
import {S, KEY, DRAFT} from '../state.js';
import {$, esc, plural, notice, toast, persist, go, openDrawer, closeDrawer} from '../shared.js';
import {readout} from './pilot.js';

const CATEGORIES = '<option>Adventure</option><option>Milestone</option><option>Lesson learned</option><option>Fleet</option><option>Industry</option>';
export const markup = {logbook:`<div class="toolbar" role="toolbar" aria-label="Logbook">
  <label class="field--inline field--search"><span class="sr-only">Search entries</span><input id="journal-search" type="search" data-filter placeholder="Search titles and notes  /" autocomplete="off"></label>
  <label class="field--inline">Pilot<select id="journal-pilot"><option value="">All pilots</option></select></label>
  <label class="field--inline">Focus<select id="journal-category"><option value="">All entries</option>${CATEGORIES}</select></label>
  <button type="button" id="new-entry" class="toolbar__end" aria-keyshortcuts="N">New entry</button></div>
 <div id="logbook-summary"></div>
 <div class="logbook">
  <section id="journal" class="card panel--primary logbook__list" aria-label="Entries"><p id="entry-count" class="hint" role="status"></p><div id="entries"></div></section>
  <section class="card desk" aria-labelledby="desk-title">
   <div class="panel__head"><h2 id="desk-title">New entry</h2><p id="draft-status" class="hint" role="status">Private draft · saved in this tab</p></div>
   <form id="journal-form"><label>Entry title<input name="title" maxlength="160" required placeholder="Our first trip into low-sec"></label><label class="desk__body">Private notes<textarea name="body" required maxlength="20000" rows="9" placeholder="What happened? What did you learn?"></textarea></label><div class="desk__meta"><label>Pilot<select name="pilot" class="pilot-select"></select></label><label>Date<input name="date" type="date" required></label><label>Focus<select name="category">${CATEGORIES}</select></label></div><div class="actions"><button id="entry-submit">Save entry locally</button><button id="cancel-entry-edit" type="button" class="secondary" hidden>Cancel edit</button><button id="discard-draft" type="button" class="secondary">Discard draft</button></div></form>
  </section>
 </div>
 <section class="card backup" aria-labelledby="backup-title"><div class="panel__head"><div><h2 id="backup-title">Backup</h2><p class="panel__sub">Entries and shared goals live only in this browser. Export a backup to keep them safe or move them.</p></div></div>
  <div class="backup__actions"><button id="export" class="secondary">Export backup</button><label class="import secondary-like">Restore or merge a backup<input id="import" type="file" accept="application/json,.json"></label><button id="recover" class="secondary" hidden>Download raw recovery file</button></div>
  <p id="backup-status" class="hint" role="status">Restore or merge a backup file.</p></section>`};

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
  $('#entry-count').textContent = entries.length === all.length ? `${plural(all.length, 'entry', 'entries')} · private to this browser` : `${entries.length} of ${plural(all.length, 'entry', 'entries')} match`;
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
export function render() { authorFilter(); renderEntries(); }
function saveDraft() {
  clearTimeout(draftTimer);
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({...Object.fromEntries(new FormData($('#journal-form'))), editingEntry}));
    $('#draft-status').textContent = `Draft saved in this tab at ${new Date().toLocaleTimeString()}`;
  } catch { $('#draft-status').textContent = 'Draft could not be saved. Keep this tab open until you save the entry.'; }
}
export function resetEntry(preserveDraft = false) {
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
  closeDrawer(); go('logbook'); f.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start'}); f.elements.title.focus(); saveDraft();
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
  $('#draft-status').textContent = 'Recovered your private draft from this tab.'; saveDraft();
}
function download(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], {type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function wire() {
  if (S.store.locked) {
    document.querySelectorAll('#journal-form button,#import').forEach(b => b.disabled = true);
    $('#recover').hidden = false;
  }
  document.getElementById('logbook').classList.add('vk');
  document.addEventListener('data-change', render);
  // New entry (or n anywhere on the Logbook) puts the cursor in the writing desk.
  const compose = () => { const f = $('#journal-form'); f.scrollIntoView({block:'nearest'}); f.elements.title.focus(); };
  $('#new-entry').onclick = compose;
  document.addEventListener('keydown', event => {
    if (event.key !== 'n' || $('#logbook').hidden || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]')) return;
    event.preventDefault(); compose();
  });
  $('#journal-form').onsubmit = event => {
    event.preventDefault(); clearTimeout(draftTimer);
    const fields = Object.fromEntries(new FormData(event.target));
    if (!fields.title.trim() || !fields.body.trim()) return;
    const entry = {...fields, title:fields.title.trim(), body:fields.body.trim(), id:editingEntry || crypto.randomUUID()};
    if (editingEntry && !S.data.entries.some(e => e.id === editingEntry)) { notice('This entry no longer exists. Cancel editing to save it as a new entry.'); return; }
    if (persist({...S.data, entries:editingEntry ? S.data.entries.map(e => e.id === editingEntry ? entry : e) : [...S.data.entries, entry]})) { const edited = editingEntry; resetEntry(); toast(edited ? 'Entry updated. It stays private in this browser.' : 'Entry saved. It stays private in this browser.', 'ok'); }
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
    $('#backup-status').textContent = `Backup requested ${new Date().toLocaleString()}. It contains private notes.`;
  };
  $('#recover').onclick = () => { try { download(localStorage.getItem(KEY) || '', `eve-journal-recovery-${localDate()}.json`); } catch { notice('Browser storage is inaccessible. Recovery requires access to this browser’s site data.'); } };
  $('#import').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 5000000) throw new Error('Backup must be under 5 MB.');
      const incoming = validateBackup(JSON.parse(await file.text()));
      if (confirm(`Merge ${incoming.entries.length} entries and ${incoming.goals.length} goals? Matching IDs will be replaced.`)) {
        if (persist(mergeBackups(S.data, incoming))) toast('Backup merged. These records stay private in this browser.', 'ok');
      }
    } catch (error) { notice(`Import failed: ${error.message}`); }
    finally { event.target.value = ''; }
  };
  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) notice('Another tab changed this journal. Reload before saving. Your current draft is preserved in this tab.');
  });
}
