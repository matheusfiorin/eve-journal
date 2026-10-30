import {BackendClient} from './backend.js';
import {emptyData, validateBackup, mergeBackups, remaining, escapeHTML as esc, localDate, filterEntries, trainingProgress, queueState} from './model.js';
import {JournalStore} from './storage.js';

const $ = selector => document.querySelector(selector);
const KEY = 'eve-flight-journal:v1';
const DRAFT = 'eve-flight-draft:v1';
const GROUPS = 'eve-skill-groups:v1';
const TABS = ['overview','training','skills','wallet','clones','notes'];
const OLD_TABS = {journal:'notes', goals:'notes', operations:'wallet'};
const ROMAN = ['0','I','II','III','IV','V'];
const INFOMORPH_SYNCHRONIZING = 33399;
const home = new URL('./', location.href).href;
let config = {pilots:[]};
let data = emptyData(), pilots = [], store, backend = null, universeStatus = null;
let generation = 0, editingEntry = null, editingGoal = null, draftTimer;
const names = new Map(), corporations = new Map(), typeGroup = new Map();

const isk = value => `${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ISK`;
const name = id => names.get(id) || `#${id}`;
const isStation = id => id >= 60000000 && id < 64000000;
const place = (id, type) => isStation(id) || type === 'station' ? name(id) : 'Player structure';
const when = date => new Date(date).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});

