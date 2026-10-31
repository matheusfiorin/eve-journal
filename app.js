import {BackendClient} from './backend.js';
import {emptyData, validateBackup, mergeBackups, remaining, escapeHTML as esc, localDate, filterEntries, trainingProgress, queueState, pilotRoles, pilotTitle, assetHoldings, shares, compactNumber} from './model.js';
import {fees, book, hauls, stationTrades, manufacturing} from './market.js';
import {skillLevels, isAlpha, slots, evaluate, rank, portfolio, stage, nextSkills, SCC, NPC_FACILITY_TAX, ALPHA_TAX} from './industry.js';
import {graph, leg, facilities, nearest, secShown, secClass, dotlanSystem, dotlanRoute} from './route.js';
import {JournalStore} from './storage.js';

const $ = selector => document.querySelector(selector);
const KEY = 'eve-flight-journal:v1';
const DRAFT = 'eve-flight-draft:v1';
const GROUPS = 'eve-skill-groups:v1';
const ME = 'eve-me:v1';
const CATS = 'eve-asset-categories:v1';
const TABS = ['overview','empire','market','industry','training','skills','wallet','clones','notes'];
const HUB_SYSTEMS = [[30000142,'Jita'],[30002187,'Amarr'],[30002659,'Dodixie'],[30002510,'Rens'],[30002053,'Hek']];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const OLD_TABS = {journal:'notes', goals:'notes', operations:'wallet'};
const ROMAN = ['0','I','II','III','IV','V'];
const SKILL_LABELS = {industry:'Industry', advancedIndustry:'Advanced Industry', massProduction:'Mass Production', advancedMassProduction:'Advanced Mass Production', science:'Science', labOperation:'Laboratory Operation', advancedLabOperation:'Advanced Laboratory Operation', metallurgy:'Metallurgy', research:'Research', accounting:'Accounting', brokerRelations:'Broker Relations'};
const INFOMORPH_SYNCHRONIZING = 33399;
const home = new URL('./', location.href).href;
let config = {pilots:[]};
let data = emptyData(), pilots = [], store, backend = null, universeStatus = null;
let generation = 0, editingEntry = null, editingGoal = null, draftTimer;
const names = new Map(), corporations = new Map(), typeGroup = new Map();
let me = null, wing = new Map(), prices = null, adjusted = new Map(), marketData = null, marketBook = null, costIndices = null, marketRun = 0, industryRun = 0, starsFrame = 0, warp = false;
const assetCats = new Map(), routes = new Map(), counters = new Map(), cargo = new Map();
try { JSON.parse(localStorage.getItem(CATS) || '[]').forEach(([id, cat]) => assetCats.set(id, cat)); } catch { /* Categories are refetched. */ }

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
    await loadWing();
    if (next.some(p => p.skills?.skills) || [...wing.values()].some(w => w.skills?.skills)) await loadSkillGroups();
    await loadHoldings();
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

async function loadWing() {
  const holder = [mine(), ...pilots].find(p => p?.id && backend?.has(p.id));
  if (!holder) { wing = new Map(); return; }
  try { wing = new Map((await backend.wing(holder.id)).map(row => [row.characterId, row])); }
  catch (error) { notice(`Wingmate summary: ${error.message}`); }
}
async function loadPrices() {
  if (prices) return;
  try {
    const rows = await esi('markets/prices/');
    prices = new Map(rows.map(r => [r.type_id, r.average_price || r.adjusted_price || 0]));
    adjusted = new Map(rows.map(r => [r.type_id, r.adjusted_price || 0]));
  } catch { /* Asset values stay unknown until the next refresh. */ }
}
async function loadAssetCategories(ids) {
  const missing = ids.filter(id => !assetCats.has(id)), groups = new Map(), categories = new Map();
  await Promise.all(missing.map(async id => {
    try {
      const type = await esi(`universe/types/${id}/`);
      if (!groups.has(type.group_id)) groups.set(type.group_id, esi(`universe/groups/${type.group_id}/`));
      const group = await groups.get(type.group_id);
      if (!categories.has(group.category_id)) categories.set(group.category_id, esi(`universe/categories/${group.category_id}/`));
      assetCats.set(id, (await categories.get(group.category_id)).name);
    } catch { /* Shown as uncategorized. */ }
  }));
  try { localStorage.setItem(CATS, JSON.stringify([...assetCats])); } catch { /* Cache is optional. */ }
}
// Value assets, then name and categorize the top holdings that the Empire tab shows.
async function loadHoldings() {
  if (!pilots.some(p => assetsOf(p))) return;
  await loadPrices();
  const top = pilots.flatMap(p => summary(p).holdings?.rows.slice(0, 60).map(r => r.type) || []);
  try { await Promise.all([resolveNames(top), loadAssetCategories(top)]); } catch { /* Names fall back to IDs. */ }
}
const mine = () => pilots.find(p => p.name === me) || null;
const wingmate = () => pilots.find(p => p.name !== me) || null;
const ordered = () => [...pilots].sort((a,b) => (b.name === me) - (a.name === me));
const portrait = (p, size, cls = '') => p?.id ? `<img class="portrait ${cls}" src="https://images.evetech.net/characters/${p.id}/portrait?size=${size >= 100 ? 256 : 128}" alt="Portrait of ${esc(p.name)}" width="${size}" height="${size}">` : `<span class="portrait ${cls}" aria-hidden="true">✦</span>`;
const assetsOf = p => p.private ? p.ops?.assets?.value : wing.get(p.id)?.assets;
function summary(p) {
  if (!p) return {};
  const w = wing.get(p.id);
  const skills = p.private ? p.skills : w?.skills || p.skills;
  const walletRaw = p.private ? p.ops?.wallet?.value : w?.wallet;
  const wallet = Number.isFinite(walletRaw) ? walletRaw : undefined;
  const holdings = assetsOf(p) && prices ? assetHoldings(assetsOf(p), prices) : null;
  const known = wallet !== undefined || holdings;
  return {skills, sp:skills?.total_sp, maxed:skills?.skills?.filter(s => s.trained_skill_level === 5).length, wallet, holdings,
    assets:holdings?.total, worth:known ? (wallet || 0) + (holdings?.total || 0) : undefined,
    title:skills?.skills ? pilotTitle(skills, id => typeGroup.get(id)) : null};
}
function queueHours(p) {
  const state = queueState(p?.queue);
  if (!state) return undefined;
  return state.end ? Math.max(0, (state.end - Date.now()) / 3600000) : 0;
}
function format(value, kind) {
  if (!Number.isFinite(value)) return '—';
  if (kind === 'isk') return `${compactNumber(value)} ISK`;
  if (kind === 'pct') return `${Math.round(value)}%`;
  if (kind === 'h') return value >= 24 ? `${Math.floor(value / 24)}d ${Math.round(value % 24)}h` : `${Math.round(value)}h`;
  return Math.round(value).toLocaleString();
}
// Numbers roll from their previous value; reduced motion shows the final value at once.
const count = (key, value, kind = '') => Number.isFinite(value) ? `<span data-count="${value}" data-key="${esc(key)}" data-kind="${kind}">${format(value, kind)}</span>` : '—';
function countUps() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = Number(el.dataset.count), key = el.dataset.key, from = counters.get(key) ?? 0, kind = el.dataset.kind;
    counters.set(key, target);
    if (reduced || from === target || el.closest('[hidden]')) { el.textContent = format(target, kind); return; }
    const start = performance.now();
    const step = now => {
      const k = Math.min(1, (now - start) / 900);
      el.textContent = format(from + (target - from) * (1 - Math.pow(1 - k, 3)), kind);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
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
  return pilots.length ? ordered().map(p => render(p, pilots.indexOf(p))).join('') : '<div class="empty">No pilots configured in config.json.</div>';
}

