// Pilot: the training queue, the skill sheet and clones, for whichever pilot of the wing you pick.
// It also holds the small view kit (pilot picker, readout, sortable row tables) the Navigate, Ledger and Logbook views share.
import {remaining, queueState, trainingProgress, levelOf} from '../../model.js';
import {nextSkills as buildNext, isAlpha, skillLevels} from '../../industry.js';
import {nextSkills as exploreNext} from '../../exploration.js';
import {SKILL as MINING} from '../../mining.js';
import {S, ROMAN, typeGroup, mine, ordered, summary} from '../state.js';
import {name, place} from '../esi.js';
import {loadMarket} from '../marketdata.js';
import {$, esc, when, plural, portrait, connectButtons, trainingAlert, field, openDrawer} from '../shared.js';
import {mapGraph, route} from '../routes.js';

// ── View kit ──
const store = {get:k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set:(k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* Per-browser convenience only. */ } }};
export const readout = items => `<dl class="readout">${items.map(([label, value, unit]) => `<div><dt>${label}</dt><dd>${value}${unit ? ` <small>${unit}</small>` : ''}</dd></div>`).join('')}</dl>`;
export const short = date => remaining(date).replace(' remaining', '');
// One pilot is on screen at a time in Pilot and Ledger; it starts as the pilot who's flying.
let shownName = null;
const onPilot = new Set();
export const shownPilot = () => S.pilots.find(p => p.name === shownName) || mine() || S.pilots[0] || null;
export const whenPilotChanges = render => onPilot.add(render);
export function pilotSeg() {
  const now = shownPilot();
  return S.pilots.length > 1 ? `<div class="seg seg--pilot" role="group" aria-label="Pilot">${ordered().map(p => `<button type="button" data-show-pilot="${esc(p.name)}" data-pilot="${esc(p.name.toLowerCase())}" aria-pressed="${p === now}">${portrait(p, 20, 'portrait--xs')}<span>${esc(p.name)}${p.name === S.me ? '' : ''}</span></button>`).join('')}</div>` : '';
}
// Sortable row tables: state per table in localStorage['eve.sort.<table>'], a header of sort buttons, rows with data-row for j/k.
const sorts = {}, resorts = {}, revealed = new Set();
export function sorter(table, fallback, rerender) {
  sorts[table] ||= store.get(`eve.sort.${table}`) || fallback;
  resorts[table] = rerender;
  return sorts[table];
}
export const sortBy = (list, {key, dir}, get = (x, k) => x[k]) => [...list].sort((a, b) => {
  const x = get(a, key), y = get(b, key);
  return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity)) * dir;
});
// cols: [label, sortKey?]; the first column is the main one (left aligned), the rest right aligned.
export function rowsHead(table, cols) {
  const st = sorts[table];
  return `<div class="rows__head" role="row">${cols.map(([label, key]) => key
    ? `<button type="button" role="columnheader" class="sort" data-sort="${table}:${key}" aria-sort="${st?.key === key ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}</button>`
    : `<span role="columnheader">${label}</span>`).join('')}</div>`;
}
// The first draw of a table animates its rows in; later redraws (sorting, filtering) don't.
export const reveal = table => revealed.has(table) ? '' : (revealed.add(table), 'rows--reveal');
export const rowAttrs = (i, extra = '') => `class="rows__row" role="row" data-row tabindex="${i ? -1 : 0}" style="--i:${i}" ${extra}`;

// ── Training ──
const humanize = key => key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const MINE_PLAN = [[MINING.miningFrigate, 'Mining Frigate', 1, 'Fly the Venture'], [MINING.mining, 'Mining', 4, 'Miner II and +5% yield per level'], [MINING.astrogeology, 'Astrogeology', 3, '+5% mining yield per level'], [MINING.miningBarge, 'Mining Barge', 1, 'Fly a Procurer or Retriever']];
// Skills that open up a way to earn, tagged with the activity they unlock (from the Build, Mine and Explore plans).
function suggestions(p) {
  const skills = summary(p).skills;
  if (!skills?.skills) return [];
  const ids = S.marketData?.meta?.data?.skills;
  const lvl = id => levelOf(skills, id);
  const queued = new Set((p.queue || []).map(q => `${q.skill_id}:${q.finished_level}`));
  const out = MINE_PLAN.filter(([id, , level]) => lvl(id) < level).slice(0, 2).map(([id, label, level, why]) => ({id, label, from:lvl(id), level, why, act:'mining', tag:'Mine'}));
  if (ids) {
    out.push(...buildNext(skillLevels(skills, ids), isAlpha(skills), 2).map(k => ({id:ids[k.key], label:humanize(k.key), from:k.from, level:k.level, why:k.why, act:'industry', tag:'Build'})));
    out.push(...exploreNext(key => lvl(ids[key]), 2).map(k => ({id:ids[k.key], label:humanize(k.key), from:k.from, level:k.level, why:k.why, act:'exploration', tag:'Explore'})));
  }
  // Each suggestion is the next level up, so "Mining IV" from II shows as Mining III with the goal in the reason.
  return out.filter(k => !queued.has(`${k.id}:${k.from + 1}`)).map(k => ({...k, next:k.from + 1}));
}
export const markup = {
  training:`<div class="toolbar" role="toolbar" aria-label="Training"><div id="training-pilots"></div></div><div id="training-content"></div>`,
  skills:`<div class="toolbar" role="toolbar" aria-label="Skill sheet"><div id="skills-pilots"></div>
   <label class="field--inline field--search"><span class="sr-only">Find a skill</span><input id="skill-search" type="search" data-skill-search data-filter placeholder="Find a skill  /" autocomplete="off"></label>
   <div class="chips" role="group" aria-label="Show">${[['all', 'All'], ['five', 'At V'], ['queue', 'In queue'], ['partial', 'Below V']].map(([v, l], i) => `<button type="button" class="chip-btn" data-skill-filter="${v}" aria-pressed="${!i}">${l}</button>`).join('')}</div></div>
   <div id="skills-content"></div>`,
  clones:`<div class="toolbar" role="toolbar" aria-label="Clones"><div id="clones-pilots"></div></div><div id="clones-content"></div>`
};
let marketAsked = false;
function personal(id) {
  const p = shownPilot();
  $(`#${id}-pilots`).innerHTML = pilotSeg();
  return p;
}
const empty = (msg, p, i) => `<div class="state"><p><b>${msg}</b></p>${connectButtons(p, i)}</div>`;
export function renderTraining() {
  const p = personal('training'), now = Date.now();
  if (!p) { $('#training-content').innerHTML = '<div class="state"><p>No pilots configured in config.json.</p></div>'; return; }
  const i = S.pilots.indexOf(p), state = queueState(p.queue, now);
  // The Build and Explore suggestions need the market snapshot's skill ids; fetch it once while this view is on screen.
  if (!S.marketData && S.backend && !marketAsked && !$('#training').hidden) { marketAsked = true; loadMarket().then(renderTraining, () => {}); }
  const mate = S.pilots.find(x => x !== p), ms = mate && queueState(mate.queue, now);
  const mateLine = !mate ? '' : `<p class="wing-line" data-pilot="${esc(mate.name.toLowerCase())}">${portrait(mate, 22, 'portrait--xs')}<span>${!ms ? `${esc(mate.name)}’s queue isn’t shared yet.` : ms.active ? `${esc(mate.name)} is training <b>${esc(name(ms.active.skill_id))} ${ROMAN[ms.active.finished_level]}</b>, ${esc(short(ms.active.finish_date))} left.` : `${esc(mate.name)} isn’t training right now.`}</span>${ms ? `<button type="button" class="btn--link" data-show-pilot="${esc(mate.name)}">See ${esc(mate.name)}’s queue</button>` : ''}</p>`;
  if (!state) { $('#training-content').innerHTML = `${empty(`Connect ${esc(p.name)} to see the training queue.`, p, i)}${mateLine}`; return; }
  const timed = state.pending.filter(q => q.finish_date);
  const start = Math.min(now, ...timed.map(q => Date.parse(q.start_date)).filter(Number.isFinite));
  const span = Math.max(1, (state.end || now) - start), nowAt = (now - start) / span * 100;
  const a = state.active, sp = a?.level_end_sp && a?.training_start_sp ? (a.level_end_sp - a.training_start_sp) / ((Date.parse(a.finish_date) - Date.parse(a.start_date)) / 3600000) : null;
  // Day ticks on the ruler: one every day, or every 7 days for long queues.
  const days = span / 86400000, step = days > 21 ? 7 : 1;
  const ticks = Array.from({length:Math.floor(days / step)}, (_, k) => (k + 1) * step * 86400000 / span * 100).filter(x => x < 99.5);
  const items = state.pending.map((q, n) => {
    const s = Date.parse(q.start_date), f = Date.parse(q.finish_date), on = q === a;
    const bar = Number.isFinite(s) && Number.isFinite(f) ? `<span class="bar"><i class="${on ? 'is-active' : ''}" style="left:${Math.max(0, (Math.max(s, start) - start) / span * 100).toFixed(2)}%;width:${Math.max(0.6, (f - Math.max(s, start)) / span * 100).toFixed(2)}%"></i></span>` : '<span class="bar bar--paused"></span>';
    return `<li ${rowAttrs(n, `data-queue="${n}"`).replace('class="rows__row"', `class="rows__row${on ? ' is-active' : ''}"`)}><span class="q-n num">${n + 1}</span><span class="q-name">${esc(name(q.skill_id))} <b>${ROMAN[q.finished_level]}</b></span>${bar}${q.finish_date ? `<small class="num">${esc(short(q.finish_date))}</small>` : '<small>Paused / not scheduled</small>'}</li>`;
  }).join('');
  const next = suggestions(p);
  $('#training-content').innerHTML = `
  ${readout([['Training now', a ? `<span class="readout__text">${esc(name(a.skill_id))} ${ROMAN[a.finished_level]}</span>` : '<span class="readout__text">Nothing</span>'], ['Queue ends in', state.end ? `<span class="num">${esc(short(state.end))}</span>` : '—'], sp ? ['Training speed', `<span class="num">${Math.round(sp).toLocaleString()}</span>`, 'SP/h'] : ['Skills queued', `<span class="num">${state.pending.length}</span>`]])}
  ${trainingAlert(p)}
  <section class="card panel--primary queue" data-pilot="${esc(p.name.toLowerCase())}" aria-label="${esc(p.name)}’s training queue">
    ${a ? `<div class="active"><div><span class="label">Training now</span><h3>${esc(name(a.skill_id))} ${ROMAN[a.finished_level]}</h3></div><p class="active__left"><span class="num">${esc(short(a.finish_date))}</span><small>ends ${esc(when(a.finish_date))}</small></p><progress max="100" value="${trainingProgress(a, now).toFixed(1)}" aria-label="Current skill progress"></progress></div>` : ''}
    <div class="ruler" aria-hidden="true">${ticks.map(x => `<i style="left:${x.toFixed(2)}%"></i>`).join('')}<span class="ruler__now" style="left:${Math.min(100, nowAt).toFixed(2)}%">now</span><span class="ruler__end">${state.end ? esc(new Date(state.end).toLocaleDateString(undefined, {month:'short', day:'numeric'})) : ''}</span></div>
    <ol class="timeline rows ${reveal(`training-${p.name}`)}" aria-label="${plural(state.pending.length, 'skill')} queued">${items || '<li class="timeline__empty">Your training queue is empty. Add a skill in EVE Online.</li>'}</ol>
    ${p.private ? '' : connectButtons(p, i)}
  </section>
  ${next.length ? `<section class="card suggest"><h2>Suggested next</h2><p class="panel__sub">Each opens up a way to earn. One level at a time; the goal level is noted.</p><ul class="suggest__list">${next.map(k => `<li data-act="${k.act}"><span class="suggest__tag">${k.tag}</span><span><b>${esc(k.label)} ${ROMAN[k.next]}</b><small>${esc(k.why)}${k.level > k.next ? ` · aim for ${ROMAN[k.level]}` : ''}</small></span><button type="button" class="btn--link" data-go="${k.act}">Open ${k.tag}</button></li>`).join('')}</ul></section>` : ''}
  ${mateLine}`;
}
function queueDrawer(n) {
  const p = shownPilot(), state = queueState(p?.queue), q = state?.pending[n];
  if (!q) return;
  const list = summary(p).skills?.skills?.find(s => s.skill_id === q.skill_id);
  openDrawer({title:`${name(q.skill_id)} ${ROMAN[q.finished_level]}`, body:`${readout([['Position', `<span class="num">${n + 1}</span>`, `of ${state.pending.length}`], ['Finishes in', q.finish_date ? `<span class="num">${esc(short(q.finish_date))}</span>` : 'Paused']])}
    <dl class="kv">${q.start_date ? `<div><dt>Starts</dt><dd>${esc(when(q.start_date))}</dd></div>` : ''}${q.finish_date ? `<div><dt>Finishes</dt><dd>${esc(when(q.finish_date))}</dd></div>` : ''}${list ? `<div><dt>Trained now</dt><dd>Level ${list.trained_skill_level} · ${(list.skillpoints_in_skill || 0).toLocaleString()} SP</dd></div>` : ''}${q.level_end_sp ? `<div><dt>Level ends at</dt><dd>${q.level_end_sp.toLocaleString()} SP</dd></div>` : ''}</dl>
    <p class="hint">Reorder or pause the queue in EVE Online; it syncs here on the next refresh.</p>`});
}

