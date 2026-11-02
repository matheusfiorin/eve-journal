// Logbook: private journal entries with search and filters, drafts that survive reloads, and backup/restore.
import {validateBackup, mergeBackups, localDate, filterEntries} from '../../model.js';
import {S, KEY, DRAFT} from '../state.js';
import {$, esc, notice, toast, persist, go} from '../shared.js';

const CATEGORIES = '<option>Adventure</option><option>Milestone</option><option>Lesson learned</option><option>Fleet</option><option>Industry</option>';
export const markup = {logbook:`<p class="hint">Entries are stored only in this browser. Export a backup to keep them.</p>
 <div id="journal" class="card panel--primary">
  <div class="card-head"><h2>Logbook</h2><button id="export" class="secondary small">Export backup</button></div>
  <form id="journal-form"><label>Entry title<input name="title" maxlength="160" required placeholder="Our first trip into low-sec"></label><div class="row"><label>Pilot<select name="pilot" class="pilot-select"></select></label><label>Date<input name="date" type="date" required></label><label>Focus<select name="category">${CATEGORIES}</select></label></div><label>Private notes<textarea name="body" required maxlength="20000" rows="4" placeholder="What happened? What did you learn?"></textarea></label><div class="actions"><button id="entry-submit">Save entry locally</button><button id="cancel-entry-edit" type="button" class="secondary" hidden>Cancel edit</button><button id="discard-draft" type="button" class="secondary">Discard draft</button></div><p id="draft-status" class="hint" role="status">Private draft · saved in this tab</p></form>
  <div class="row toolbar-row"><label>Search<input id="journal-search" type="search" data-filter placeholder="Titles and notes"></label><label>Pilot<select id="journal-pilot"><option value="">All pilots</option></select></label><label>Focus<select id="journal-category"><option value="">All entries</option>${CATEGORIES}</select></label></div>
  <p id="entry-count" class="hint"></p><div id="entries"></div>
  <div class="backup"><p id="backup-status" class="hint">Restore or merge a backup file.</p><label class="import">Backup file<input id="import" type="file" accept="application/json,.json"></label><button id="recover" class="secondary" hidden>Download raw recovery file</button></div>
 </div>`};

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
function renderEntries() {
  const entries = filterEntries(S.data.entries, {query:$('#journal-search').value, pilot:$('#journal-pilot').value, category:$('#journal-category').value});
  $('#entry-count').textContent = `${entries.length} of ${S.data.entries.length} entries · private to this browser`;
  $('#entries').innerHTML = entries.length ? entries.map(e => `<article class="entry"><div class="card-head"><div><small>${esc(e.date)} · ${esc(e.pilot)} · ${esc(e.category || 'Adventure')}</small><h3>${esc(e.title)}</h3></div><div class="actions"><button data-edit-entry="${esc(e.id)}" class="secondary small">Edit</button><button data-delete-entry="${esc(e.id)}" class="secondary small" aria-label="Delete ${esc(e.title)}">Delete</button></div></div><p>${esc(e.body)}</p></article>`).join('')
    : `<div class="empty">${S.data.entries.length ? 'No entries match. Try a different search or filter.' : 'Every capsuleer starts somewhere. Write your first entry.'}</div>`;
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
  $('#entry-submit').textContent = 'Save entry locally'; $('#cancel-entry-edit').hidden = true;
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
  $('#entry-submit').textContent = 'Save changes'; $('#cancel-entry-edit').hidden = false;
  go('logbook'); f.scrollIntoView({behavior:'smooth', block:'start'}); f.elements.title.focus(); saveDraft();
}
export function restoreDraft() {
  if (!(recoveredDraft && typeof recoveredDraft.title === 'string' && typeof recoveredDraft.body === 'string' && recoveredDraft.title.length <= 160 && recoveredDraft.body.length <= 20000)) return;
  const f = $('#journal-form');
  for (const key of ['title','body','date','category','pilot']) if (typeof recoveredDraft[key] === 'string') {
    if (key === 'pilot' && ![...f.elements.pilot.options].some(o => o.value === recoveredDraft.pilot)) f.elements.pilot.add(new Option(recoveredDraft.pilot, recoveredDraft.pilot));
    f.elements[key].value = recoveredDraft[key];
  }
  editingEntry = S.data.entries.some(e => e.id === recoveredDraft.editingEntry) ? recoveredDraft.editingEntry : null;
  $('#entry-submit').textContent = editingEntry ? 'Save changes' : 'Save entry locally'; $('#cancel-entry-edit').hidden = !editingEntry;
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
  document.addEventListener('data-change', render);
  $('#journal-form').onsubmit = event => {
    event.preventDefault(); clearTimeout(draftTimer);
    const fields = Object.fromEntries(new FormData(event.target));
    if (!fields.title.trim() || !fields.body.trim()) return;
    const entry = {...fields, title:fields.title.trim(), body:fields.body.trim(), id:editingEntry || crypto.randomUUID()};
    if (editingEntry && !S.data.entries.some(e => e.id === editingEntry)) { notice('This entry no longer exists. Cancel editing to save it as a new entry.'); return; }
    if (persist({...S.data, entries:editingEntry ? S.data.entries.map(e => e.id === editingEntry ? entry : e) : [...S.data.entries, entry]})) { resetEntry(); toast('Logbook entry saved privately in this browser.', 'ok'); }
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
    const b = event.target.closest('button');
    if (b?.dataset.editEntry) editEntry(b.dataset.editEntry);
    if (b?.dataset.deleteEntry && confirm('Delete this private entry? Export a backup first if you want to keep it.')) {
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