function notice(message) { $('#notice').textContent = message; $('#notice').hidden = false; }
function persist(next) {
  try { data = store.save(next); renderLocal(); return true; }
  catch (error) { notice(`${error.message} Your change was not saved.`); return false; }
}
async function json(url, options = {}) {
  let response;
  try { response = await fetch(url, {...options, signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error('Connection unavailable or timed out. Check your connection and try again.'); }
  if (!response.ok) {
    const error = new Error(response.status === 429 || response.status === 420 ? 'EVE API rate limit reached. Wait before refreshing again.' : `The service returned ${response.status}. Please try again later.`);
    error.status = response.status; throw error;
  }
  return response.json();
}
const esi = (path, options = {}) => json(`https://esi.evetech.net/latest/${path}`, {...options, headers:{Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {})}});

async function nameChunk(ids) {
  try { (await esi('universe/names/', {method:'POST', body:JSON.stringify(ids)})).forEach(row => names.set(row.id, row.name)); }
  catch (error) {
    // One unknown ID makes ESI reject the whole batch (404), so split to isolate it; other errors are real outages.
    if (error.status !== 404 || ids.length === 1) throw error;
    const mid = ids.length >> 1;
    await Promise.all([nameChunk(ids.slice(0, mid)), nameChunk(ids.slice(mid))].map(task => task.catch(() => {})));
  }
}
async function resolveNames(ids) {
  const missing = [...new Set(ids)].filter(id => Number.isSafeInteger(id) && id > 0 && id < 2147483647 && !names.has(id));
  for (let i = 0; i < missing.length; i += 500) await nameChunk(missing.slice(i, i + 500));
}
function setGroups(groups) {
  for (const group of groups) for (const type of group.types || []) typeGroup.set(type, group.name);
}
async function loadSkillGroups() {
  if (typeGroup.size) return;
  try {
    const cached = JSON.parse(localStorage.getItem(GROUPS) || 'null');
    if (cached?.at > Date.now() - 7 * 86400000 && Array.isArray(cached.groups)) return setGroups(cached.groups);
  } catch { /* A broken cache is refetched. */ }
  try {
    const category = await esi('universe/categories/16/');
    const groups = (await Promise.all(category.groups.map(id => esi(`universe/groups/${id}/`)))).filter(g => g.published !== false).map(g => ({name:g.name, types:g.types}));
    setGroups(groups);
    try { localStorage.setItem(GROUPS, JSON.stringify({at:Date.now(), groups})); } catch { /* Cache is optional. */ }
  } catch { /* Skills still render, ungrouped. */ }
}
function corporation(id) {
  if (!corporations.has(id)) corporations.set(id, esi(`corporations/${id}/`).catch(error => { corporations.delete(id); throw error; }));
  return corporations.get(id);
}
function referencedIds(p) {
  const o = p.ops || {}, v = key => o[key]?.value;
  return [
    ...(p.queue || []).map(q => q.skill_id), ...(p.skills?.skills || []).map(s => s.skill_id),
    v('ship')?.ship_type_id, v('location')?.solar_system_id, v('location')?.station_id,
    ...(v('jobs') || []).flatMap(j => [j.product_type_id, j.blueprint_type_id]),
    ...(v('transactions') || []).flatMap(t => [t.type_id, t.location_id]),
    ...(v('implants') || []), v('clones')?.home_location?.location_id,
    ...(v('clones')?.jump_clones || []).flatMap(c => [c.location_id, ...(c.implants || [])])
  ];
}

async function loadProfile(p) {
  try {
    p.profile = await esi(`characters/${p.id}/`);
    p.corp = await corporation(p.profile.corporation_id);
    try {
      const history = await esi(`characters/${p.id}/corporationhistory/`);
      p.career = await Promise.all(history.filter(item => !item.is_deleted).sort((a,b) => b.start_date.localeCompare(a.start_date)).slice(0,6).map(async item => ({...item, name:(await corporation(item.corporation_id)).name})));
      delete p.careerError;
    } catch (error) { p.careerError = error.message; }
  } catch (error) { p.error = `Public profile: ${error.message}`; }
}
async function loadPrivate(p, force, shared) {
  p.shared = shared.find(row => row.characterId === p.id) || null;
  if (backend?.has(p.id)) {
    try {
      const record = await backend.privatePilot(p.id, force);
      // A disconnect during the request must not restore private data.
      if (!backend.has(p.id)) return;
      Object.assign(p, {skills:record.skills, queue:record.queue, ops:record.operations || {}, synced:record.fetchedAt, private:true});
      if (record.lastError) p.error = record.lastError;
      return;
    } catch (error) { p.error = error.message; }
  }
  Object.assign(p, {skills:p.shared?.skills, queue:p.shared?.queue, ops:undefined, synced:p.shared?.fetchedAt, private:false});
  if (p.shared?.stale && !p.error) p.error = 'The shared training snapshot could not be refreshed. This pilot may need to reconnect.';
}
async function loadPilots(force = false) {
  const request = ++generation;
  const statusTask = esi('status/').then(value => { universeStatus = {...value, fetched:Date.now()}; }).catch(() => { if (universeStatus) universeStatus.stale = true; });
  const sharedTask = backend ? backend.publicPilots().catch(error => { notice(`Shared training snapshots: ${error.message}`); return []; }) : Promise.resolve([]);
  const next = config.pilots.map(n => ({...pilots.find(p => p.name.toLowerCase() === n.toLowerCase()), name:n, error:null, refreshing:true}));
  pilots = next;
  $('#refresh').disabled = true;
  $('#sync-status').textContent = 'Refreshing pilots…';
  renderAll();
  try {
    const result = next.length ? await esi('universe/ids/?language=en', {method:'POST', body:JSON.stringify(next.map(p => p.name))}) : {};
    const shared = await sharedTask;
    await Promise.all(next.map(async p => {
      const match = (result.characters || []).find(c => c.name.toLowerCase() === p.name.toLowerCase());
      if (!match) { p.error = 'Character not found. Check the exact name in config.json.'; return; }
      p.id = match.id; p.name = match.name;
      await Promise.all([loadProfile(p), loadPrivate(p, force, shared)]);
      p.queue?.sort((a,b) => a.queue_position - b.queue_position);
    }));
    if (request !== generation) return;
    try { await resolveNames(next.flatMap(referencedIds)); } catch { notice('Some EVE names could not be loaded. IDs are shown instead.'); }
    if (next.some(p => p.skills?.skills)) await loadSkillGroups();
    $('#sync-status').textContent = `Last refresh ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    if (request !== generation) return;
    next.forEach(p => p.error = error.message);
    $('#sync-status').textContent = 'Refresh failed. Previously loaded data is kept; press Refresh to retry.';
  } finally {
    await statusTask;
    if (request === generation) { next.forEach(p => p.refreshing = false); $('#refresh').disabled = false; renderAll(); }
  }
}

function connectButtons(p, index) {
  if (!backend) return '<p class="hint">Private data needs the backend, which is not configured here.</p>';
  return `<div class="actions"><button data-connect="${index}" class="${p.private ? 'secondary' : ''} small" ${!p.id || p.refreshing ? 'disabled' : ''}>${p.private ? 'Reconnect' : 'Connect with EVE'}</button>${backend.has(p.id) ? `<button data-disconnect="${p.id}" class="secondary small">Disconnect</button>` : ''}</div>`;
}
function head(p, index, extra = '') {
  return `<div class="pilot-head">${p.id ? `<img class="portrait" src="https://images.evetech.net/characters/${p.id}/portrait?size=128" alt="Portrait of ${esc(p.name)}" width="56" height="56">` : '<span class="portrait" aria-hidden="true">✦</span>'}<div><h2>${esc(p.name)}</h2><p class="hint">${p.corp ? `${esc(p.corp.name)} [${esc(p.corp.ticker)}]` : p.refreshing ? 'Loading…' : 'Corporation unavailable'}</p></div><span class="pill ${p.private ? 'ok' : ''}">${p.private ? 'Connected' : p.shared ? 'Shared' : 'Public'}</span></div>${extra}${p.error ? `<p class="error">${esc(p.error)}</p>` : ''}`;
}
function trainingAlert(p) {
  const state = queueState(p.queue);
  if (!state) return `<p class="alert muted">Training is private until ${esc(p.name)} connects.</p>`;
  if (state.kind === 'empty') return '<p class="alert danger">⚠ Not training. The skill queue is empty.</p>';
  if (state.kind === 'paused') return '<p class="alert warn">⏸ Training is paused. Start the queue in game.</p>';
  const active = `<b>${esc(name(state.active.skill_id))} ${ROMAN[state.active.finished_level]}</b>`;
  if (state.kind === 'ending') return `<p class="alert warn">⚠ Queue runs out in ${esc(remaining(state.end).replace(' remaining',''))}. Add skills soon. Training ${active}.</p>`;
  return `<p class="alert ok">Training ${active} · queue ends in ${esc(remaining(state.end).replace(' remaining',''))}</p>`;
}
function fact(label, value) { return `<div><dt>${label}</dt><dd>${value}</dd></div>`; }
function pilotsOrEmpty(render) {
  return pilots.length ? pilots.map(render).join('') : '<div class="empty">No pilots configured in config.json.</div>';
}

function renderStatus() {
  $('#server-status').innerHTML = universeStatus ? `<span class="dot ${universeStatus.stale ? '' : 'on'}"></span><span><b>${Number(universeStatus.players).toLocaleString()}</b> pilots online${universeStatus.vip ? ' · VIP only' : ''}${universeStatus.stale ? ' · last known' : ''}</span>` : '<span class="hint">Tranquility status unavailable</span>';
}
function renderOverview() {
  $('#pilots').innerHTML = pilotsOrEmpty((p, i) => {
    const birthday = p.profile?.birthday, o = p.ops || {};
    const age = birthday ? Math.floor((Date.now() - Date.parse(birthday)) / 86400000) : null;
    const loc = o.location?.value, ship = o.ship?.value;
    return `<article class="card pilot-card">${head(p, i, trainingAlert(p))}<dl class="facts">
      ${fact('Skill points', p.skills ? Number(p.skills.total_sp).toLocaleString() : '—')}
      ${fact('Wallet', o.wallet?.value !== undefined ? esc(isk(o.wallet.value)) : '—')}
      ${fact('Location', loc ? `${esc(name(loc.solar_system_id))}<small>${loc.station_id ? esc(name(loc.station_id)) : loc.structure_id ? 'Docked in a structure' : 'In space'}</small>` : '—')}
      ${fact('Ship', ship ? `${esc(name(ship.ship_type_id))}<small>${esc(ship.ship_name || '')}</small>` : '—')}
      ${fact('Security status', Number.isFinite(p.profile?.security_status) ? p.profile.security_status.toFixed(2) : '—')}
      ${fact('Capsuleer for', age === null ? '—' : `${age.toLocaleString()} days`)}
    </dl>
    <details><summary>Corporation history</summary>${p.corp ? `<p class="hint">${Number(p.corp.member_count).toLocaleString()} members · ${(p.corp.tax_rate * 100).toFixed(1)}% tax</p>` : ''}${p.careerError ? `<p class="error">History unavailable: ${esc(p.careerError)}</p>` : ''}<ol class="career">${(p.career || []).map(item => `<li><b>${esc(item.name)}</b><span>Joined ${esc(new Date(item.start_date).toLocaleDateString())}</span></li>`).join('')}</ol></details>
    <p class="hint">${p.synced ? `EVE data from ${esc(when(p.synced))}` : backend ? 'Connect to share training and see private data.' : ''}</p>${connectButtons(p, i)}</article>`;
  });
}
function renderTraining() {
  const now = Date.now();
  $('#training-content').innerHTML = pilotsOrEmpty((p, i) => {
    const state = queueState(p.queue, now);
    if (!state) return `<article class="card">${head(p, i)}<div class="empty">Connect ${esc(p.name)} to see the training queue.</div>${connectButtons(p, i)}</article>`;
    const timed = state.pending.filter(q => q.finish_date);
    const start = Math.min(now, ...timed.map(q => Date.parse(q.start_date)));
    const span = (state.end || now) - start || 1;
    return `<article class="card">${head(p, i, trainingAlert(p))}
      ${state.active ? `<div class="active"><span class="label">Training now</span><h3>${esc(name(state.active.skill_id))} ${ROMAN[state.active.finished_level]}</h3><progress max="100" value="${trainingProgress(state.active, now)}" aria-label="Current skill progress"></progress><p class="hint">${esc(remaining(state.active.finish_date, now))} · ends ${esc(when(state.active.finish_date))}</p></div>` : ''}
      <p class="hint">${state.pending.length} skills queued${state.end ? ` · queue ends ${esc(when(state.end))}` : ''}</p>
      <ol class="timeline">${state.pending.map(q => {
        const a = Date.parse(q.start_date), b = Date.parse(q.finish_date);
        const bar = Number.isFinite(a) && Number.isFinite(b) ? `<span class="bar"><i style="left:${Math.max(0, (Math.max(a, start) - start) / span * 100).toFixed(2)}%;width:${Math.max(0.5, (b - Math.max(a, start)) / span * 100).toFixed(2)}%"></i></span>` : '<span class="bar"></span>';
        return `<li><span>${esc(name(q.skill_id))} <b>${ROMAN[q.finished_level]}</b></span>${bar}<small>${q.finish_date ? esc(remaining(q.finish_date, now)) : 'Paused / not scheduled'}</small></li>`;
      }).join('') || '<li class="hint">Your training queue is empty. Add a skill in EVE Online.</li>'}</ol>${p.private ? '' : connectButtons(p, i)}</article>`;
  });
}
function renderSkills() {
  $('#skills-content').innerHTML = pilotsOrEmpty((p, i) => {
    const list = p.skills?.skills;
    if (!list) return `<article class="card">${head(p, i)}<div class="empty">${p.skills ? `${Number(p.skills.total_sp).toLocaleString()} skill points. ` : ''}Connect ${esc(p.name)} to see the full skill sheet.</div>${connectButtons(p, i)}</article>`;
    const groups = new Map();
    for (const s of list) {
      const g = typeGroup.get(s.skill_id) || 'Other skills';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    const maxed = list.filter(s => s.trained_skill_level === 5).length;
    return `<article class="card">${head(p, i)}<dl class="facts">${fact('Total SP', Number(p.skills.total_sp).toLocaleString())}${fact('Unallocated SP', Number(p.skills.unallocated_sp || 0).toLocaleString())}${fact('Skills trained', list.length)}${fact('At level V', maxed)}</dl>
      <label>Find a skill<input type="search" data-skill-search placeholder="Search ${esc(p.name)}’s skills"></label>
      <div class="skill-groups">${[...groups].sort(([a],[b]) => a.localeCompare(b)).map(([group, skills]) => `<details class="skill-group"><summary><b>${esc(group)}</b><span class="hint">${skills.length} ${skills.length === 1 ? "skill" : "skills"} · ${skills.reduce((t, s) => t + (s.skillpoints_in_skill || 0), 0).toLocaleString()} SP</span></summary>${skills.sort((a,b) => name(a.skill_id).localeCompare(name(b.skill_id))).map(s => `<div class="skill"><span>${esc(name(s.skill_id))}</span><span class="pips" aria-label="Level ${s.trained_skill_level}">${[1,2,3,4,5].map(n => `<i class="${n <= s.active_skill_level ? 'on' : n <= s.trained_skill_level ? 'idle' : ''}"></i>`).join('')}</span><small>${s.active_skill_level < s.trained_skill_level ? `Active ${s.active_skill_level} of ${s.trained_skill_level}` : `Level ${s.trained_skill_level}`}${s.skillpoints_in_skill ? ` · ${s.skillpoints_in_skill.toLocaleString()} SP` : ''}</small></div>`).join('')}</details>`).join('')}</div></article>`;
  });
}
function field(p, key, render) {
  if (!p.private) return '<p class="hint">Connect this pilot to load this data.</p>';
  const f = p.ops?.[key];
  if (!f) return '<p class="hint">Not synced yet. Press Refresh.</p>';
  if (!f.permission) return '<p class="hint">Permission not granted. Reconnect this pilot to allow it.</p>';
  return `${f.value !== undefined ? render(f.value) : ''}${f.error ? `<p class="error">${esc(f.error)}${f.value !== undefined ? ' Showing the previous data.' : ''}</p>` : ''}`;
}
function renderWallet() {
  $('#wallet-content').innerHTML = pilotsOrEmpty((p, i) => `<article class="card">${head(p, i)}
    <h3>Balance</h3>${field(p, 'wallet', value => `<p class="big">${esc(isk(value))}</p>`)}
    <h3>Recent journal</h3>${field(p, 'journal', rows => rows.length ? `<table><tbody>${rows.map(r => `<tr><td>${esc(new Date(r.date).toLocaleDateString())}</td><td>${esc(String(r.ref_type).replaceAll('_', ' '))}${r.description ? `<small>${esc(r.description)}</small>` : ''}</td><td class="num ${r.amount < 0 ? 'neg' : 'pos'}">${esc(isk(r.amount || 0))}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No wallet activity.</p>')}
    <h3>Market transactions</h3>${field(p, 'transactions', rows => rows.length ? `<table><tbody>${rows.map(t => `<tr><td>${esc(new Date(t.date).toLocaleDateString())}</td><td><span class="tag ${t.is_buy ? 'neg' : 'pos'}">${t.is_buy ? 'Buy' : 'Sell'}</span> ${esc(name(t.type_id))} ×${Number(t.quantity).toLocaleString()}<small>${esc(place(t.location_id))}</small></td><td class="num ${t.is_buy ? 'neg' : 'pos'}">${esc(isk((t.is_buy ? -1 : 1) * t.quantity * t.unit_price))}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No recent market transactions.</p>')}
    <h3>Industry jobs</h3>${field(p, 'jobs', jobs => jobs.length ? `<table><tbody>${jobs.slice(0, 20).map(j => `<tr><td>${esc(name(j.product_type_id || j.blueprint_type_id))}<small>${Number(j.runs)} runs</small></td><td>${esc(j.status)}</td><td class="num">${j.end_date ? esc(remaining(j.end_date)) : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No current industry jobs.</p>')}
    ${p.private ? '' : connectButtons(p, i)}</article>`);
}
function cloneJump(p, clones) {
  if (!clones.last_clone_jump_date) return 'Clone jump available';
  const level = p.skills?.skills?.find(s => s.skill_id === INFOMORPH_SYNCHRONIZING)?.active_skill_level || 0;
  const ready = Date.parse(clones.last_clone_jump_date) + (24 - level) * 3600000;
  return ready <= Date.now() ? 'Clone jump available' : `Next clone jump ${esc(remaining(ready).replace('remaining', 'from now'))}`;
}
function renderClones() {
  $('#clones-content').innerHTML = pilotsOrEmpty((p, i) => `<article class="card">${head(p, i)}
    <h3>Attributes</h3>${field(p, 'attributes', a => `<dl class="attributes">${['intelligence','memory','perception','willpower','charisma'].map(k => fact(k[0].toUpperCase() + k.slice(1), a[k])).join('')}</dl><p class="hint">${a.bonus_remaps || 0} bonus remaps · ${!a.accrued_remap_cooldown_date || Date.parse(a.accrued_remap_cooldown_date) <= Date.now() ? 'yearly remap available' : `yearly remap ${esc(new Date(a.accrued_remap_cooldown_date).toLocaleDateString())}`}</p>`)}
    <h3>Active implants</h3>${field(p, 'implants', ids => ids.length ? `<ul class="plain">${ids.map(id => `<li>${esc(name(id))}</li>`).join('')}</ul>` : '<p class="hint">No implants plugged in.</p>')}
    <h3>Clones</h3>${field(p, 'clones', c => `<p>Home: <b>${esc(c.home_location ? place(c.home_location.location_id, c.home_location.location_type) : 'Unknown')}</b></p><p class="hint">${cloneJump(p, c)}</p>${(c.jump_clones || []).length ? `<ul class="plain">${c.jump_clones.map(j => `<li><b>${esc(j.name || place(j.location_id, j.location_type))}</b>${j.name ? `<small>${esc(place(j.location_id, j.location_type))}</small>` : ''}<small>${j.implants?.length ? j.implants.map(id => esc(name(id))).join(', ') : 'No implants'}</small></li>`).join('')}</ul>` : '<p class="hint">No jump clones.</p>'}`)}
    ${p.private ? '' : connectButtons(p, i)}</article>`);
}
function renderAll() { renderStatus(); renderOverview(); renderTraining(); renderSkills(); renderWallet(); renderClones(); pilotOptions(); }

function pilotOptions() {
  const pilotNames = pilots.map(p => p.name);
  document.querySelectorAll('.pilot-select').forEach(select => {
    const prior = select.value;
    const options = [...new Set(['Both pilots', ...pilotNames, ...data.entries.map(e => e.pilot), ...data.goals.map(g => g.pilot), ...(prior ? [prior] : [])])];
    select.innerHTML = options.map(n => `<option>${esc(n)}</option>`).join('');
    if (prior) select.value = prior;
  });
  const filter = $('#journal-pilot'), prior = filter.value;
  const authors = [...new Set([...pilotNames, ...data.entries.map(e => e.pilot)])];
  filter.innerHTML = '<option value="">All pilots</option>' + authors.map(n => `<option>${esc(n)}</option>`).join('');
  filter.value = authors.includes(prior) ? prior : '';
}
function renderLocal() {
  const done = data.goals.filter(g => g.done).length;
  const filter = $('#goal-filter').value;
  const goals = data.goals.filter(g => filter === 'all' || (filter === 'done' ? g.done : !g.done));
  $('#goal-count').textContent = `${done} of ${data.goals.length} goals complete`;
  $('#goal-list').innerHTML = goals.length ? goals.map(g => `<article class="goal ${g.done ? 'done' : ''}"><div><label><input type="checkbox" data-goal="${esc(g.id)}" ${g.done ? 'checked' : ''}>${esc(g.title)}</label><small>${esc(g.pilot)} · ${esc(g.category || 'Other')}${g.due ? ` · <span class="${!g.done && g.due < localDate() ? 'error' : ''}">Target ${esc(g.due)}</span>` : ''}</small></div><div class="actions"><button data-edit-goal="${esc(g.id)}" class="secondary small">Edit</button><button data-delete-goal="${esc(g.id)}" class="secondary small" aria-label="Delete ${esc(g.title)}">Delete</button></div></article>`).join('') : `<div class="empty">${data.goals.length ? 'No goals in this view.' : 'A new ship? A new system? Give your next adventure a goal.'}</div>`;
  pilotOptions();
  renderEntries();
}
function renderEntries() {
  const entries = filterEntries(data.entries, {query:$('#journal-search').value, pilot:$('#journal-pilot').value, category:$('#journal-category').value});
  $('#entry-count').textContent = `${entries.length} of ${data.entries.length} entries · private to this browser`;
  $('#entries').innerHTML = entries.length ? entries.map(e => `<article class="entry"><div class="card-head"><div><small>${esc(e.date)} · ${esc(e.pilot)} · ${esc(e.category || 'Adventure')}</small><h3>${esc(e.title)}</h3></div><div class="actions"><button data-edit-entry="${esc(e.id)}" class="secondary small">Edit</button><button data-delete-entry="${esc(e.id)}" class="secondary small" aria-label="Delete ${esc(e.title)}">Delete</button></div></div><p>${esc(e.body)}</p></article>`).join('') : `<div class="empty">${data.entries.length ? 'No entries match. Try a different search or filter.' : 'Every capsuleer starts somewhere. Write your first chapter.'}</div>`;
}
function selectTab(id) {
  id = OLD_TABS[id] || id;
  if (!TABS.includes(id)) return;
  document.querySelectorAll('nav [data-tab]').forEach(b => b.dataset.tab === id ? b.setAttribute('aria-current','page') : b.removeAttribute('aria-current'));
  document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== id);
  history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
}
function clearPrivate(p) {
  Object.assign(p, {skills:p.shared?.skills, queue:p.shared?.queue, synced:p.shared?.fetchedAt, ops:undefined, private:false});
}
function saveDraft() {
  clearTimeout(draftTimer);
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({...Object.fromEntries(new FormData($('#journal-form'))), editingEntry}));
    $('#draft-status').textContent = `Draft saved in this tab at ${new Date().toLocaleTimeString()}`;
  } catch { $('#draft-status').textContent = 'Draft could not be saved. Keep this tab open until you save the entry.'; }
}
function resetEntry(preserveDraft = false) {
  editingEntry = null; $('#journal-form').reset(); $('#journal-form').elements.date.value = localDate();
  $('#entry-submit').textContent = 'Save entry locally'; $('#cancel-entry-edit').hidden = true;
  try { if (!preserveDraft) sessionStorage.removeItem(DRAFT); } catch { /* Journal remains usable when draft storage is unavailable. */ }
  $('#draft-status').textContent = 'New private draft · saved in this tab as you type';
}
function editEntry(id) {
  const item = data.entries.find(e => e.id === id);
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
  selectTab('notes'); f.scrollIntoView({behavior:'smooth', block:'start'}); f.elements.title.focus(); saveDraft();
}
function resetGoal() {
  editingGoal = null; $('#goal-form').reset(); $('#goal-submit').textContent = 'Add goal'; $('#cancel-goal-edit').hidden = true;
}
function download(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], {type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function expireSessions() {
  if (!backend) return;
  const expired = backend.expire();
  if (!expired.length) return;
  for (const id of expired) { const p = pilots.find(p => p.id === id); if (p) clearPrivate(p); }
  renderAll(); notice('A pilot session expired. Connect again to see private data.');
}

$('#refresh').onclick = () => loadPilots(true);
$('#goal-form').onsubmit = event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.target));
  if (!fields.title.trim()) return;
  const goal = {...fields, title:fields.title.trim(), id:editingGoal || crypto.randomUUID(), done:data.goals.find(g => g.id === editingGoal)?.done || false};
  if (persist({...data, goals:editingGoal ? data.goals.map(g => g.id === editingGoal ? goal : g) : [...data.goals, goal]})) { resetGoal(); notice('Goal saved in this browser.'); }
};
$('#journal-form').onsubmit = event => {
  event.preventDefault(); clearTimeout(draftTimer);
  const fields = Object.fromEntries(new FormData(event.target));
  if (!fields.title.trim() || !fields.body.trim()) return;
  const entry = {...fields, title:fields.title.trim(), body:fields.body.trim(), id:editingEntry || crypto.randomUUID()};
  if (editingEntry && !data.entries.some(e => e.id === editingEntry)) { notice('This entry no longer exists. Cancel editing to save it as a new entry.'); return; }
  if (persist({...data, entries:editingEntry ? data.entries.map(e => e.id === editingEntry ? entry : e) : [...data.entries, entry]})) { resetEntry(); notice('Journal entry saved privately in this browser.'); }
};
$('#journal-form').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); });
$('#journal-form').addEventListener('change', saveDraft);
window.addEventListener('pagehide', () => { if ($('#journal-form').elements.title.value || $('#journal-form').elements.body.value) saveDraft(); });
$('#cancel-entry-edit').onclick = () => { if (confirm('Discard the current edit? The saved entry will stay unchanged.')) { clearTimeout(draftTimer); resetEntry(); } };
$('#discard-draft').onclick = () => { if (confirm('Discard this draft? Saved journal entries will stay unchanged.')) { clearTimeout(draftTimer); resetEntry(); } };
$('#cancel-goal-edit').onclick = resetGoal;
$('#goal-filter').onchange = renderLocal;
$('#journal-search').oninput = renderEntries;
$('#journal-pilot').onchange = renderEntries;
$('#journal-category').onchange = renderEntries;
document.addEventListener('change', event => {
  if (!event.target.matches('[data-goal]')) return;
  if (!persist({...data, goals:data.goals.map(g => g.id === event.target.dataset.goal ? {...g, done:event.target.checked} : g)})) event.target.checked = !event.target.checked;
});
document.addEventListener('input', event => {
  if (!event.target.matches('[data-skill-search]')) return;
  const term = event.target.value.trim().toLowerCase();
  event.target.closest('.card').querySelectorAll('.skill-group').forEach(group => {
    let shown = 0;
    group.querySelectorAll('.skill').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(term); shown += !row.hidden; });
    group.hidden = !shown; group.open = Boolean(term) && shown > 0;
  });
});
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.tab) selectTab(b.dataset.tab);
    if (b.dataset.connect !== undefined) {
      const p = pilots[Number(b.dataset.connect)];
      if (!backend || !p?.id) throw new Error('Wait for the pilot lookup before connecting.');
      location.assign(backend.authURL(p.id));
    }
    if (b.dataset.disconnect) {
      const id = Number(b.dataset.disconnect);
      if (!confirm('Disconnect this pilot, remove the stored EVE authorization, and stop sharing their training?')) return;
      await backend.disconnect(id);
      const p = pilots.find(p => p.id === id); if (p) { p.shared = null; clearPrivate(p); }
      renderAll();
    }
    if (b.dataset.editEntry) editEntry(b.dataset.editEntry);
    if (b.dataset.editGoal) {
      const g = data.goals.find(g => g.id === b.dataset.editGoal); if (!g) return;
      editingGoal = g.id;
      const f = $('#goal-form');
      if (g.category && ![...f.elements.category.options].some(o => o.value === g.category)) f.elements.category.add(new Option(g.category, g.category));
      for (const key of ['title','pilot','due','category']) f.elements[key].value = g[key] || (key === 'category' ? 'Other' : '');
      $('#goal-submit').textContent = 'Save changes'; $('#cancel-goal-edit').hidden = false; f.scrollIntoView({behavior:'smooth'}); f.elements.title.focus();
    }
    if (b.dataset.deleteGoal && confirm('Delete this local goal?')) {
      if (persist({...data, goals:data.goals.filter(g => g.id !== b.dataset.deleteGoal)}) && editingGoal === b.dataset.deleteGoal) resetGoal();
    }
    if (b.dataset.deleteEntry && confirm('Delete this private entry? Export a backup first if you want to keep it.')) {
      if (persist({...data, entries:data.entries.filter(e => e.id !== b.dataset.deleteEntry)}) && editingEntry === b.dataset.deleteEntry) resetEntry();
    }
  } catch (error) { notice(error.message); }
});
$('#export').onclick = () => {
  if (store.locked) { notice('Export is blocked because the journal could not be read. Use Download raw recovery file.'); return; }
  download(JSON.stringify(data, null, 2), `eve-journal-${localDate()}.json`);
  $('#backup-status').textContent = `Backup requested ${new Date().toLocaleString()}. It contains private notes.`;
};
$('#recover').onclick = () => { try { download(localStorage.getItem(KEY) || '', `eve-journal-recovery-${localDate()}.json`); } catch { notice('Browser storage is inaccessible. Recovery requires access to this browser’s site data.'); } };
$('#import').onchange = async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 5000000) throw new Error('Backup must be under 5 MB.');
    const incoming = validateBackup(JSON.parse(await file.text()));
    if (confirm(`Merge ${incoming.entries.length} entries and ${incoming.goals.length} goals? Matching IDs will be replaced.`)) {
      if (persist(mergeBackups(data, incoming))) notice('Backup merged. These records stay private in this browser.');
    }
  } catch (error) { notice(`Import failed: ${error.message}`); }
  finally { event.target.value = ''; }
};
window.addEventListener('storage', event => {
  if (event.key === KEY || event.key === null) notice('Another tab changed this journal. Reload before saving. Your current draft is preserved in this tab.');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) expireSessions(); });
setInterval(expireSessions, 30000);

async function init() {
  try { store = new JournalStore(localStorage, KEY); data = store.load(); }
  catch (error) {
    store ||= {locked:true, save() { throw new Error('Browser storage is unavailable.'); }};
    notice(error.message);
    document.querySelectorAll('#goal-form button,#journal-form button,#import').forEach(b => b.disabled = true);
    $('#recover').hidden = false;
  }
  try {
    config = await json('./config.json');
    if (!Array.isArray(config.pilots) || config.pilots.length > 2 || config.pilots.some(p => typeof p !== 'string' || !p.trim())) throw new Error('config.json has an invalid pilot list.');
  } catch (error) { config = {pilots:['Fiofka','Decxus']}; notice(`Using default pilots. ${error.message}`); }
  if (config.backendUrl) {
    try {
      backend = new BackendClient(config.backendUrl);
      if (backend.acceptRedirect(location.hash)) { history.replaceState(null, '', home); notice('Pilot connected. Training is shared and private data is now available.'); }
    } catch (error) { notice(error.message); }
  }
  renderLocal();
  // Populate selects before restoring an existing author in a draft.
  pilots = config.pilots.map(n => ({name:n})); pilotOptions(); resetEntry(true);
  selectTab(location.hash.slice(1) || 'overview');
  restoreDraft();
  await loadPilots();
}
// Read the draft before initialization resets the blank editor.
let recoveredDraft;
try { recoveredDraft = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); } catch { /* Ignore malformed drafts; never overwrite journal records. */ }
function restoreDraft() {
  if (!(recoveredDraft && typeof recoveredDraft.title === 'string' && typeof recoveredDraft.body === 'string' && recoveredDraft.title.length <= 160 && recoveredDraft.body.length <= 20000)) return;
  const f = $('#journal-form');
  for (const key of ['title','body','date','category','pilot']) if (typeof recoveredDraft[key] === 'string') {
    if (key === 'pilot' && ![...f.elements.pilot.options].some(o => o.value === recoveredDraft.pilot)) f.elements.pilot.add(new Option(recoveredDraft.pilot, recoveredDraft.pilot));
    f.elements[key].value = recoveredDraft[key];
  }
  editingEntry = data.entries.some(e => e.id === recoveredDraft.editingEntry) ? recoveredDraft.editingEntry : null;
  $('#entry-submit').textContent = editingEntry ? 'Save changes' : 'Save entry locally'; $('#cancel-entry-edit').hidden = !editingEntry;
  $('#draft-status').textContent = 'Recovered your private draft from this tab.'; saveDraft();
}
await init();
