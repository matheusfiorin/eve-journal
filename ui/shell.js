// The Echelon shell: the information architecture (7 destinations and their views), the rail, the mobile tab bar,
// the view bar with sub-view tabs, the status strip, the command palette, keyboard shortcuts and the boot sequence.
import {S, mine, summary} from './state.js';
import {$, esc, format, openDrawer, closeDrawer, go} from './shared.js';
import {mapGraph} from './routes.js';
import {openMap} from './mapmodal.js';
import {loadMarket} from './marketdata.js';

export const DESTS = [
  {id:'bridge', label:'Bridge', key:'b', views:[{id:'bridge', slug:'', label:'Bridge'}]},
  {id:'wing', label:'Wing', key:'w', views:[{id:'strengths', slug:'crew', label:'Crew map'}, {id:'goals', slug:'goals', label:'Goals'}]},
  {id:'pilot', label:'Pilot', key:'p', sep:true, views:[{id:'training', slug:'training', label:'Training'}, {id:'skills', slug:'skills', label:'Skills'}, {id:'clones', slug:'clones', label:'Clones'}]},
  {id:'earn', label:'Earn', key:'e', views:[{id:'industry', slug:'build', label:'Build'}, {id:'mining', slug:'mine', label:'Mine'}, {id:'exploration', slug:'explore', label:'Explore'}, {id:'market', slug:'trade', label:'Trade'}]},
  {id:'navigate', label:'Navigate', key:'n', views:[{id:'map', slug:'map', label:'Star map'}, {id:'hauling', slug:'haul', label:'Haul plan'}]},
  {id:'ledger', label:'Ledger', key:'l', sep:true, views:[{id:'ledger', slug:'', label:'Ledger'}]},
  {id:'logbook', label:'Logbook', key:'j', views:[{id:'logbook', slug:'', label:'Logbook'}]}
];
const DEST = Object.fromEntries(DESTS.map(d => [d.id, d]));
export const VIEWS = Object.fromEntries(DESTS.flatMap(d => d.views.map(v => [v.id, {...v, dest:d}])));
// Tab ids and hashes from before the redesign.
const OLD = {overview:'bridge', empire:'strengths', wallet:'ledger', operations:'ledger', notes:'logbook', journal:'logbook'};
const TABBAR = ['bridge', 'wing', 'earn', 'navigate'];
const store = {get:k => { try { return localStorage.getItem(k); } catch { return null; } }, set:(k, v) => { try { localStorage.setItem(k, v); } catch { /* Per-browser convenience only. */ } }};

// A view id, an old tab id, a destination ("earn", its last-used view) or "earn/mine" → a view id, or null.
export function resolve(key) {
  key = OLD[key] || key;
  if (VIEWS[key]) return key;
  const [d, slug] = key.split('/'), dest = DEST[d];
  if (!dest) return null;
  if (slug === undefined) return VIEWS[store.get(`eve.sub.${d}`)]?.dest === dest ? store.get(`eve.sub.${d}`) : dest.views[0].id;
  return dest.views.find(v => v.slug === slug)?.id || null;
}
export const hashOf = id => { const v = VIEWS[id]; return v.dest.views.length > 1 ? `${v.dest.id}/${v.slug}` : v.dest.id; };
export const currentView = () => document.querySelector('.view:not([hidden])')?.id;