function renderStatus() {
  $('#server-status').innerHTML = universeStatus ? `<span class="dot ${universeStatus.stale ? '' : 'on'}"></span><span><b>${Number(universeStatus.players).toLocaleString()}</b> pilots online${universeStatus.vip ? ' · VIP only' : ''}${universeStatus.stale ? ' · last known' : ''}</span>` : '<span class="hint">Tranquility status unavailable</span>';
}
function vsRow(label, a, b, kind, other) {
  const known = Number.isFinite(a) && Number.isFinite(b);
  const split = known ? shares([a, b]).shares : [0, 0];
  const verdict = !known ? (Number.isFinite(a) ? `${esc(other)}’s figure is private` : 'Not available yet')
    : Math.abs(a - b) <= Math.max(a, b) * 0.005 ? 'Dead even' : a > b ? `You lead${b > 0 ? ` by ${Math.round((a - b) / b * 100)}%` : ''}` : `${esc(other)} leads${a > 0 ? ` by ${Math.round((b - a) / a * 100)}%` : ''}`;
  return `<div class="vs ${known ? (a >= b ? 'ahead' : 'behind') : 'unknown'}"><span class="vs-label">${label}</span><b class="vs-me">${count(`vs-me-${label}`, a, kind)}</b><span class="vs-bar" aria-hidden="true"><i class="fill me" style="width:${(split[0] * 100).toFixed(1)}%"></i><i class="fill them" style="width:${(split[1] * 100).toFixed(1)}%"></i></span><b class="vs-them">${count(`vs-them-${label}`, b, kind)}</b><small class="vs-verdict">${verdict}</small></div>`;
}
function renderOverview() {
  const p = mine(), o = wingmate();
  if (!p) { $('#pilots').innerHTML = '<div class="empty">Choose your pilot to begin.</div>'; return; }
  const i = pilots.indexOf(p), s = summary(p), t = summary(o), ops = p.ops || {};
  const birthday = p.profile?.birthday, age = birthday ? Math.floor((Date.now() - Date.parse(birthday)) / 86400000) : null;
  const loc = ops.location?.value, ship = ops.ship?.value;
  const sharing = o && (o.private || wing.get(o.id)?.sharing);
  $('#pilots').innerHTML = `
  <section class="me-banner reveal">
    <div class="me-portrait">${portrait(p, 128, 'xl')}</div>
    <div class="me-info"><span class="title-chip">${esc(s.title || 'Unranked capsuleer')}</span><h1>${esc(p.name)}</h1><p class="hint">${p.corp ? `${esc(p.corp.name)} [${esc(p.corp.ticker)}]` : p.refreshing ? 'Loading…' : ''}${age === null ? '' : ` · capsuleer for ${age.toLocaleString()} days`}</p>${trainingAlert(p)}${p.error ? `<p class="error">${esc(p.error)}</p>` : ''}${connectButtons(p, i)}</div>
    <dl class="me-stats">${fact('Skill points', count('me-sp', s.sp))}${fact('Net worth', count('me-worth', s.worth, 'isk'))}</dl>
  </section>
  <div class="grid">
    <article class="card reveal" style="--i:1"><div class="card-head"><h3>You vs ${esc(o?.name || 'your wingmate')}</h3>${o ? portrait(o, 40, 'sm') : ''}</div>
      <div class="vs-legend"><span><i class="dot me"></i>${esc(p.name)}</span><span><i class="dot them"></i>${esc(o?.name || '—')}</span></div>
      ${o ? [['Skill points', s.sp, t.sp, ''], ['Skills at V', s.maxed, t.maxed, ''], ['Net worth', s.worth, t.worth, 'isk'], ['Wallet', s.wallet, t.wallet, 'isk'], ['Assets', s.assets, t.assets, 'isk'], ['Queue left', queueHours(p), queueHours(o), 'h']].map(([label, a, b, kind]) => vsRow(label, a, b, kind, o.name)).join('') : '<p class="hint">No wingmate configured.</p>'}
      ${o && !sharing ? `<p class="hint">${esc(o.name)}’s wallet, assets and skill sheet appear here once they reconnect and tick “share with my wingmate”.</p>` : ''}
      ${o ? `<p class="alert-line">${esc(o.name)} · ${esc(t.title || 'Unranked')} · ${trainingAlert(o).replace(/<\/?p[^>]*>/g, '')}</p>` : ''}</article>
    <article class="card reveal" style="--i:2"><h3>Ship &amp; position</h3><dl class="facts">
      ${fact('Location', loc ? `${esc(name(loc.solar_system_id))}<small>${loc.station_id ? esc(name(loc.station_id)) : loc.structure_id ? 'Docked in a structure' : 'In space'}</small>` : '—')}
      ${fact('Ship', ship ? `${esc(name(ship.ship_type_id))}<small>${esc(ship.ship_name || '')}</small>` : '—')}
      ${fact('Wallet', s.wallet !== undefined ? esc(isk(s.wallet)) : '—')}
      ${fact('Security status', Number.isFinite(p.profile?.security_status) ? p.profile.security_status.toFixed(2) : '—')}
    </dl>
    <details><summary>Corporation history</summary>${p.corp ? `<p class="hint">${Number(p.corp.member_count).toLocaleString()} members · ${(p.corp.tax_rate * 100).toFixed(1)}% tax</p>` : ''}${p.careerError ? `<p class="error">History unavailable: ${esc(p.careerError)}</p>` : ''}<ol class="career">${(p.career || []).map(item => `<li><b>${esc(item.name)}</b><span>Joined ${esc(new Date(item.start_date).toLocaleDateString())}</span></li>`).join('')}</ol></details>
    <p class="hint">${p.synced ? `EVE data from ${esc(when(p.synced))}` : backend ? 'Connect to share training and see private data.' : ''}</p></article>
  </div>`;
}
function stack(values) {
  const split = shares(values).shares;
  return `<span class="stack" aria-hidden="true">${split.map((v, i) => `<i class="fill ${i ? 'them' : 'me'}" style="width:${(v * 100).toFixed(2)}%"></i>`).join('')}</span>`;
}
function renderEmpire() {
  const ps = ordered(), sums = ps.map(summary);
  if (!ps.length) { $('#empire-content').innerHTML = '<div class="empty">No pilots configured.</div>'; return; }
  const worth = shares(sums.map(x => x.worth));
  const row = (label, values, kind) => `<div class="share-row"><span>${label}</span>${stack(values)}<b>${format(shares(values).total, kind)}</b></div>`;
  const cats = new Map();
  sums.forEach((x, i) => (x.holdings?.rows || []).slice(0, 60).forEach(r => {
    const c = assetCats.get(r.type) || 'Other';
    const v = cats.get(c) || ps.map(() => 0); v[i] += r.value; cats.set(c, v);
  }));
  const catRows = [...cats].map(([c, v]) => [c, v, v.reduce((a, b) => a + b, 0)]).filter(r => r[2] > 0).sort((a, b) => b[2] - a[2]).slice(0, 8);
  const maxCat = catRows[0]?.[2] || 1;
  const top = sums.flatMap((x, i) => (x.holdings?.rows || []).slice(0, 10).map(r => ({...r, owner:i}))).sort((a, b) => b.value - a.value).slice(0, 10);
  const missing = ps.filter((p, i) => sums[i].worth === undefined).map(p => p.name);
  $('#empire-content').innerHTML = `
  <section class="card empire-hero reveal">
    <div class="donut" style="--p:${(worth.shares[0] * 100).toFixed(1)}" role="img" aria-label="${esc(ps[0].name)} holds ${Math.round(worth.shares[0] * 100)}% of the empire"><div><b>${count('empire-share', worth.shares[0] * 100, 'pct')}</b><small>${esc(ps[0].name)}’s share</small></div></div>
    <div><p class="label">The empire we built</p><h1 class="empire-total">${count('empire-total', worth.total, 'isk')}</h1><p class="hint">Wallets plus assets valued at average market prices.</p>
    <div class="vs-legend">${ps.map((p, i) => `<span><i class="dot ${i ? 'them' : 'me'}"></i>${esc(p.name)} · ${format(sums[i].worth, 'isk')}</span>`).join('')}</div>
    ${missing.length ? `<p class="hint">Not counted yet: ${missing.map(esc).join(', ')}. Wallet and assets appear after connecting with the asset permission${missing.some(n => n !== me) ? ' and wingmate sharing' : ''}.</p>` : ''}</div>
  </section>
  <div class="grid">
    <article class="card reveal" style="--i:1"><h3>Who brings what</h3>${row('Net worth', sums.map(x => x.worth), 'isk')}${row('ISK', sums.map(x => x.wallet), 'isk')}${row('Assets', sums.map(x => x.assets), 'isk')}${row('Skill points', sums.map(x => x.sp), '')}${row('Skills at V', sums.map(x => x.maxed), '')}</article>
    <article class="card reveal" style="--i:2"><h3>Holdings by category</h3>${catRows.length ? catRows.map(([c, v, total]) => `<div class="share-row"><span>${esc(c)}</span><span class="stack" style="width:${(total / maxCat * 100).toFixed(1)}%">${v.map((x, i) => `<i class="fill ${i ? 'them' : 'me'}" style="width:${(x / total * 100).toFixed(2)}%"></i>`).join('')}</span><b>${format(total, 'isk')}</b></div>`).join('') : '<p class="hint">No valued assets yet.</p>'}</article>
  </div>
  <div class="grid">${ps.map((p, i) => {
    const roles = sums[i].skills?.skills ? pilotRoles(sums[i].skills, id => typeGroup.get(id)).filter(r => r.sp > 0) : [];
    return `<article class="card reveal title-card ${i ? 'them' : 'me'}" style="--i:${i + 3}"><div class="pilot-head">${portrait(p, 56)}<div><span class="title-chip">${esc(sums[i].title || 'Unranked')}</span><h2>${esc(p.name)}</h2></div></div>${roles.length ? roles.map(r => `<div class="share-row"><span>${esc(r.label)}</span><span class="stack"><i class="fill ${i ? 'them' : 'me'}" style="width:${(r.share * 100).toFixed(1)}%"></i></span><b>${Math.round(r.share * 100)}%</b></div>`).join('') : `<p class="hint">${esc(p.name)}’s skill sheet is private${i ? ' until they share it with you' : ' until you connect'}.</p>`}</article>`;
  }).join('')}</div>
  <article class="card reveal" style="--i:5"><h3>Most valuable holdings</h3>${top.length ? `<ol class="holdings">${top.map(r => `<li><span>${esc(name(r.type))}<small>×${Number(r.quantity).toLocaleString()} · ${esc(assetCats.get(r.type) || 'Other')}</small></span><span class="owner ${r.owner ? 'them' : 'me'}">${esc(ps[r.owner].name)}</span><b>${format(r.value, 'isk')}</b></li>`).join('')}</ol>` : '<p class="hint">Nothing valued yet.</p>'}</article>`;
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
function renderMe() {
  const p = mine();
  $('#switch-pilot').innerHTML = p ? `${portrait(p, 24, 'tiny')}<span>${esc(p.name)}</span><span aria-hidden="true">⇄</span>` : 'Choose pilot';
}
function renderHero() {
  $('#hero-pilots').innerHTML = pilots.map((p, i) => {
    const x = summary(p);
    return `<button class="hero-pilot" data-me="${esc(p.name)}" style="--i:${i}">${portrait(p, 160, 'hero-portrait')}<b>${esc(p.name)}</b><span class="title-chip">${esc(x.title || 'Capsuleer')}</span><small>${esc(p.corp?.name || '')}</small></button>`;
  }).join('');
}
function startStars() {
  cancelAnimationFrame(starsFrame);
  const canvas = $('#stars'), ctx = canvas.getContext('2d');
  const stars = Array.from({length:300}, () => ({x:Math.random() * 2 - 1, y:Math.random() * 2 - 1, z:Math.random()}));
  let speed = 0.002;
  const draw = () => {
    if (canvas.width !== innerWidth || canvas.height !== innerHeight) { canvas.width = innerWidth; canvas.height = innerHeight; }
    const w = canvas.width, h = canvas.height;
    speed += ((warp ? 0.05 : 0.002) - speed) * 0.06;
    ctx.fillStyle = warp ? 'rgba(8,13,20,0.3)' : '#080d14'; ctx.fillRect(0, 0, w, h);
    for (const star of stars) {
      star.z -= speed;
      if (star.z <= 0.02) Object.assign(star, {x:Math.random() * 2 - 1, y:Math.random() * 2 - 1, z:1});
      const k = 0.5 / star.z, x = w / 2 + star.x * w / 2 * k, y = h / 2 + star.y * h / 2 * k;
      if (x < 0 || x > w || y < 0 || y > h) { star.z = 0; continue; }
      ctx.fillStyle = star.z < 0.35 ? `rgba(185,238,141,${1 - star.z})` : `rgba(220,232,245,${1 - star.z})`;
      ctx.beginPath(); ctx.arc(x, y, (1 - star.z) * 2.2, 0, 7); ctx.fill();
    }
    if (!reduced && !$('#hero').hidden) starsFrame = requestAnimationFrame(draw);
  };
  draw();
}
function openHero() {
  warp = false; $('#hero').classList.remove('warp'); $('#hero').hidden = false;
  document.body.classList.add('picking'); renderHero(); startStars();
  $('#hero-pilots button')?.focus();
}
function choosePilot(pilot) {
  me = pilot;
  try { localStorage.setItem(ME, pilot); } catch { /* Choice lasts for this visit. */ }
  warp = true; $('#hero').classList.add('warp');
  setTimeout(() => { $('#hero').hidden = true; document.body.classList.remove('picking'); cancelAnimationFrame(starsFrame); }, reduced ? 0 : 900);
  counters.clear(); selectTab('overview'); renderAll();
}
async function routeJumps(pairs) {
  const todo = pairs.filter(key => !routes.has(key));
  let next = 0;
  await Promise.all(Array.from({length:8}, async () => {
    while (next < todo.length) {
      const key = todo[next++], [a, b] = key.split('-');
      if (a === b) { routes.set(key, 0); continue; }
      try { routes.set(key, (await esi(`route/${a}/${b}/`)).length - 1); } catch { routes.set(key, null); }
    }
  }));
}
async function loadMarket() {
  if (!marketData) { marketData = await backend.market(); marketBook = book(marketData.regions); }
  await loadPrices();
  if (!costIndices) {
    try { costIndices = new Map((await esi('industry/systems/')).map(row => [row.solar_system_id, Object.fromEntries(row.cost_indices.map(c => [c.activity, c.cost_index]))])); }
    catch { costIndices = new Map(); }
  }
}
// The pilot's own system first, then the trade hubs.
function systemOptions(select) {
  const p = mine(), here = p?.ops?.location?.value?.solar_system_id, prior = Number(select.value);
  const options = [...(here ? [[here, `${name(here)} · ${p.name}’s location`]] : []), ...HUB_SYSTEMS.filter(([id]) => id !== here)];
  select.innerHTML = options.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('');
  select.value = options.some(([id]) => id === prior) ? prior : options[0][0];
  return options;
}
async function renderMarket() {
  const status = $('#market-status'), content = $('#market-content');
  if (!backend) { status.textContent = 'Market analysis needs the backend.'; return; }
  const run = ++marketRun;
  try {
    if (!marketData) content.innerHTML = '<div class="card shimmer">Scanning stations…</div>';
    await loadMarket();
  } catch (error) { status.textContent = `Market data unavailable: ${error.message}`; content.innerHTML = ''; return; }
  if (run !== marketRun) return;
  if (!marketData.regions.length) { status.textContent = 'The hourly market pipeline has not stored any data yet. Check back after its next run.'; content.innerHTML = ''; return; }
  const p = mine(), meta = marketData.meta?.data || {types:{}};
  const origin = $('#market-origin');
  systemOptions(origin);
  const ship = p?.ops?.ship?.value?.ship_type_id, cargoInput = $('#market-cargo');
  if (ship && !cargoInput.dataset.touched) {
    if (!cargo.has(ship)) { try { cargo.set(ship, (await esi(`universe/types/${ship}/`)).capacity || 0); } catch { cargo.set(ship, 0); } }
    if (cargo.get(ship) > 0) cargoInput.value = Math.round(cargo.get(ship));
  }
  const skills = summary(p).skills, f = fees(skills, meta.skills);
  const from = Number(origin.value), maxJumps = Number($('#market-jumps').value), hold = Math.max(1, Number(cargoInput.value) || 5000);
  const updated = Math.min(...marketData.regions.map(r => r.updatedAt));
  status.textContent = `${marketData.regions.length} regions · ${Object.keys(meta.types).length} items · scanned ${Math.max(1, Math.round((Date.now() - updated) / 60000))} min ago by the hourly pipeline`;
  $('#market-fees').textContent = `Sales tax ${(f.salesTax * 100).toFixed(2)}% · broker fee ${(f.brokerFee * 100).toFixed(2)}% · ${skills?.skills ? `from ${p.name}’s skills` : 'base rates (connect for your skills)'} · cargo ${hold.toLocaleString()} m³`;
  const sys = loc => marketBook.stations.get(loc)?.system, station = loc => marketBook.stations.get(loc)?.name || `Station ${loc}`;
  const item = id => meta.types[id]?.n || name(id);
  const haulList = hauls(marketBook, {salesTax:f.salesTax, cargo:hold, volumeOf:id => meta.types[id]?.v, limit:40});
  const trades = stationTrades(marketBook, {...f, limit:60});
  const index = costIndices.get(from)?.manufacturing || 0;
  const builds = manufacturing(marketBook, meta.recipes, {...f, adjusted, costIndex:index}).slice(0, 12);
  content.innerHTML = '<div class="card shimmer">Plotting routes from your position…</div>';
  await routeJumps([...new Set([...haulList.flatMap(h => [`${from}-${sys(h.from.loc)}`, `${sys(h.from.loc)}-${sys(h.to.loc)}`]), ...trades.map(t => `${from}-${sys(t.loc)}`), ...builds.map(b => `${from}-${sys(b.loc)}`)])]);
  if (run !== marketRun) return;
  const jumps = (a, b) => routes.get(`${a}-${b}`);
  const near = j => j !== null && j !== undefined && j <= maxJumps;
  const haulRows = haulList.map(h => ({...h, toA:jumps(from, sys(h.from.loc)), ab:jumps(sys(h.from.loc), sys(h.to.loc))}))
    .filter(h => near(h.toA) && h.ab !== null).map(h => ({...h, perJump:h.profit / Math.max(1, h.toA + h.ab)})).sort((a, b) => b.perJump - a.perJump).slice(0, 12);
  const tradeRows = trades.map(t => ({...t, j:jumps(from, sys(t.loc))})).filter(t => near(t.j)).slice(0, 12);
  const buildRows = builds.map(b => ({...b, j:jumps(from, sys(b.loc))}));
  const jumpTag = j => `<em>${j === 0 ? 'here' : `${j} j`}</em>`;
  const empty = text => `<p class="hint">${text}</p>`;
  content.innerHTML = `
  <article class="card reveal" style="--i:1"><div class="card-head"><div><h3>Haul &amp; flip</h3><p class="hint">Buy from a sell order, fly, sell into a buy order. Ranked by profit per jump.</p></div></div>
   ${haulRows.length ? `<ol class="opps">${haulRows.map((h, n) => `<li class="opp reveal" style="--i:${n}"><div class="opp-main"><b>${esc(item(h.type))}</b><small>${h.units.toLocaleString()} units · ${Math.round(h.m3).toLocaleString()} m³ · invest ${format(h.invest, 'isk')}</small></div><div class="opp-route"><span>Buy ${format(h.from.price, 'isk')} · ${esc(station(h.from.loc))} ${jumpTag(h.toA)}</span><span>Sell ${format(h.to.price, 'isk')} · ${esc(station(h.to.loc))} <em>+${h.ab} j</em></span></div><div class="opp-profit"><b class="pos">+${format(h.profit, 'isk')}</b><small>${format(h.perJump, 'isk')} / jump</small></div></li>`).join('')}</ol>` : empty(`No profitable hauls within ${maxJumps} jumps for this cargo size.`)}
  </article>
  <article class="card reveal" style="--i:2"><div class="card-head"><div><h3>Station trading near you</h3><p class="hint">Place a buy order at the top bid and relist at the lowest ask. Estimate assumes you capture 5% of daily volume.</p></div></div>
   ${tradeRows.length ? `<ol class="opps">${tradeRows.map((t, n) => `<li class="opp reveal" style="--i:${n}"><div class="opp-main"><b>${esc(item(t.type))}</b><small>${esc(station(t.loc))} ${jumpTag(t.j)}</small></div><div class="opp-route"><span>Bid ${format(t.buy, 'isk')} → ask ${format(t.sell, 'isk')}</span><span>${Math.round(t.volume).toLocaleString()} traded per day</span></div><div class="opp-profit"><b class="pos">${(t.margin * 100).toFixed(1)}%</b><small>~${format(t.daily, 'isk')} / day</small></div></li>`).join('')}</ol>` : empty(`No station spreads beat fees within ${maxJumps} jumps.`)}
  </article>
  <article class="card reveal" style="--i:3"><div class="card-head"><div><h3>Manufacturing</h3><p class="hint">One run with an ME 0 blueprint you own: materials at the cheapest scanned ask, product listed at the best ask, job cost at ${(index * 100).toFixed(2)}% system index + fees.</p></div></div>
   ${meta.recipesError ? empty(esc(meta.recipesError)) : buildRows.length ? `<ol class="opps">${buildRows.map((b, n) => `<li class="opp reveal" style="--i:${n}"><div class="opp-main"><b>${esc(item(b.type))}</b><small>sells at ${esc(station(b.loc))} ${b.j === undefined || b.j === null ? '' : jumpTag(b.j)} · ${Math.round(b.daily).toLocaleString()}/day</small></div><div class="opp-route"><span>Materials ${format(b.materials, 'isk')} · job ${format(b.job, 'isk')}</span><span>Revenue ${format(b.revenue, 'isk')}</span></div><div class="opp-profit"><b class="${b.profit > 0 ? 'pos' : 'neg'}">${b.profit > 0 ? '+' : ''}${format(b.profit, 'isk')}</b><small>${(b.margin * 100).toFixed(1)}% margin</small></div></li>`).join('')}</ol>` : empty('No manufacturing data yet.')}
  </article>`;
}
let graphCache = null;
const universeGraph = () => {
  const src = marketData?.universe;
  if (!src) return null;
  if (graphCache?.src !== src) graphCache = {src, g:graph(src)};
  return graphCache.g;
};
const hop = s => `<li class="sec-${secClass(s.sec)}" title="${esc(s.name)} · security ${secShown(s.sec).toFixed(1)}"><span>${secShown(s.sec).toFixed(1)}</span>${esc(s.name)}</li>`;
function legHtml(title, place, route, extra = '') {
  if (!route) return `<div class="leg"><div class="leg-head"><b>${title}</b><span>${esc(place || '')}</span><small>No gate route found from here.</small></div></div>`;
  const names = route.systems.map(s => s.name);
  return `<div class="leg"><div class="leg-head"><b>${title}</b><span>${esc(place)}</span><small>${route.jumps ? `${route.jumps} ${route.jumps === 1 ? 'jump' : 'jumps'}` : 'same system'}${route.risky ? ` · <span class="neg">${route.risky} low-sec</span>` : ''}${extra}</small><a href="${route.jumps ? dotlanRoute(names) : dotlanSystem(names[0])}" target="_blank" rel="noopener noreferrer">Map ↗</a></div>${route.jumps ? `<ol class="hops">${route.systems.map(hop).join('')}</ol>` : ''}</div>`;
}
async function renderIndustry() {
  const status = $('#industry-status'), content = $('#industry-content');
  if (!backend) { status.textContent = 'Industry planning needs the backend.'; return; }
  const run = ++industryRun;
  try {
    if (!marketData) content.innerHTML = '<div class="card shimmer">Pricing starter blueprints…</div>';
    await loadMarket();
  } catch (error) { status.textContent = `Market data unavailable: ${error.message}`; content.innerHTML = ''; return; }
  if (run !== industryRun) return;
  const meta = marketData.meta?.data || {}, catalog = meta.starters || [];
  if (!marketData.regions.length || !catalog.length) { status.textContent = 'The pipeline has not priced starter blueprints yet. Check back after its next hourly run.'; content.innerHTML = ''; return; }
  const p = mine(), o = wingmate(), x = summary(p), levels = skillLevels(x.skills, meta.skills || {}), alpha = isAlpha(x.skills), f = fees(x.skills, meta.skills), s = slots(levels);
  const options = systemOptions($('#industry-system')), system = Number($('#industry-system').value), idx = costIndices.get(system) || {};
  const budgetInput = $('#industry-budget');
  if (!budgetInput.dataset.touched && x.wallet !== undefined) budgetInput.value = Math.floor(x.wallet);
  const budget = budgetInput.value === '' ? undefined : Number(budgetInput.value);
  // Plan around the cheapest safe NPC factory and lab near the starting system.
  const g = universeGraph(), cache = new Map(), here = g?.systems.get(system);
  const factories = g ? facilities(g, system, 1, id => costIndices.get(id)?.manufacturing) : [];
  const labs = g ? facilities(g, system, 2, id => costIndices.get(id)?.researching_material_efficiency) : [];
  const factory = factories[0], lab = labs[0];
  const buildIndex = factory?.index ?? idx.manufacturing ?? 0, researchIndex = lab?.index ?? idx.researching_material_efficiency ?? 0;
  const at = loc => { const st = marketBook.stations.get(loc); return {loc, system:st?.system, name:st?.name || `Station ${loc}`}; };
  // Where each blueprint is really sold by NPCs (365-day orders), nearest by safe route.
  const sellerNames = meta.bpoSurvey?.names || {};
  const sellerOf = pick => g ? nearest(g, system, (pick.sellers || []).map(([loc, sys, price]) => ({loc, system:sys, price, name:sellerNames[loc] || at(loc).name})), cache) : null;
  const category = $('#industry-category'), sortBy = $('#industry-sort').value;
  const categories = [...new Set(catalog.map(item => item.cat))].sort();
  if (category.options.length !== categories.length + 1) { const prior = category.value; category.innerHTML = `<option value="">All categories</option>${categories.map(c => `<option>${esc(c)}</option>`).join('')}`; category.value = categories.includes(prior) ? prior : ''; }
  const skillOf = x.skills?.skills ? id => x.skills.skills.find(k => k.skill_id === id)?.active_skill_level || 0 : undefined;
  const ranked = rank(catalog.filter(item => !category.value || item.cat === category.value).map(item => evaluate(item, {book:marketBook, adjusted, fees:f, index:buildIndex, researchIndex, levels, alpha, skillOf})), budget)
    .map(pick => ({...pick, seller:sellerOf(pick)}));
  const SORTS = {profit:(a, b) => b.profitDay - a.profitDay, payback:(a, b) => a.payback - b.payback, margin:(a, b) => b.margin - a.margin, cheap:(a, b) => a.price - b.price,
    near:(a, b) => (a.seller?.route.jumps ?? 999) - (b.seller?.route.jumps ?? 999)};
  const picks = (SORTS[sortBy] ? [...ranked].sort((a, b) => (b.affordable - a.affordable) || SORTS[sortBy](a, b)) : ranked).slice(0, 20);
  const jobTax = buildIndex + NPC_FACILITY_TAX + SCC.manufacturing + (alpha ? ALPHA_TAX : 0);
  const trip = pick => {
    if (!g) return '<p class="hint">Routes appear after the next market pipeline run.</p>';
    const seller = pick.seller, start = seller?.place.system ?? system;
    const mats = at(pick.materialsAt), hub = at(pick.sell.loc);
    const legs = [seller ? legHtml('Buy the blueprint', seller.place.name, seller.route, ` · ${format(seller.place.price, 'isk')}`)
      : `<div class="leg"><div class="leg-head"><b>Buy the blueprint</b><span>No NPC seller reachable through high-sec</span><small>Search “${esc(pick.n)} Blueprint” on the in-game market.</small></div></div>`];
    if (lab) legs.push(legHtml(`Research to ME ${pick.me}`, lab.station.name, leg(g, start, lab.system.id, cache), ` · ME index ${pct(lab.index)}`));
    legs.push(legHtml('Buy materials', mats.name, leg(g, lab?.system.id ?? start, mats.system, cache), ` · whole bill in ${esc(pick.materialsRegion)}`));
    if (factory) legs.push(legHtml('Build', factory.station.name, leg(g, mats.system ?? start, factory.system.id, cache), ` · index ${pct(factory.index)}`));
    legs.push(legHtml('Sell', hub.name, leg(g, factory?.system.id ?? mats.system ?? start, hub.system, cache), ` · lowest ask ${format(pick.sell.price, 'isk')}`));
    const stops = [system, seller?.place.system, lab?.system.id, mats.system, factory?.system.id, hub.system].filter(Boolean).filter((id, i, a) => id !== a[i - 1]).map(id => g.systems.get(id)?.name).filter(Boolean);
    const bill = `<table class="bill"><caption>Materials for a ${pick.runs}-run batch at ME ${pick.me}, bought in ${esc(pick.materialsRegion)}</caption><thead><tr><th>Material</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${pick.bill.map(b => `<tr><td>${esc(meta.types[b.type]?.n || name(b.type))}<small>${esc(at(b.loc).name)}</small></td><td>${b.qty.toLocaleString()}</td><td>${format(b.price, 'isk')}</td><td>${format(b.qty * b.price, 'isk')}</td></tr>`).join('')}</tbody></table>`;
    return `${bill}<ol class="legs">${legs.map(l => `<li>${l}</li>`).join('')}</ol>${stops.length > 1 ? `<a class="trip-link" href="${dotlanRoute(stops)}" target="_blank" rel="noopener noreferrer">Open the whole trip on Dotlan ↗</a>` : ''}`;
  };
  const facilityList = (list, kind) => list.length ? `<ol class="facilities">${list.map((x, i) => `<li>${i ? '' : '<span class="tag">Best</span> '}<a href="${dotlanSystem(x.system.name)}" target="_blank" rel="noopener noreferrer">${esc(x.station.name)}</a><small><span class="sec sec-${secClass(x.system.sec)}">${secShown(x.system.sec).toFixed(1)}</span> ${esc(x.system.name)} · ${x.jumps ? `${x.jumps} ${x.jumps === 1 ? 'jump' : 'jumps'}` : 'here'} · ${kind} index ${pct(x.index)} · job tax ${pct(x.index + NPC_FACILITY_TAX + (kind === 'ME' ? SCC.research : SCC.manufacturing) + (alpha ? ALPHA_TAX : 0))}</small>${x.jumps ? `<details><summary>Route</summary>${legHtml('', x.station.name, leg(g, system, x.system.id, cache))}</details>` : ''}</li>`).join('')}</ol>` : '<p class="hint">No high-sec NPC station with this service within 10 jumps.</p>';
  const plan = stage(x.wallet), next = nextSkills(levels, alpha), known = Boolean(x.skills?.skills);
  // A starting plan per pilot: fill their build slots within their wallet, never the same product twice.
  const mePlan = portfolio(ranked, {slots:known ? s.build : 2, budget:budget ?? Infinity});
  const ox = o ? summary(o) : null, oLevels = ox ? skillLevels(ox.skills, meta.skills || {}) : null;
  const oSkillOf = ox?.skills?.skills ? id => ox.skills.skills.find(k => k.skill_id === id)?.active_skill_level || 0 : null;
  const themPlan = o ? portfolio(ranked.filter(pick => !mePlan.chosen.includes(pick) && !(oSkillOf && pick.sk?.some(([id, lvl]) => oSkillOf(id) < lvl))).map(pick => ({...pick, flags:pick.flags.filter(fl => fl !== 'skills'), affordable:!(ox.wallet >= 0) || pick.invest <= ox.wallet})),
    {slots:ox.skills?.skills ? slots(oLevels).build : 2, budget:ox.wallet ?? Infinity}) : null;
  const owner = pick => mePlan.chosen.includes(pick) ? p : themPlan?.chosen.some(c => c.bp === pick.bp) ? o : null;
  const skillName = id => meta.skillNames?.[id] || name(id);
  const FLAGS = {thin:['Thin market', 'Under 10 sold per day at the hub'], spike:['Price spike', 'Hub ask is well above its 7-day average; priced at the average +15%'], crowded:['Crowded', '10+ stations already list it'],
    skills:['Needs skills', 'You can’t start this job yet'], slow:['Slow seller', 'The market takes under one a day'], margin:['Thin margin', 'Under 10% after fees; a small undercut wipes it out']};
  const flagTags = pick => pick.flags.filter(fl => FLAGS[fl] && fl !== 'skills' && fl !== 'spike').map(fl => `<span class="tag flag" title="${esc(FLAGS[fl][1])}">${esc(FLAGS[fl][0])}</span>`).join('');
  const planCard = (who, plan, wallet, free) => `<div class="plan"><h4>${esc(who.name)}</h4>${plan.chosen.length ? `<ol class="plain">${plan.chosen.map(c => `<li><b>${esc(c.n)}</b><small>${format(c.invest, 'isk')} to start · +${format(c.profitDay, 'isk')}/day · pays back in ${c.payback < 1 ? 'under a day' : `${c.payback.toFixed(1)} days`}</small></li>`).join('')}</ol>
    <dl class="facts">${fact('Start-up', format(plan.spent, 'isk'))}${fact('Profit / day', `+${format(plan.profitDay, 'isk')}`)}${fact('Slots used', `${plan.chosen.length} of ${free}`)}${fact('Left in wallet', wallet === undefined ? '—' : format(wallet - plan.spent, 'isk'))}</dl>` : `<p class="hint">Nothing fits ${wallet === undefined ? 'yet' : `a ${format(wallet, 'isk')} wallet`} with today’s prices.</p>`}</div>`;
  const pct = v => `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;
  const days = sec => sec >= 86400 ? `${(sec / 86400).toFixed(1)} d` : `${Math.max(1, Math.round(sec / 3600))} h`;
  status.textContent = `${catalog.length} cheap T1 blueprints that NPCs sell${meta.bpoSurvey ? ` (seller survey covers ${meta.bpoSurvey.regions}${meta.bpoSurvey.of > meta.bpoSurvey.regions ? ` of ${meta.bpoSurvey.of}` : ''} high-sec regions)` : ''}, priced from live orders · scanned ${Math.max(1, Math.round((Date.now() - Math.min(...marketData.regions.map(r => r.updatedAt))) / 60000))} min ago`;
  content.innerHTML = `
  <div class="grid">
    <article class="card reveal" style="--i:1"><h3>Your industry setup</h3>
      <dl class="facts">${fact('Clone', known ? (alpha ? 'Alpha<small>4 build · 1 research slot max</small>' : 'Omega') : '—')}${fact('Build slots', known ? s.build : '—')}${fact('Research slots', known ? s.science : '—')}${fact('Job tax', `${pct(jobTax)}<small>${factory ? `at ${esc(factory.system.name)}: ` : ''}index ${pct(buildIndex)} + facility + SCC${alpha ? ' + alpha' : ''}</small>`)}${fact('Selling fees', `${pct(f.salesTax + f.brokerFee)}<small>sales ${pct(f.salesTax)} · broker ${pct(f.brokerFee)}</small>`)}${fact('Budget', format(budget, 'isk'))}</dl>
      ${known ? '' : `<p class="hint">Connect ${esc(p?.name || 'your pilot')} to plan with real skills, slots and wallet.</p>`}
      ${factory && factory.system.id !== system && factory.index < (idx.manufacturing ?? Infinity) * 0.8 ? `<p class="alert warn">Building in ${esc(factory.system.name)} (${factory.jumps} jumps) is cheaper: ${pct(factory.index)} index vs ${pct(idx.manufacturing || 0)} here.</p>` : ''}
    </article>
    <article class="card reveal" style="--i:2"><h3>${esc(plan.name)}</h3>
      <div class="progress-row"><span class="stack"><i class="fill me" style="width:${Math.min(100, (x.wallet || 0) / plan.goal * 100).toFixed(1)}%"></i></span><small>${format(x.wallet, 'isk')} of ${format(plan.goal, 'isk')}</small></div>
      <ol class="steps">${plan.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
      <h3>Train next</h3>${next.length ? `<ul class="plain">${next.map(k => `<li><b>${esc(SKILL_LABELS[k.key])} ${ROMAN[k.level]}</b>${k.omega ? ' <span class="tag">Omega</span>' : ''}<small>${k.from ? `from ${ROMAN[k.from]} · ` : ''}${esc(k.why)}</small></li>`).join('')}</ul>` : `<p class="hint">${alpha ? 'You have every industry skill an Alpha can train. Omega unlocks more slots and lower taxes.' : 'Core industry skills are done. Look at invention next.'}</p>`}
    </article>
  </div>
  <article class="card reveal" style="--i:3"><h3>Where to build and research near ${esc(here?.name || 'you')}</h3>
    <p class="hint">NPC stations in high-sec (0.5+), reachable without entering low-sec, within 10 jumps. A lower system index means cheaper jobs; NPC stations add a fixed ${pct(NPC_FACILITY_TAX)} facility tax.</p>
    ${g ? `<div class="grid"><div><h4>Manufacturing</h4>${facilityList(factories, 'build')}</div><div><h4>Research (ME)</h4>${facilityList(labs, 'ME')}</div></div>` : '<p class="hint">The station map appears after the next market pipeline run.</p>'}
  </article>
  <article class="card reveal" style="--i:4"><div class="card-head"><div><h3>Your starting plan</h3><p class="hint">The best picks that fit each pilot’s build slots and wallet, skipping anything they can’t build yet${o ? ', with no product shared between you' : ''}.</p></div></div>
    <div class="grid">${planCard(p, mePlan, budget, known ? s.build : 2)}${o ? planCard(o, themPlan, ox.wallet, ox.skills?.skills ? slots(oLevels).build : 2) : ''}</div>
  </article>
  <article class="card reveal" style="--i:4"><div class="card-head"><div><h3>Best blueprints to start with</h3><p class="hint">NPC-sold originals, researched to the suggested ME, built in batches and sold at the lowest ask. Only blueprints an NPC actually sells. Sale prices are capped at 15% over the 7-day average, materials are bought in one region, and thin, spiking or crowded markets rank lower.</p></div></div>
    ${picks.length ? `<ol class="opps bpos">${picks.map((pick, n) => `<li class="opp reveal ${pick.affordable ? '' : 'over'}" style="--i:${n}">
      <div class="opp-main"><b>${esc(pick.n)}</b><small><span class="tag">${esc(pick.cat)}</span> BPO ${format(pick.seller?.place.price ?? pick.price, 'isk')} · rank ${pick.rank}</small><small>${pick.seller ? `NPC sells it at ${pick.sellers.length} ${pick.sellers.length === 1 ? 'station' : 'stations'} · nearest ${pick.seller.route.jumps ? `${pick.seller.route.jumps} ${pick.seller.route.jumps === 1 ? 'jump' : 'jumps'}` : 'here'}` : `<span class="neg">No NPC seller reachable through high-sec</span>`}</small>${pick.missing?.length ? `<small class="neg">Needs ${pick.missing.map(([id, lvl]) => `${esc(skillName(id))} ${ROMAN[lvl]}`).join(', ')}</small>` : ''}${owner(pick) ? `<small class="who ${owner(pick) === p ? 'me' : 'them'}">In ${esc(owner(pick).name)}’s plan</small>` : pick.affordable ? '' : '<small class="neg">Over budget</small>'}${flagTags(pick) ? `<small class="flags">${flagTags(pick)}</small>` : ''}</div>
      <div class="opp-route"><span>Research ME 0 → ${pick.me} · ${days(pick.research.seconds)} · ${format(pick.research.cost, 'isk')}</span><span>Sell ${pick.unitsPerDay >= 1 ? `${Math.round(pick.unitsPerDay).toLocaleString()}/day` : `1 every ${Math.round(1 / pick.unitsPerDay)} days`} at ${format(pick.sellPrice, 'isk')} · margin ${pct(pick.margin)} <em>ME 0: ${pick.profitAtZero > 0 ? '+' : ''}${format(pick.profitAtZero, 'isk')}/unit</em></span><span>Start with ${format(pick.invest, 'isk')} (blueprint, research, ${pick.runs}-run batch) · ${Math.round(pick.daily).toLocaleString()} traded/day at the hub · ${pick.listings} ${pick.listings === 1 ? 'station' : 'stations'} competing</span>${pick.trend === null ? '' : `<span class="${pick.trend > 0.15 ? 'neg' : pick.trend < -0.1 ? 'warn-text' : ''}">Hub price ${pick.trend >= 0 ? '+' : ''}${(pick.trend * 100).toFixed(0)}% vs 7-day average${pick.trend > 0.15 ? ' · likely a spike, expect it to fall' : pick.trend < -0.1 ? ' · below normal, may recover' : ''}</span>`}</div>
      <div class="opp-profit"><b class="pos">+${format(pick.profitDay, 'isk')}/day</b><small>pays back in ${pick.payback < 1 ? 'under a day' : `${pick.payback.toFixed(1)} days`}</small></div>
      <details class="trip"><summary>Plan the trip</summary>${trip(pick)}</details></li>`).join('')}</ol>` : '<p class="hint">No starter blueprint turns a profit at today’s prices with these fees. Try another system or check after the next hourly scan.</p>'}
  </article>
  <article class="card reveal" style="--i:5"><h3>Avoid these traps</h3><ul class="plain traps">
    <li><b>Price your own ore at market value.</b><small>Minerals you mine could be sold; if a build earns less than selling them, sell them.</small></li>
    <li><b>Margins under ~${Math.round((f.salesTax + f.brokerFee) * 100 + 2)}% are losses for you.</b><small>Sales tax and broker fee alone take ${pct(f.salesTax + f.brokerFee)}; relisting adds more. Accounting and Broker Relations cut both.</small></li>
    <li><b>Batch your runs.</b><small>ME rounds up per job, so a 1-run job wastes materials that a 100-run job saves.</small></li>
    <li><b>Never leave a slot idle.</b><small>Research the next blueprint while the current one builds${s.science > 1 ? `; you have ${s.science} research slots` : ''}.</small></li>
    <li><b>Buy BPOs from the NPC market.</b><small>Unresearched T1 originals are always on the market at the NPC price; don’t overpay on contracts.</small></li>
    ${alpha ? `<li><b>Alpha tax.</b><small>Alphas pay an extra industry tax (CCP lists 2%; this page assumes it). Omega on the main builder removes it.</small></li>` : ''}
  </ul><p class="hint">Assumes SCC surcharge ${pct(SCC.manufacturing)} on builds and ${pct(SCC.research)} on research, and ${pct(NPC_FACILITY_TAX)} NPC facility tax. Confirm against the in-game job window.</p></article>`;
}
function renderAll() {
  renderStatus(); renderMe(); renderOverview(); renderEmpire(); renderTraining(); renderSkills(); renderWallet(); renderClones(); pilotOptions();
  if (!$('#hero').hidden) renderHero();
  if (!$('#market').hidden) renderMarket();
  if (!$('#industry').hidden) renderIndustry();
  countUps();
}

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
  document.querySelectorAll(`#${id} [data-count]`).forEach(el => counters.delete(el.dataset.key));
  countUps();
  if (id === 'market') renderMarket();
  if (id === 'industry') renderIndustry();
}
// The wing summary also carries the pilot's own figures, so drop it with their session.
function forgetWing(id) {
  wing.delete(id);
  if (!pilots.some(p => p.id && backend?.has(p.id))) wing = new Map();
}
function clearPrivate(p) {
  forgetWing(p.id);
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

$('#refresh').onclick = () => { marketData = null; costIndices = null; loadPilots(true); };
$('#market-origin').onchange = $('#market-jumps').onchange = () => renderMarket();
$('#market-cargo').onchange = event => { event.target.dataset.touched = '1'; renderMarket(); };
$('#industry-system').onchange = $('#industry-category').onchange = $('#industry-sort').onchange = () => renderIndustry();
$('#industry-budget').onchange = event => { event.target.dataset.touched = '1'; renderIndustry(); };
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#hero').hidden && me) choosePilot(me); });
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
    if (b.dataset.me) choosePilot(b.dataset.me);
    if (b.id === 'switch-pilot') openHero();
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
  try { me = localStorage.getItem(ME); } catch { /* Ask again. */ }
  if (!config.pilots.includes(me)) { me = null; openHero(); }
  renderMe();
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
