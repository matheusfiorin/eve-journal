import {emptyData, validateBackup, mergeBackups, remaining, escapeHTML as esc, localDate, filterEntries, trainingProgress} from './model.js';
import {JournalStore} from './storage.js';
import {REQUESTED_SCOPES, OPERATIONS_SCOPES, base64url, challenge, validateState, validateToken} from './auth.js';

const $ = selector => document.querySelector(selector);
const KEY = 'eve-flight-journal:v1';
const SETTINGS = 'eve-flight-settings:v1';
const DRAFT = 'eve-flight-draft:v1';
const callback = new URL('./', location.href).href;
let config = {pilots:[], eveClientId:''};
let data = emptyData(), pilots = [], sessions = new Map(), store;
let generation = 0, editingEntry = null, editingGoal = null, draftTimer;
const types = new Map();
const corporationNames = new Map();
let universeStatus = null;

function notice(message) {
  $('#notice').textContent = message;
  $('#notice').hidden = false;
}
function persist(next) {
  try {
    data = store.save(next);
    renderLocal();
    return true;
  } catch (error) {
    notice(`${error.message} Your change was not saved.`);
    return false;
  }
}
async function json(url, options = {}) {
  let response;
  try { response = await fetch(url, {...options, signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error('Connection unavailable or timed out. Check your connection and try again.'); }
  if (!response.ok) {
    if (response.status === 429 || response.status === 420) throw new Error('EVE API rate limit reached. Wait before refreshing again.');
    if (response.status === 401 || response.status === 403) throw new Error('EVE access expired or was declined. Reconnect the pilot.');
    throw new Error(`The service returned ${response.status}. Please try again later.`);
  }
  return response.json();
}
const esi = (path, token, options = {}) => json(`https://esi.evetech.net/latest/${path}`, {
  ...options, headers:{Accept:'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}), ...options.headers}
});
async function resolveNames(ids) {
  const missing = [...new Set(ids)].filter(id => !types.has(id));
  for (let i = 0; i < missing.length; i += 500) {
    const rows = await esi('universe/names/', null, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(missing.slice(i, i + 500))
    });
    rows.forEach(row => types.set(row.id, row.name));
  }
}
async function corporationName(id) {
  if (!corporationNames.has(id)) corporationNames.set(id, esi(`corporations/${id}/`));
  try { return (await corporationNames.get(id)).name; }
  catch (error) { corporationNames.delete(id); throw error; }
}
function saveSessions() {
  sessionStorage.setItem('eve-sessions', JSON.stringify([...sessions]));
}
function isConnected(id) { return sessions.get(id)?.expires > Date.now(); }
function pilotOptions() {
  const names = pilots.map(p => p.name);
  document.querySelectorAll('.pilot-select').forEach(select => {
    const prior = select.value;
    const options = [...new Set(['Both pilots', ...names, ...data.entries.map(e => e.pilot), ...data.goals.map(g => g.pilot), ...(prior ? [prior] : [])])];
    select.innerHTML = options.map(name => `<option>${esc(name)}</option>`).join('');
    if (prior) select.value = prior;
  });
  const filter = $('#journal-pilot'), prior = filter.value;
  const authors = [...new Set([...names, ...data.entries.map(e => e.pilot)])];
  filter.innerHTML = '<option value="">All pilots</option>' + authors.map(n => `<option>${esc(n)}</option>`).join('');
  filter.value = authors.includes(prior) ? prior : '';
}
async function loadPilots() {
  const request = ++generation;
  const statusTask = esi('status/').then(value => { if(request===generation) universeStatus={...value,fetched:new Date().toISOString()}; }).catch(() => { if(request===generation && universeStatus) universeStatus.stale=true; });
  const previous = pilots;
  const next = config.pilots.map(name => ({...previous.find(p => p.name.toLowerCase() === name.toLowerCase()), name, error:null, refreshing:true}));
  pilots = next;
  $('#refresh').disabled = true;
  $('#sync-status').textContent = 'Refreshing public profiles and connected training data…';
  renderPilots(); pilotOptions();
  try {
    if (next.length) {
      const result = await esi('universe/ids/?language=en', null, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(next.map(p => p.name))
      });
      await Promise.all(next.map(async p => {
        const match = (result.characters || []).find(c => c.name.toLowerCase() === p.name.toLowerCase());
        if (!match) { p.error = 'Character not found. Check the exact name in configuration.'; return; }
        p.id = match.id; p.name = match.name;
        try {
          p.profile = await esi(`characters/${p.id}/`);
          p.profileSynced = new Date().toISOString();
          p.corporation = await corporationName(p.profile.corporation_id);
          p.corporationInfo = await corporationNames.get(p.profile.corporation_id);
          try {
            const history = await esi(`characters/${p.id}/corporationhistory/`);
            p.career = await Promise.all(history.filter(item => !item.is_deleted).sort((a,b)=>b.start_date.localeCompare(a.start_date)).slice(0,6).map(async item => ({...item,name:await corporationName(item.corporation_id)})));
            delete p.careerError;
          } catch(error) { p.careerError=error.message; }
        } catch (error) { p.error = `Public profile: ${error.message}`; }
        if (!isConnected(p.id)) { delete p.skills; delete p.queue; delete p.synced; delete p.operations; return; }
        const session = sessions.get(p.id);
        const operationsTask=loadOperations(p,session);
        try {
          const [skills, queue] = await Promise.all([
            esi(`characters/${p.id}/skills/`, session.token), esi(`characters/${p.id}/skillqueue/`, session.token)
          ]);
          // A disconnect or expiry during a request must not restore private data.
          if (sessions.get(p.id) !== session || !isConnected(p.id)) return;
          p.skills = skills; p.queue = queue.sort((a,b) => a.queue_position - b.queue_position);
          p.synced = new Date().toISOString();
          try { await resolveNames(p.queue.map(q => q.skill_id)); }
          catch { p.nameWarning = 'Some skill names could not be loaded. IDs are shown instead.'; }
        } catch (error) { p.error = `Training: ${error.message} Previous data, if any, is retained.`; }
        await operationsTask;
      }));
    }
    if (request !== generation) return;
    $('#sync-status').textContent = `Last refresh ${new Date().toLocaleTimeString()} · Public ESI profiles · Private character data is session-only`;
  } catch (error) {
    if (request !== generation) return;
    next.forEach(p => p.error = error.message);
    $('#sync-status').textContent = 'Refresh failed. Previously loaded profiles are retained; use Refresh ESI to retry.';
  } finally {
    await statusTask;
    if (request === generation) {
      next.forEach(p => p.refreshing = false);
      $('#refresh').disabled = false;
      renderPilots(); renderTraining(); renderApiOverview(); renderOperations(); pilotOptions();
    }
  }
}
async function loadOperations(p, session) {
  const result={};
  const endpoints={wallet:'wallet/',location:'location/',ship:'ship/',jobs:'industry/jobs/?include_completed=false'};
  await Promise.all(Object.entries(endpoints).map(async([key,path])=>{
    if(!session.scopes?.includes(OPERATIONS_SCOPES[key])) { result[key]={permission:false}; return; }
    try {
      const value=await esi(`characters/${p.id}/${path}`,session.token);
      result[key]={permission:true,value,fetched:new Date().toISOString()};
      const ids=key==='ship'?[value.ship_type_id]:key==='location'?[value.solar_system_id]:key==='jobs'?value.map(job=>job.product_type_id||job.blueprint_type_id):[];
      try { if(ids.length)await resolveNames(ids.filter(Number.isSafeInteger)); } catch { result[key].nameWarning=true; }
      if(key==='location'&&value.station_id) {
        try { result[key].station=(await esi(`universe/stations/${value.station_id}/`)).name; } catch { result[key].station=`Station ${value.station_id}`; }
      }
    } catch(error) { result[key]={...p.operations?.[key],permission:true,error:error.message}; }
  }));
  if(sessions.get(p.id)===session&&isConnected(p.id))p.operations=result;
}
function renderApiOverview() {
  const connected=pilots.filter(p=>isConnected(p.id));
  const trained=pilots.filter(p=>p.skills);
  const active=pilots.filter(p=>p.queue?.some(q=>Date.parse(q.start_date)<=Date.now()&&Date.parse(q.finish_date)>Date.now()));
  $('#api-summary').innerHTML=[
    [`${connected.length} / ${pilots.length}`,'CONNECTED PILOTS'],
    [trained.length?trained.reduce((total,p)=>total+p.skills.total_sp,0).toLocaleString():'—','CONNECTED PILOTS’ SKILL POINTS'],
    [trained.length?active.length:'—','PILOTS TRAINING NOW']
  ].map(([value,label])=>`<div class="summary-tile"><strong>${esc(value)}</strong><span>${label}</span></div>`).join('');
  $('#server-status').innerHTML=universeStatus?`<span class="badge">TRANQUILITY ${universeStatus.vip?' / RESTRICTED ACCESS':''}</span><strong>${Number(universeStatus.players).toLocaleString()} <small>pilots online</small></strong><span class="muted hint">ESI server status · ${universeStatus.stale?'Last known data':`Fetched ${esc(new Date(universeStatus.fetched).toLocaleTimeString())}`}</span>`:'<span class="muted">Server status unavailable. Refresh to retry.</span>';
  $('#career-content').innerHTML=pilots.map(p=>`<article class="panel"><span class="badge">${esc(p.name)}</span><h3>${esc(p.corporation||'Corporation record')}</h3><p class="muted hint">${esc(p.corporationInfo?.ticker||'')}${Number.isFinite(p.corporationInfo?.member_count)?` · ${p.corporationInfo.member_count.toLocaleString()} members`:''}${Number.isFinite(p.corporationInfo?.tax_rate)?` · ${(p.corporationInfo.tax_rate*100).toFixed(1)}% corporation tax`:''}</p>${p.careerError?`<p class="error hint">History unavailable: ${esc(p.careerError)}</p>`:''}${p.career?.length?`<ol class="career-list">${p.career.map(item=>`<li><strong>${esc(item.name)}</strong><span>Joined ${esc(new Date(item.start_date).toLocaleDateString())}</span></li>`).join('')}</ol>`:'<p class="muted hint">No corporation history loaded.</p>'}</article>`).join('');
}
function renderOperations() {
  const labels={wallet:'Wallet balance',location:'Current location',ship:'Current ship',jobs:'Industry jobs'};
  $('#operations-content').innerHTML=pilots.map((p,index)=>`<article class="panel"><div class="section-head"><div><span class="badge">${esc(p.name)}</span><h3>Character operations</h3></div><button data-connect="${index}" class="secondary" ${p.id?'':'disabled'}>${isConnected(p.id)?'Update permissions':'Connect pilot'}</button></div><div class="operations-grid">${Object.entries(labels).map(([key,label])=>{
    const field=p.operations?.[key];
    if(!field?.permission)return `<section class="operation-card"><h4>${label}</h4><p class="muted hint">${isConnected(p.id)?'Permission not granted. Reconnect to enable this data.':'Connect this pilot with EVE to load this data.'}</p></section>`;
    const value=field.value;
    let content='';
    if(value!==undefined) {
      if(key==='wallet')content=`<strong class="operation-value">${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} <small>ISK</small></strong>`;
      if(key==='ship')content=`<strong class="operation-value">${esc(types.get(value.ship_type_id)||`Ship type ${value.ship_type_id}`)}</strong><p class="muted hint">${esc(value.ship_name||'Unnamed ship')}</p>`;
      if(key==='location')content=`<strong class="operation-value">${esc(types.get(value.solar_system_id)||`System ${value.solar_system_id}`)}</strong><p class="muted hint">${esc(field.station||(value.structure_id?'Docked at a player structure':'In space'))}</p>`;
      if(key==='jobs')content=value.length?`<p class="muted hint">${value.length} ${value.length===1?'job':'jobs'} returned by ESI · showing up to 20</p>${value.slice(0,20).map(job=>`<div class="queue-row"><span>${esc(types.get(job.product_type_id||job.blueprint_type_id)||`Blueprint ${job.blueprint_type_id}`)}<small> · ${Number(job.runs)} runs</small></span><span>${esc(job.status)}${job.end_date?` · ${esc(remaining(job.end_date))}`:''}</span></div>`).join('')}`:'<p class="muted">No current industry jobs.</p>';
    }
    return `<section class="operation-card"><h4>${label}</h4>${content}${field.error?`<p class="error hint">${esc(field.error)}${value!==undefined?' Showing the previous response.':''}</p>`:''}${field.fetched?`<p class="muted hint">Fetched ${esc(new Date(field.fetched).toLocaleTimeString())} · ESI may cache responses</p>`:''}</section>`;
  }).join('')}</div></article>`).join('')||'<div class="empty">Configure a pilot to connect EVE data.</div>';
}

function renderPilots() {
  $('#pilots').innerHTML = pilots.length ? pilots.map((p, i) => {
    const birthday = p.profile?.birthday;
    const age = birthday ? Math.max(0, Math.floor((Date.now() - Date.parse(birthday)) / 86400000)) : null;
    const queue = p.queue?.filter(q => !q.finish_date || Date.parse(q.finish_date) > Date.now());
    return `<article class="pilot-card"><div class="pilot-head"><div class="portrait">${p.id ? `<img src="https://images.evetech.net/characters/${p.id}/portrait?size=128" alt="Portrait of ${esc(p.name)}" width="64" height="64">` : '✦'}</div><div><span class="badge">PILOT 0${i+1} / ${isConnected(p.id) ? 'EVE CONNECTED' : 'PUBLIC PROFILE'}</span><h3>${esc(p.name)}</h3><small class="muted">${esc(p.corporation || (p.refreshing ? 'Loading corporation…' : 'Corporation unavailable'))}</small></div></div>
    <div class="profile-facts"><span>Capsuleer since <strong>${birthday ? esc(new Date(birthday).toLocaleDateString()) : '—'}</strong></span><span>Security status <strong>${Number.isFinite(p.profile?.security_status) ? p.profile.security_status.toFixed(2) : '—'}</strong></span></div>
    <div class="stats"><div><small>${p.skills ? 'TOTAL SKILL POINTS' : 'DAYS IN NEW EDEN'}</small><strong>${p.skills ? Number(p.skills.total_sp).toLocaleString() : age === null ? '—' : age.toLocaleString()}</strong></div><div><small>${p.queue ? 'QUEUED SKILLS' : 'TRAINING ACCESS'}</small><strong>${queue ? queue.length : 'Not connected'}</strong></div></div>
    ${p.error ? `<p class="error hint">${esc(p.error)}</p>` : ''}<p class="muted hint">${p.synced ? `Training fetched ${esc(new Date(p.synced).toLocaleTimeString())}` : config.eveClientId ? 'Connect to see private skills and training.' : 'Training setup needed · add an EVE application client ID.'}</p>
    <div class="actions"><button data-connect="${i}" class="secondary" ${!p.id || p.refreshing ? 'disabled' : ''}>${isConnected(p.id) ? 'Reconnect' : config.eveClientId ? 'Connect with EVE' : 'Set up EVE login'}</button>${isConnected(p.id) ? `<button data-disconnect="${p.id}" class="secondary">Disconnect</button>` : ''}</div></article>`;
  }).join('') : '<div class="empty">Your wing is waiting. Use Configure pilots to add your two character names.</div>';
}
function renderTraining() {
  const now = Date.now();
  $('#training-content').innerHTML = pilots.length ? pilots.map(p => {
    const queue = p.queue?.filter(q => !q.finish_date || Date.parse(q.finish_date) > now);
    const active = queue?.find(q => Date.parse(q.start_date) <= now && Date.parse(q.finish_date) > now);
    const last = queue?.filter(q => q.finish_date).at(-1);
    return `<article class="panel"><div class="section-head"><div><span class="badge">${esc(p.name)}</span><h3>Training queue</h3></div><span class="muted hint">${isConnected(p.id) ? `Session ends ${esc(new Date(sessions.get(p.id).expires).toLocaleTimeString())}` : 'EVE login required'}</span></div>
    ${p.error ? `<p class="error hint">${esc(p.error)}</p>` : ''}
    ${queue ? `${active ? `<div class="active-training"><span class="badge">TRAINING NOW</span><h3>${esc(types.get(active.skill_id) || `Skill ${active.skill_id}`)} → ${active.finished_level}</h3><progress max="100" value="${trainingProgress(active)}" aria-label="Current skill training progress"></progress><p class="muted hint">${remaining(active.finish_date)} · Ends ${esc(new Date(active.finish_date).toLocaleString())}</p></div>` : '<p class="muted">No skill is currently scheduled to train.</p>'}
    <p class="muted hint">${queue.length} queued skills${last ? ` · Queue ends ${esc(new Date(last.finish_date).toLocaleString())}` : ''}</p>${p.nameWarning ? `<p class="muted hint">${esc(p.nameWarning)}</p>` : ''}
    ${queue.length ? queue.map((q,i) => `<div class="queue-row"><span><small>${String(i+1).padStart(2,'0')} / </small>${esc(types.get(q.skill_id) || `Skill ${q.skill_id}`)} <small>→ Level ${q.finished_level}</small></span><span>${esc(q.finish_date ? remaining(q.finish_date) : 'Paused / not scheduled')}</span></div>`).join('') : '<p class="muted">Your training queue is empty. Add a skill in EVE Online.</p>'}` : '<div class="empty">Your training plan belongs here.<br><br>Connect this pilot from Pilots to load their read-only skills and queue.</div>'}
    ${p.skills ? `<details><summary>${p.skills.skills.length} trained skills · ${Number(p.skills.unallocated_sp || 0).toLocaleString()} unallocated SP</summary><button data-skills="${p.id}" class="secondary">Load searchable skill list</button><div id="skills-${p.id}" class="skill-list"></div></details>` : ''}</article>`;
  }).join('') : '<div class="empty">Configure your pilots to start tracking training.</div>';
}
function renderLocal() {
  const open = data.goals.filter(g => !g.done), done = data.goals.length - open.length;
  $('#flight-summary').innerHTML = [
    [open.length, 'OPEN GOALS'], [done, 'MILESTONES COMPLETE'], [data.entries.length, 'PRIVATE JOURNAL ENTRIES']
  ].map(([n,label]) => `<div class="summary-tile"><strong>${n}</strong><span>${label}</span></div>`).join('');
  const next = [...open].sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999'))[0];
  const latest = filterEntries(data.entries)[0];
  $('#next-chapter').innerHTML = `<article class="panel"><span class="badge">NEXT GOAL · LOCAL</span><h3>${next ? esc(next.title) : 'Set a destination'}</h3><p class="muted hint">${next ? `${esc(next.pilot)}${next.due ? ` · Target ${esc(next.due)}` : ''}` : 'Turn an ambition into your first milestone.'}</p><button class="secondary" data-tab="goals">${next ? 'View goals' : 'Create a goal'} →</button></article><article class="panel"><span class="badge">LATEST ENTRY · PRIVATE</span><h3>${latest ? esc(latest.title) : 'Start your flight record'}</h3><p class="muted hint">${latest ? `${esc(latest.date)} · ${esc(latest.pilot)}` : 'The ordinary flights become the best stories.'}</p><button class="secondary" data-tab="journal">Open journal →</button></article>`;
  const filter = $('#goal-filter').value;
  const goals = data.goals.filter(g => filter === 'all' || (filter === 'done' ? g.done : !g.done));
  $('#goal-count').textContent = `${done} of ${data.goals.length} goals complete`;
  $('#goal-list').innerHTML = goals.length ? goals.map(g => `<article class="goal ${g.done ? 'done' : ''}"><div><label><input type="checkbox" data-goal="${esc(g.id)}" ${g.done ? 'checked' : ''}>${esc(g.title)}</label><small>${esc(g.pilot)} · ${esc(g.category || 'Other')}${g.due ? ` · <span class="${!g.done && g.due < localDate() ? 'error' : ''}">Target ${esc(g.due)}</span>` : ''}</small></div><div class="actions"><button data-edit-goal="${esc(g.id)}" class="secondary">Edit</button><button data-delete-goal="${esc(g.id)}" class="secondary" aria-label="Delete ${esc(g.title)}">Delete</button></div></article>`).join('') : `<div class="empty">${data.goals.length ? 'No goals in this view.' : 'A new ship? A new system? Give your next adventure a goal.'}</div>`;
  pilotOptions();
  renderEntries();
}
function renderEntries() {
  const entries = filterEntries(data.entries, {query:$('#journal-search').value, pilot:$('#journal-pilot').value, category:$('#journal-category').value});
  $('#entry-count').textContent = `${entries.length} of ${data.entries.length} entries · Private to this browser`;
  $('#entries').innerHTML = entries.length ? entries.map(e => `<article class="entry"><div class="entry-top"><div><small>${esc(e.date)} / ${esc(e.pilot)} / ${esc(e.category || 'Adventure')}</small><h3>${esc(e.title)}</h3></div><div class="actions"><button data-edit-entry="${esc(e.id)}" class="secondary">Edit</button><button data-delete-entry="${esc(e.id)}" class="secondary" aria-label="Delete ${esc(e.title)}">Delete</button></div></div><p>${esc(e.body)}</p></article>`).join('') : `<div class="empty">${data.entries.length ? 'No entries match. Try a different search or filter.' : 'Every capsuleer starts somewhere. Write your first chapter.'}</div>`;
}
function selectTab(id) {
  if (!['overview','training','operations','goals','journal'].includes(id)) return;
  document.querySelectorAll('nav [data-tab]').forEach(b => {
    if (b.dataset.tab === id) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  document.body.dataset.section = id;
  document.querySelector('nav details').open=false;
  document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== id);
  history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
}
async function connect(index) {
  if (!config.eveClientId) { openSettings(true); return; }
  const p = pilots[index];
  if (!p?.id) throw new Error('Wait for the public character lookup before connecting.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem('eve-oauth', JSON.stringify({verifier,state,created:Date.now(),expectedId:p.id,clientId:config.eveClientId}));
  const url = new URL('https://login.eveonline.com/v2/oauth/authorize/');
  url.search = new URLSearchParams({response_type:'code',redirect_uri:callback,client_id:config.eveClientId,scope:REQUESTED_SCOPES.join(' '),state,code_challenge:await challenge(verifier),code_challenge_method:'S256'});
  location.assign(url);
}
async function finishLogin() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return;
  history.replaceState(null,'',callback);
  const raw = sessionStorage.getItem('eve-oauth'); sessionStorage.removeItem('eve-oauth');
  const pending = raw ? JSON.parse(raw) : null;
  validateState(pending, params.get('state'));
  if (params.has('error')) throw new Error('EVE login was cancelled or declined.');
  const result = await json('https://login.eveonline.com/v2/oauth/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'authorization_code',code:params.get('code'),client_id:pending.clientId,code_verifier:pending.verifier})
  });
  const jwks = await json('https://login.eveonline.com/oauth/jwks');
  const identity = await validateToken(result.access_token, pending.clientId, pending.expectedId, jwks.keys);
  sessions.set(pending.expectedId, {token:result.access_token, expires:identity.expires, scopes:identity.scopes});
  try { saveSessions(); } catch { sessions.delete(pending.expectedId); throw new Error('Session storage is unavailable. EVE credentials were not retained.'); }
  notice(`Connected ${identity.name}. Authorized EVE data is available until ${new Date(identity.expires).toLocaleTimeString()}.`);
}
function openSettings(training = false) {
  const f = $('#settings-form');
  f.elements.pilot1.value = config.pilots[0] || ''; f.elements.pilot2.value = config.pilots[1] || '';
  f.elements.clientId.value = config.eveClientId; $('#callback-url').textContent = callback;
  $('#settings-error').hidden = true;
  $('#settings details').open = training;
  $('#settings').showModal();
}
function saveDraft() {
  clearTimeout(draftTimer);
  try {
    const f = $('#journal-form');
    sessionStorage.setItem(DRAFT, JSON.stringify({...Object.fromEntries(new FormData(f)), editingEntry}));
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
  if (($('#journal-form').elements.title.value || $('#journal-form').elements.body.value) && !confirm('Replace your current draft with this entry?')) return;
  editingEntry = id;
  const f = $('#journal-form');
  for (const key of ['title','body','date','pilot','category']) if (item[key] !== undefined) {
    if (key === 'category' && ![...f.elements.category.options].some(o => o.value === item.category)) f.elements.category.add(new Option(item.category,item.category));
    f.elements[key].value = item[key];
  }
  if (!item.category) f.elements.category.value = 'Adventure';
  $('#entry-submit').textContent = 'Save changes'; $('#cancel-entry-edit').hidden = false;
  selectTab('journal'); f.scrollIntoView({behavior:'smooth',block:'start'}); f.elements.title.focus(); saveDraft();
}
function resetGoal() {
  editingGoal = null; $('#goal-form').reset(); $('#goal-submit').textContent = 'Add goal'; $('#cancel-goal-edit').hidden = true;
}
function download(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents],{type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
function expireSessions() {
  let changed = false;
  for (const [id, session] of sessions) {
    if (session.expires > Date.now()) continue;
    sessions.delete(id); changed = true;
    const p = pilots.find(p => p.id === id);
    if (p) { delete p.skills; delete p.queue; delete p.synced; delete p.operations; }
  }
  if (changed) {
    try { saveSessions(); } catch { /* In-memory expiry still removes private data. */ }
    renderPilots(); renderTraining(); renderOperations(); renderApiOverview(); notice('An EVE session expired. Reconnect the pilot to see fresh training data.');
  }
}

$('#copy-eve-registration').onclick = async () => {
  const text = `Application: EVE Flight Journal\nWebsite: ${callback}\nCallback URL: ${callback}\nScopes: ${REQUESTED_SCOPES.join(' ')}\nFlow: Authorization Code with PKCE (S256); no client secret in the frontend`;
  try { await navigator.clipboard.writeText(text); $('#registration-status').textContent = 'Registration details copied. Paste them into the EVE developer application form.'; }
  catch { $('#registration-status').textContent = text; }
};
$('#settings-button').onclick = () => openSettings();
$('#close-settings').onclick = () => $('#settings').close();
$('#refresh').onclick = loadPilots;
$('#settings-form').onsubmit = async event => {
  event.preventDefault();
  const f = new FormData(event.target);
  const next = {pilots:[f.get('pilot1').trim(),f.get('pilot2').trim()].filter(Boolean),eveClientId:f.get('clientId').trim()};
  try {
    if (new Set(next.pilots.map(n => n.toLowerCase())).size !== next.pilots.length) throw new Error('Please use two different character names.');
    localStorage.setItem(SETTINGS, JSON.stringify(next)); config=next; $('#settings').close(); await loadPilots();
  } catch (error) { $('#settings-error').textContent=error.message; $('#settings-error').hidden=false; }
};
$('#goal-form').onsubmit = event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.target));
  if (!fields.title.trim()) return;
  const goal = {...fields,title:fields.title.trim(),id:editingGoal || crypto.randomUUID(),done:data.goals.find(g => g.id === editingGoal)?.done || false};
  if (persist({...data,goals:editingGoal ? data.goals.map(g => g.id === editingGoal ? goal : g) : [...data.goals,goal]})) {
    resetGoal(); notice('Goal saved in this browser.');
  }
};
$('#journal-form').onsubmit = event => {
  event.preventDefault(); clearTimeout(draftTimer);
  const fields = Object.fromEntries(new FormData(event.target));
  if (!fields.title.trim() || !fields.body.trim()) return;
  const entry = {...fields,title:fields.title.trim(),body:fields.body.trim(),id:editingEntry || crypto.randomUUID()};
  if (editingEntry && !data.entries.some(e => e.id === editingEntry)) { notice('This entry no longer exists. Cancel editing to save it as a new entry.'); return; }
  if (persist({...data,entries:editingEntry ? data.entries.map(e => e.id === editingEntry ? entry : e) : [...data.entries,entry]})) {
    resetEntry(); notice('Journal entry saved privately in this browser.');
  }
};
$('#journal-form').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer=setTimeout(saveDraft,400); });
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
  if (event.target.matches('[data-goal]')) {
    const saved = persist({...data,goals:data.goals.map(g => g.id === event.target.dataset.goal ? {...g,done:event.target.checked} : g)});
    if (!saved) event.target.checked = !event.target.checked;
  }
});
document.addEventListener('input', event => {
  if (!event.target.matches('[data-skill-search]')) return;
  const term=event.target.value.toLowerCase();
  event.target.closest('.skill-list').querySelectorAll('.queue-row').forEach(row => row.hidden=!row.textContent.toLowerCase().includes(term));
});
document.addEventListener('click', async event => {
  const b=event.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.tab) selectTab(b.dataset.tab);
    if (b.dataset.connect !== undefined) await connect(Number(b.dataset.connect));
    if (b.dataset.disconnect) {
      const id=Number(b.dataset.disconnect); sessions.delete(id);
      const p=pilots.find(p => p.id===id); if(p) { delete p.skills; delete p.queue; delete p.synced; delete p.operations; }
      renderPilots(); renderTraining(); renderOperations(); renderApiOverview(); saveSessions();
    }
    if (b.dataset.editEntry) editEntry(b.dataset.editEntry);
    if (b.dataset.editGoal) {
      const g=data.goals.find(g => g.id===b.dataset.editGoal); if (!g) return;
      editingGoal=g.id;
      const f=$('#goal-form'); if(g.category && ![...f.elements.category.options].some(o => o.value===g.category)) f.elements.category.add(new Option(g.category,g.category)); for (const key of ['title','pilot','due','category']) f.elements[key].value=g[key] || (key==='category'?'Other':'');
      $('#goal-submit').textContent='Save changes'; $('#cancel-goal-edit').hidden=false; f.scrollIntoView({behavior:'smooth'}); f.elements.title.focus();
    }
    if (b.dataset.deleteGoal && confirm('Delete this local goal?')) {
      if(persist({...data,goals:data.goals.filter(g => g.id!==b.dataset.deleteGoal)}) && editingGoal===b.dataset.deleteGoal) resetGoal();
    }
    if (b.dataset.deleteEntry && confirm('Delete this private entry? Export a backup first if you want to keep it.')) {
      if(persist({...data,entries:data.entries.filter(e => e.id!==b.dataset.deleteEntry)}) && editingEntry===b.dataset.deleteEntry) resetEntry();
    }
    if (b.dataset.skills) {
      b.disabled=true; b.textContent='Loading skill names…';
      const p=pilots.find(p => p.id===Number(b.dataset.skills)); if (!p?.skills) return;
      const skills=p.skills.skills;
      await resolveNames(skills.map(s => s.skill_id));
      if (!isConnected(p.id) || !document.contains(b)) return;
      $(`#skills-${p.id}`).innerHTML='<label>Find a skill<input type="search" data-skill-search placeholder="Search trained skills"></label>' +
        [...skills].sort((a,b) => (types.get(a.skill_id)||'').localeCompare(types.get(b.skill_id)||'')).map(s => `<div class="queue-row"><span>${esc(types.get(s.skill_id) || `Skill ${s.skill_id}`)}</span><span>Level ${s.trained_skill_level}${s.active_skill_level < s.trained_skill_level ? ` · Active ${s.active_skill_level}` : ''}</span></div>`).join('');
      b.hidden=true;
    }
  } catch (error) { notice(error.message); b.disabled=false; if(b.dataset.skills) b.textContent='Retry loading skill names'; }
});
$('#export').onclick = () => {
  if (store.locked) { notice('Export is blocked because the journal could not be read. Use Download raw recovery file.'); return; }
  download(JSON.stringify(data,null,2),`eve-journal-${localDate()}.json`);
  try { localStorage.setItem(`${KEY}:backup`, new Date().toISOString()); } catch { /* Download still works. */ }
  $('#backup-status').textContent=`Backup requested ${new Date().toLocaleString()}. Check your downloads; it contains private notes.`;
};
$('#recover').onclick = () => { try { download(localStorage.getItem(KEY) || '', `eve-journal-recovery-${localDate()}.json`); } catch { notice('Browser storage is inaccessible. Recovery requires access to this browser’s site data.'); } };
$('#import').onchange = async event => {
  try {
    const file=event.target.files[0]; if(!file) return;
    if(file.size>5000000) throw new Error('Backup must be under 5 MB.');
    const incoming=validateBackup(JSON.parse(await file.text()));
    if (confirm(`Merge ${incoming.entries.length} entries and ${incoming.goals.length} goals? Matching IDs will be replaced. Export a backup first to keep the current versions.`)) {
      if (persist(mergeBackups(data,incoming))) { pilotOptions(); renderEntries(); notice('Backup merged. These records stay private in this browser.'); }
    }
  } catch(error) { notice(`Import failed: ${error.message}`); }
  finally { event.target.value=''; }
};
window.addEventListener('storage', event => {
  if (event.key===KEY || event.key===null) notice('Another tab changed this journal. Reload before saving. Your current draft is preserved in this tab.');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) expireSessions(); });