const icon = name => `<svg class="ico" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export function build() {
  $('#rail-list').innerHTML = DESTS.map((d, i) => `${d.sep ? '<li class="rail__sep" role="separator"></li>' : ''}<li><button class="rail__item" data-go="${d.id}" data-dest="${d.id}" data-key="${d.key}" data-label="${d.label}" aria-label="${d.label}" aria-keyshortcuts="G ${d.key.toUpperCase()}" style="--i:${i}">${icon(d.id)}<span>${d.label}</span><kbd>G ${d.key.toUpperCase()}</kbd></button></li>`).join('');
  $('#tabbar').insertAdjacentHTML('afterbegin', TABBAR.map(id => `<button class="tabbar__item" data-go="${id}" data-dest="${id}">${icon(id)}<span>${DEST[id].label}</span></button>`).join(''));
  if (store.get('eve.rail') === 'collapsed') toggleRail(true);
}
// Light the current destination everywhere, and draw its title and sub-view tabs.
export function mark(id) {
  const dest = VIEWS[id].dest;
  document.querySelectorAll('[data-dest]').forEach(b => b.dataset.dest === dest.id ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $('#tabbar-more').toggleAttribute('aria-current', !TABBAR.includes(dest.id));
  if (dest.views.length > 1) store.set(`eve.sub.${dest.id}`, id);
  const bar = $('#viewbar');
  bar.hidden = dest.id === 'bridge';
  bar.innerHTML = `<h1 class="screen-title">${dest.label}</h1>${dest.views.length > 1 ? `<div class="seg" role="tablist" aria-label="${dest.label}">${dest.views.map((v, i) => `<button role="tab" data-go="${v.id}" aria-selected="${v.id === id}" tabindex="${v.id === id ? 0 : -1}" aria-keyshortcuts="${i + 1}">${v.label}</button>`).join('')}</div>` : ''}`;
  document.title = `${dest.views.length > 1 ? `${VIEWS[id].label} · ` : ''}${dest.label} · Echelon`;
}
export function renderStrip() {
  const u = S.universeStatus, w = summary(mine()).wallet;
  $('#server-status').innerHTML = u ? `<span class="dot ${u.stale ? '' : 'on'}"></span><span><span class="num">${Number(u.players).toLocaleString()}</span> pilots online${u.vip ? ' · VIP only' : ''}${u.stale ? ' · last known' : ''}</span>` : '<span class="dot"></span><span>Tranquility status unavailable</span>';
  $('#strip-wallet').innerHTML = w === undefined ? '' : `<span class="num">${format(w, 'isk').replace(' ISK', '')}</span> ISK`;
  $('#strip-wallet').hidden = w === undefined;
}
export function toggleRail(force) {
  const collapsed = force ?? document.body.dataset.rail !== 'collapsed';
  document.body.dataset.rail = collapsed ? 'collapsed' : '';
  $('#rail-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#rail-toggle').setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
  if (force === undefined) store.set('eve.rail', collapsed ? 'collapsed' : '');
}
// The one orchestrated moment: rail items, the strip sweep and the primary ruler, once per browser session.
export function boot() {
  try { if (sessionStorage.getItem('eve.booted')) return; sessionStorage.setItem('eve.booted', '1'); } catch { /* Boot plays every load. */ }
  document.body.classList.add('booting');
  setTimeout(() => document.body.classList.remove('booting'), 1200);
}

const SHORTCUTS = [['Ctrl K', 'Search or jump anywhere'], ['G then B W P E N L J', 'Bridge, Wing, Pilot, Earn, Navigate, Ledger, Logbook'], ['1–4', 'Switch view inside the current screen'],
  ['/', 'Focus the search on this view'], ['J K', 'Next or previous row'], ['R', 'Refresh EVE data'], ['[', 'Collapse or expand the navigation'], ['?', 'Show these shortcuts'], ['Esc', 'Close the open dialog']];
export const openShortcuts = () => openDrawer({title:'Keyboard shortcuts', body:`<dl class="keys">${SHORTCUTS.map(([k, what]) => `<div><dt>${k.split(' ').map(x => x === 'then' ? '<span>then</span>' : `<kbd>${x}</kbd>`).join(' ')}</dt><dd>${what}</dd></div>`).join('')}</dl>`});
function openMore() {
  const items = DESTS.filter(d => !TABBAR.includes(d.id)).flatMap(d => d.views.map(v => [v.id, v.label, d.label])).concat([['goals', 'Goals', 'Wing']]);
  openDrawer({title:'More', body:`<ul class="sheet-list">${items.map(([id, label, group]) => `<li><button class="sheet-item" data-go="${id}"><span>${label}</span><small>${group === label ? '' : group}</small></button></li>`).join('')}<li><button class="sheet-item" data-palette><span>Search or jump</span><small>Screens, systems, actions</small></button></li></ul>`});
}

// ── Command palette ──
let palItems = [], palIdx = 0;
function sources() {
  const screens = Object.values(VIEWS).map(v => ({kind:'Screen', label:v.label, hint:v.label === v.dest.label ? '' : v.dest.label, run:() => go(v.id)}));
  const actions = [
    {kind:'Action', label:'Refresh EVE data', run:() => $('#refresh').click()},
    {kind:'Action', label:'Switch pilot', run:() => $('#switch-pilot').click()},
    {kind:'Action', label:'New logbook entry', run:() => { go('logbook'); $('#journal-form [name=title]')?.focus(); }},
    {kind:'Action', label:'Add shared goal', run:() => { go('goals'); $('#goal-form [name=title]')?.focus(); }},
    {kind:'Action', label:'Export backup', run:() => $('#export')?.click()},
    {kind:'Action', label:'Collapse navigation', run:() => toggleRail()},
    {kind:'Action', label:'Show keyboard shortcuts', run:openShortcuts}
  ];
  const g = mapGraph(), systems = g ? [...g.systems.values()].map(s => ({kind:'System', label:s.name, hint:'Show on the map', run:() => openMap({system:s.id})})) : [];
  return [...screens, ...actions, ...systems];
}
const score = (q, s) => { s = s.toLowerCase(); if (s.startsWith(q)) return 3; if (s.includes(` ${q}`)) return 2; let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length ? 1 : 0; };
function paletteRender() {
  const input = $('#palette-input'), q = input.value.trim().toLowerCase(), list = $('#palette-list');
  palItems = (q ? sources().map(x => [score(q, x.label), x]).filter(([s]) => s).sort((a, b) => b[0] - a[0]).map(([, x]) => x) : sources().filter(x => x.kind !== 'System')).slice(0, 40);
  palIdx = 0;
  list.innerHTML = palItems.length ? palItems.map((x, i) => `<li id="pal-${i}" role="option" class="palette__opt" aria-selected="${i === 0}"><span class="palette__kind">${x.kind}</span><span>${esc(x.label)}</span><small>${esc(x.hint || '')}</small></li>`).join('')
    : `<li class="palette__empty" role="option" aria-disabled="true">No match for “${esc(input.value)}”. Try a system name or a screen like “Mine”.</li>`;
  input.setAttribute('aria-activedescendant', palItems.length ? 'pal-0' : '');
}
function paletteMove(d) {
  if (!palItems.length) return;
  const list = $('#palette-list');
  list.children[palIdx].setAttribute('aria-selected', 'false');
  palIdx = (palIdx + d + palItems.length) % palItems.length;
  const el = list.children[palIdx]; el.setAttribute('aria-selected', 'true'); el.scrollIntoView({block:'nearest'});
  $('#palette-input').setAttribute('aria-activedescendant', el.id);
}
function runItem(i) { const x = palItems[i]; if (!x) return; $('#palette').close(); x.run(); }
export function openPalette() {
  closeDrawer(); $('#palette-input').value = ''; paletteRender(); if (!$('#palette').open) $('#palette').showModal(); $('#palette-input').focus();
  // Systems come from the market snapshot's gate graph; load it so they can be searched from any screen.
  if (S.backend && !S.marketData) loadMarket().then(() => { if ($('#palette').open) paletteRender(); }, () => {});
}

// Roving focus over a view's main list rows ([data-row]); screens opt in by marking their rows.
function moveRow(view, d) {
  const rows = [...document.querySelectorAll(`#${view} [data-row]`)];
  if (!rows.length) return;
  const i = rows.indexOf(document.activeElement.closest('[data-row]'));
  rows[Math.max(0, Math.min(rows.length - 1, i + d))].focus();
}