// ── Skills ──
let skillFilter = 'all';
const pips = s => `<span class="pips" aria-label="Level ${s.trained_skill_level}${s.active_skill_level < s.trained_skill_level ? `, active ${s.active_skill_level}` : ''}">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= s.active_skill_level ? 'on' : n <= s.trained_skill_level ? 'idle' : ''}"></i>`).join('')}</span>`;
export function renderSkills() {
  const p = personal('skills');
  if (!p) { $('#skills-content').innerHTML = '<div class="state"><p>No pilots configured in config.json.</p></div>'; return; }
  const i = S.pilots.indexOf(p), skills = summary(p).skills, list = skills?.skills;
  if (!list) { $('#skills-content').innerHTML = empty(`${skills ? `${Number(skills.total_sp).toLocaleString()} skill points. ` : ''}Connect ${esc(p.name)} to see the full skill sheet.`, p, i); return; }
  const st = sorter('skills', {key:'name', dir:1}, renderSkills);
  const queued = new Map((p.queue || []).filter(q => !q.finish_date || Date.parse(q.finish_date) > Date.now()).map(q => [q.skill_id, q]));
  const groups = new Map();
  for (const s of list) { const g = typeGroup.get(s.skill_id) || 'Other skills'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  const maxGroup = Math.max(...[...groups.values()].map(g => g.reduce((t, s) => t + (s.skillpoints_in_skill || 0), 0)), 1);
  const get = (s, k) => k === 'name' ? name(s.skill_id) : k === 'level' ? s.trained_skill_level * 10 + s.active_skill_level : s.skillpoints_in_skill || 0;
  const open = $('#skill-search')?.value.trim() || skillFilter !== 'all';
  $('#skills-content').innerHTML = `
  ${readout([['Total skill points', `<span class="num">${Number(skills.total_sp).toLocaleString()}</span>`], ['Skills at V', `<span class="num">${list.filter(s => s.trained_skill_level === 5).length}</span>`, `of ${list.length}`], ['Unallocated', `<span class="num">${Number(skills.unallocated_sp || 0).toLocaleString()}</span>`, 'SP']])}
  <section class="card panel--primary sheet" data-pilot="${esc(p.name.toLowerCase())}" aria-label="${esc(p.name)}’s skill sheet">
    <div class="rows sheet__rows" role="table" aria-label="Skills">${rowsHead('skills', [['Skill', 'name'], ['Level', 'level'], ['Skill points', 'sp']])}
    ${[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([group, skills]) => { const total = skills.reduce((t, s) => t + (s.skillpoints_in_skill || 0), 0); return `<details class="skill-group" ${open ? 'open' : ''}><summary><b>${esc(group)}</b><span class="skill-group__bar" aria-hidden="true"><i style="width:${(total / maxGroup * 100).toFixed(1)}%"></i></span><span class="hint">${plural(skills.length, 'skill')} · <span class="num">${total.toLocaleString()}</span> SP</span></summary>
      ${sortBy(skills, st, get).map(s => { const q = queued.get(s.skill_id); return `<div class="skill rows__row" role="row" data-row tabindex="-1" data-skill="${s.skill_id}" data-five="${s.trained_skill_level === 5}" data-queue="${Boolean(q)}"><span role="cell" class="skill__name">${esc(name(s.skill_id))}${q ? ` <span class="chip chip--accent">to ${ROMAN[q.finished_level]}${q.finish_date ? ` · ${esc(short(q.finish_date))}` : ''}</span>` : ''}</span><span role="cell" class="skill__lvl rows__key">${pips(s)}<small>${s.active_skill_level < s.trained_skill_level ? `Active ${s.active_skill_level} of ${s.trained_skill_level}` : `Level ${s.trained_skill_level}`}</small></span><span role="cell" class="num">${s.skillpoints_in_skill ? `${s.skillpoints_in_skill.toLocaleString()} SP` : '—'}</span></div>`; }).join('')}</details>`; }).join('')}
    </div><p id="skills-none" class="state" hidden>No skills match. Clear the search or pick All.</p>
  </section>`;
  filterSkills();
}
function filterSkills() {
  const term = ($('#skill-search')?.value || '').trim().toLowerCase();
  let total = 0;
  document.querySelectorAll('#skills .skill-group').forEach(group => {
    let shown = 0;
    group.querySelectorAll('.skill').forEach(row => {
      const ok = row.textContent.toLowerCase().includes(term) && (skillFilter === 'all' || (skillFilter === 'five' ? row.dataset.five === 'true' : skillFilter === 'queue' ? row.dataset.queue === 'true' : row.dataset.five !== 'true'));
      row.hidden = !ok; shown += ok;
    });
    group.hidden = !shown; total += shown;
    if (term || skillFilter !== 'all') group.open = shown > 0;
  });
  const none = document.getElementById('skills-none'); if (none) none.hidden = total > 0; // rendered with the sheet
  // The first visible row takes the roving tab stop.
  document.querySelectorAll('#skills .skill').forEach(r => r.tabIndex = -1);
  const first = document.querySelector('#skills .skill-group:not([hidden]) .skill:not([hidden])'); if (first) first.tabIndex = 0;
}
function skillDrawer(id) {
  const p = shownPilot(), s = summary(p).skills?.skills?.find(x => x.skill_id === id);
  if (!s) return;
  const q = (p.queue || []).filter(x => x.skill_id === id && (!x.finish_date || Date.parse(x.finish_date) > Date.now()));
  const mate = S.pilots.find(x => x !== p), ms = mate && summary(mate).skills?.skills?.find(x => x.skill_id === id);
  openDrawer({title:name(id), body:`<div class="skill-hero">${pips(s)}<span class="num">${ROMAN[s.trained_skill_level] || '0'}</span></div>
    <dl class="kv"><div><dt>Group</dt><dd>${esc(typeGroup.get(id) || 'Other skills')}</dd></div><div><dt>Trained</dt><dd>Level ${s.trained_skill_level}${s.active_skill_level < s.trained_skill_level ? ` · active ${s.active_skill_level} (alpha clone limit)` : ''}</dd></div><div><dt>Skill points</dt><dd class="num">${(s.skillpoints_in_skill || 0).toLocaleString()}</dd></div>
    ${q.map(x => `<div><dt>In queue</dt><dd>Level ${x.finished_level}${x.finish_date ? `, ${esc(short(x.finish_date))}` : ', paused'}</dd></div>`).join('')}
    ${mate && summary(mate).skills?.skills ? `<div data-pilot="${esc(mate.name.toLowerCase())}"><dt>${esc(mate.name)}</dt><dd>${ms ? `Level ${ms.trained_skill_level}` : 'Not trained yet'}</dd></div>` : ''}</dl>`});
}

// ── Clones ──
const INFOMORPH_SYNCHRONIZING = 33399;
const ATTRS = ['intelligence', 'memory', 'perception', 'willpower', 'charisma'];
function nextJump(p, clones) {
  if (!clones?.last_clone_jump_date) return {ready:true, text:'Available now'};
  const ready = Date.parse(clones.last_clone_jump_date) + (24 - levelOf(p.skills, INFOMORPH_SYNCHRONIZING)) * 3600000;
  return ready <= Date.now() ? {ready:true, text:'Available now'} : {ready:false, text:short(ready), at:ready};
}
// Jumps from where the pilot is now to an NPC station's system; structures aren't on the public map.
function jumpsTo(p, locationId) {
  const g = mapGraph(), here = p.ops?.location?.value?.solar_system_id, st = g?.stations.get(locationId);
  if (!g || !here || !st) return null;
  return here === st.system ? 0 : route(here, st.system)?.jumps ?? null;
}
export function renderClones() {
  const p = personal('clones');
  if (!p) { $('#clones-content').innerHTML = '<div class="state"><p>No pilots configured in config.json.</p></div>'; return; }
  const i = S.pilots.indexOf(p), ops = p.ops || {}, c = ops.clones?.value, implants = ops.implants?.value, jump = nextJump(p, c);
  const home = c?.home_location ? place(c.home_location.location_id, c.home_location.location_type) : null;
  const jcs = c?.jump_clones || [];
  $('#clones-content').innerHTML = `
  ${p.private ? readout([['Home station', `<span class="readout__text">${esc(home || 'Unknown')}</span>`], ['Next clone jump', `<span class="readout__text ${jump.ready ? 'pos' : ''}">${esc(jump.text)}</span>`], ['Active implants', Array.isArray(implants) ? `<span class="num">${implants.length}</span>` : '—']]) : ''}
  <div class="card panel--primary clones" data-pilot="${esc(p.name.toLowerCase())}">
    <div class="panel__head"><h2>Jump clones</h2><p class="panel__sub">${c ? `Home: ${esc(home || 'Unknown')}` : ''}</p></div>
    ${field(p, 'clones', () => jcs.length ? `<div class="rows" role="table" aria-label="Jump clones" style="--cols:minmax(0,1.6fr) minmax(0,2fr) 90px">${rowsHead('clones', [['Clone'], ['Implants'], ['From here']])}${jcs.map((j, n) => { const jumps = jumpsTo(p, j.location_id); return `<div ${rowAttrs(n)}><span role="cell" class="rows__main"><b>${esc(j.name || place(j.location_id, j.location_type))}</b>${j.name ? `<small>${esc(place(j.location_id, j.location_type))}</small>` : ''}</span><span role="cell" class="cell--wrap">${j.implants?.length ? j.implants.map(id => `<span class="chip">${esc(name(id))}</span>`).join(' ') : '<span class="hint">No implants</span>'}</span><span role="cell" class="num">${jumps === null ? '—' : jumps ? plural(jumps, 'jump') : 'here'}</span></div>`; }).join('')}</div>` : '<p class="hint">No jump clones.</p>')}
  </div>
  <div class="clones-grid">
    <section class="card"><h2>Attributes</h2>${field(p, 'attributes', a => { const top = Math.max(...ATTRS.map(k => a[k] || 0), 1); return `<ul class="attrs">${ATTRS.map(k => `<li><span>${k[0].toUpperCase() + k.slice(1)}</span><span class="attrs__bar"><i style="width:${((a[k] || 0) / top * 100).toFixed(1)}%"></i></span><b class="num">${a[k]}</b></li>`).join('')}</ul><p class="hint">${a.bonus_remaps || 0} bonus remaps · ${!a.accrued_remap_cooldown_date || Date.parse(a.accrued_remap_cooldown_date) <= Date.now() ? 'yearly remap available' : `yearly remap ${esc(new Date(a.accrued_remap_cooldown_date).toLocaleDateString())}`}</p>`; })}</section>
    <section class="card"><h2>Active implants</h2>${field(p, 'implants', ids => ids.length ? `<ul class="plain">${ids.map(id => `<li>${esc(name(id))}</li>`).join('')}</ul>` : '<p class="hint">No implants plugged in.</p>')}</section>
  </div>
  ${p.private ? '' : `<div class="state"><p><b>Clones and attributes are private.</b> ${esc(p.name)} can connect to show them here.</p>${connectButtons(p, i)}</div>`}`;
}

export function wire() {
  for (const id of ['training', 'skills', 'clones']) document.getElementById(id).classList.add('vk');
  whenPilotChanges(renderTraining); whenPilotChanges(renderSkills); whenPilotChanges(renderClones);
  document.addEventListener('click', event => {
    const pick = event.target.closest('[data-show-pilot]');
    if (pick) { shownName = pick.dataset.showPilot; onPilot.forEach(render => render()); return; }
    const sort = event.target.closest('[data-sort]');
    if (sort) {
      const [table, key] = sort.dataset.sort.split(':'), st = sorts[table];
      if (!st) return;
      st.dir = st.key === key ? -st.dir : key === 'name' || key === 'system' ? 1 : -1; st.key = key;
      store.set(`eve.sort.${table}`, st); resorts[table]?.();
      document.querySelector(`[data-sort="${table}:${key}"]`)?.focus();
      return;
    }
    const chip = event.target.closest('[data-skill-filter]');
    if (chip) { skillFilter = chip.dataset.skillFilter; document.querySelectorAll('[data-skill-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === chip))); filterSkills(); return; }
    if (event.target.closest('a,button,summary,input')) return;
    const q = event.target.closest('#training [data-queue]'); if (q) queueDrawer(Number(q.dataset.queue));
    const s = event.target.closest('#skills [data-skill]'); if (s) skillDrawer(Number(s.dataset.skill));
  });
  // Enter on a focused row opens its details, like a click.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !event.target.matches?.('[data-row]')) return;
    event.preventDefault(); event.target.click();
  });
  $('#skill-search').addEventListener('input', filterSkills);
}