setInterval(expireSessions, 30000);

async function init() {
  try { store=new JournalStore(localStorage,KEY); data=store.load(); }
  catch (error) {
    store ||= {locked:true,save(){throw new Error('Browser storage is unavailable.');}};
    notice(error.message);
    document.querySelectorAll('#goal-form button,#journal-form button,#import').forEach(b => b.disabled=true);
    $('#recover').hidden=false;
  }
  try {
    config=await json('./config.json');
    const saved=localStorage.getItem(SETTINGS); if(saved) config=JSON.parse(saved);
    if(!Array.isArray(config.pilots) || config.pilots.length>2 || config.pilots.some(p => typeof p!=='string' || !p.trim() || p.length>100) || new Set(config.pilots.map(p => p.toLowerCase())).size!==config.pilots.length) throw new Error('Invalid pilot settings. Reconfigure your pilots.');
    config.eveClientId=String(config.eveClientId || '');
  } catch(error) { config={pilots:['Fiofka','Decxus'],eveClientId:''}; notice(`Using default pilots. ${error.message}`); }
  try {
    const saved=JSON.parse(sessionStorage.getItem('eve-sessions') || '[]');
    sessions=new Map(saved.filter(row => Array.isArray(row) && Number.isSafeInteger(row[0]) && typeof row[1]?.token==='string' && row[1].expires>Date.now()));
    // Persisted tokens are revalidated before any private ESI request.
    if(sessions.size) {
      const jwks=await json('https://login.eveonline.com/oauth/jwks');
      for(const [id, session] of sessions) {
        try { const identity=await validateToken(session.token,config.eveClientId,id,jwks.keys); session.scopes=identity.scopes; }
        catch { sessions.delete(id); }
      }
      saveSessions();
    }
    await finishLogin();
  } catch(error) { sessions.clear(); try{saveSessions();}catch{} notice(`EVE connection: ${error.message}`); }
  renderLocal();
  // Populate selects before restoring an existing author in a draft.
  pilots=config.pilots.map(name => ({name})); pilotOptions(); resetEntry(true);
  selectTab(location.hash.slice(1) || 'overview');
  restoreDraft();
  await loadPilots();
}
// Read the draft before initialization resets the blank editor.
let recoveredDraft;
try { recoveredDraft=JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); } catch { /* Ignore malformed drafts; never overwrite journal records. */ }
function restoreDraft() {
if(recoveredDraft && typeof recoveredDraft.title==='string' && typeof recoveredDraft.body==='string' && recoveredDraft.title.length<=160 && recoveredDraft.body.length<=20000) {
  const f=$('#journal-form');
  for(const key of ['title','body','date','category','pilot']) if(typeof recoveredDraft[key]==='string') {
    if(key==='pilot' && ![...f.elements.pilot.options].some(o => o.value===recoveredDraft.pilot)) f.elements.pilot.add(new Option(recoveredDraft.pilot,recoveredDraft.pilot));
    f.elements[key].value=recoveredDraft[key];
  }
  editingEntry=data.entries.some(e => e.id===recoveredDraft.editingEntry) ? recoveredDraft.editingEntry : null;
  $('#entry-submit').textContent=editingEntry ? 'Save changes' : 'Save entry locally'; $('#cancel-entry-edit').hidden=!editingEntry;
  $('#draft-status').textContent='Recovered your private draft from this tab.'; saveDraft();
}

}
await init();