export function wire() {
  $('#rail-toggle').onclick = () => toggleRail();
  $('#palette-open').onclick = openPalette;
  $('#tabbar-more').onclick = openMore;
  $('#drawer').addEventListener('click', event => {
    if (event.target === $('#drawer') || event.target.closest('[data-close]')) closeDrawer();
    if (event.target.closest('[data-palette]')) openPalette();
    if (event.target.closest('[data-go]')) closeDrawer();
  });
  $('#palette-input').addEventListener('input', paletteRender);
  $('#palette-input').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); paletteMove(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); paletteMove(-1); }
    if (event.key === 'Enter') { event.preventDefault(); runItem(palIdx); }
  });
  $('#palette-list').addEventListener('click', event => { const li = event.target.closest('[role=option]'); if (li?.id) runItem(Number(li.id.slice(4))); });
  $('#palette').addEventListener('click', event => { if (event.target === $('#palette')) $('#palette').close(); });
  // Arrow keys move along the rail and across sub-view tabs.
  $('#rail-list').addEventListener('keydown', event => {
    const items = [...document.querySelectorAll('.rail__item')], i = items.indexOf(document.activeElement);
    const to = {ArrowDown:i + 1, ArrowUp:i - 1, Home:0, End:items.length - 1}[event.key];
    if (i < 0 || to === undefined) return;
    event.preventDefault(); items[(to + items.length) % items.length].focus();
  });
  $('#viewbar').addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('#viewbar [role=tab]')], i = tabs.indexOf(document.activeElement);
    const d = {ArrowRight:1, ArrowLeft:-1}[event.key];
    if (i < 0 || !d) return;
    event.preventDefault(); const next = tabs[(i + d + tabs.length) % tabs.length]; go(next.dataset.go); $(`#viewbar [data-go="${next.dataset.go}"]`).focus();
  });
  let gArmed = 0;
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); return; }
    if (event.target.closest('input,textarea,select,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || !$('#hero').hidden) return;
    const k = event.key, cur = currentView();
    if (gArmed && Date.now() - gArmed < 1200) {
      gArmed = 0;
      const dest = DESTS.find(d => d.key === k.toLowerCase());
      if (dest) { event.preventDefault(); go(dest.id); }
      return;
    }
    if (k === 'g') { gArmed = Date.now(); return; }
    const views = VIEWS[cur]?.dest.views;
    if (/^[1-9]$/.test(k) && views?.[k - 1]) { go(views[k - 1].id); return; }
    if (k === '/') { const f = document.querySelector(`#${cur} [data-filter]`); if (f) { event.preventDefault(); f.focus(); } }
    if (k === 'r') $('#refresh').click();
    if (k === '[') toggleRail();
    if (k === '?') openShortcuts();
    if (k === 'j' || k === 'k') moveRow(cur, k === 'j' ? 1 : -1);
  });
}
