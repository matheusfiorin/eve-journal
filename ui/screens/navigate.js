// Navigate: the Star map (ui/screens/starmap.js) and the risk-weighted Haul plan.
import {HULLS, MODES, suggestHull, campIntel, plan} from '../../hauling.js';
import {secLight} from '../../mapview.js';
import {secClass, dotlanRoute} from '../../route.js';
import {S, mine} from '../state.js';
import {esi, json, name, resolveNames} from '../esi.js';
import {$, esc, format, plural, mapButton, routeAttrs, tabReady, go} from '../shared.js';
import {mapGraph, fillSystemList, sendable, autopilotButton} from '../routes.js';
import {markup as mapMarkup, renderMap, wire as wireMap} from './starmap.js';
export {renderMap};

export const markup = {
  map:mapMarkup,
  hauling:`<form id="haul-form" class="card market-controls">
  <div class="card-head"><div><h2>Haul plan</h2><p id="haul-status" class="hint">Add stops to plan a route.</p></div></div>
  <div id="haul-stops" class="stops"></div>
  <div class="actions"><button type="button" id="haul-add" class="secondary small">+ Add stop</button></div>
  <div class="row">
   <label>Cargo value (ISK)<input id="haul-value" type="number" min="0" step="1000000" value="100000000"></label>
   <label>Cargo volume (m³)<input id="haul-volume" type="number" min="0" step="100" value="5000"></label>
   <label>Ship<select id="haul-hull"><option value="">Suggest from cargo</option><option value="br">Blockade runner</option><option value="t1">T1 industrial</option><option value="dst">Deep space transport</option><option value="freighter">Freighter</option></select></label>
  </div>
  <div class="row">
   <label>Avoid systems<input id="haul-avoid" placeholder="Uedama, Sivala"></label>
   <label>Stop order<select id="haul-end"><option value="fixed">Keep the last stop last</option><option value="free">Any order</option><option value="return">Return to start</option></select></label>
  </div>
  <div class="row">
   <label class="check"><input id="haul-optimize" type="checkbox"> Find the best stop order</label>
   <label class="check"><input id="haul-lowsec" type="checkbox"> Allow low-sec</label>
   <button id="haul-plan">Plan route</button>
  </div>
 </form>
 <div id="haul-content"></div>`
};

// ── Haul plan: risk-weighted routes through any number of stops, using live zKillboard kills along the way. ──
const HAUL_KEY = 'eve-haul:v1';
const killCache = new Map(), gateCache = new Map();
let haulMode = 'balanced', haulPlans = null;
function haulSaved() { try { return JSON.parse(localStorage.getItem(HAUL_KEY)) || {}; } catch { return {}; } }
function haulSave(state) { try { localStorage.setItem(HAUL_KEY, JSON.stringify(state)); } catch { /* Not remembered in this browser. */ } }
function haulRow(value = '') {
  const row = document.createElement('div');
  row.className = 'stop-row';
  row.innerHTML = `<span class="stop-n"></span><input list="systems" aria-label="Stop" placeholder="System name" value="${esc(value)}"><button type="button" class="secondary small" data-move="-1" aria-label="Move up">↑</button><button type="button" class="secondary small" data-move="1" aria-label="Move down">↓</button><button type="button" class="secondary small" data-remove aria-label="Remove stop">✕</button>`;
  return row;
}
function haulNumber() { document.querySelectorAll('#haul-stops .stop-n').forEach((el, i, all) => { el.textContent = i ? (i === all.length - 1 ? 'To' : `${i}`) : 'From'; }); }
// The last hour of non-NPC kills in each region, straight from zKillboard (cached 5 minutes per region).
async function regionKills(region) {
  const hit = killCache.get(region);
  if (hit && Date.now() - hit.at < 300000) return hit.kills;
  const kills = await json(`https://zkillboard.com/api/regionID/${region}/pastSeconds/3600/`, {headers:{Accept:'application/json'}});
  killCache.set(region, {at:Date.now(), kills:Array.isArray(kills) ? kills : []});
  return killCache.get(region).kills;
}
async function gateTargets(ids) {
  await Promise.all([...new Set(ids)].filter(id => !gateCache.has(id)).slice(0, 60).map(async id => {
    try { gateCache.set(id, (await esi(`universe/stargates/${id}/`)).destination?.system_id); } catch { gateCache.set(id, undefined); }
  }));
  return new Map([...gateCache].filter(([, to]) => to));
}
// Always plans with live camps: regionKills caches each region for 5 minutes, so re-renders cost nothing.
export async function renderHauling() {
  const t = await tabReady('haul', 'Loading the gate map…', 'Hauling');
  if (!t) return;
  const {status, content, stale} = t, g = mapGraph(), meta = S.marketData.meta?.data || {};
  if (!g) { status.textContent = 'The gate map appears after the next pipeline run.'; content.innerHTML = ''; return; }
  const byName = new Map([...g.systems.values()].map(s => [s.name.toLowerCase(), s.id]));
  fillSystemList(g);
  const rows = ensureRows();
  const names = [...rows.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
  const unknown = names.filter(n => !byName.has(n.toLowerCase()));
  const stops = names.map(n => byName.get(n.toLowerCase())).filter(Boolean);
  const avoidNames = $('#haul-avoid').value.split(',').map(x => x.trim()).filter(Boolean);
  const avoid = new Set(avoidNames.map(n => byName.get(n.toLowerCase())).filter(Boolean));
  const value = Math.max(0, Number($('#haul-value').value) || 0), volume = Math.max(0, Number($('#haul-volume').value) || 0);
  const hull = $('#haul-hull').value || suggestHull(volume, value);
  haulSave({stops:names, value:$('#haul-value').value, volume:$('#haul-volume').value, avoid:$('#haul-avoid').value});
  if (unknown.length || stops.length < 2) {
    status.textContent = unknown.length ? `Unknown system: ${unknown.join(', ')}` : 'Add at least two stops.';
    content.innerHTML = ''; return;
  }
  const traffic = Object.fromEntries(Object.entries(meta.activity || {}).map(([id, a]) => [id, a[2]]));
  const options = {lowsec:$('#haul-lowsec').checked, avoid, optimize:$('#haul-optimize').checked, end:$('#haul-end').value};
  let liveIntel = new Map(), liveNote = 'Loading live gate kills…';
  const planAll = () => Object.fromEntries(Object.keys(MODES).map(mode => [mode, plan(g, stops, {history:meta.risk?.s || {}, traffic, live:liveIntel, value, hull, now:Date.now()}, {...options, mode})]));
  haulPlans = planAll();
  const draw = () => {
    if (stale()) return;
    const plans = haulPlans, chosen = plans[haulMode];
    const days = meta.risk?.since ? Math.max(1, Math.round((Date.now() - meta.risk.since) / 86400000)) : 0;
    status.textContent = `${liveNote} Kill history: ${days ? `${plural(days, 'day')} of hourly ESI data` : 'starting'} · traffic from the last hour.`;
    if (chosen.unreachable) { content.innerHTML = `<article class="card"><p class="alert warn">No route from ${esc(g.systems.get(chosen.unreachable[0]).name)} to ${esc(g.systems.get(chosen.unreachable[1]).name)} with these settings.${options.lowsec ? '' : ' Allow low-sec, or drop an avoided system.'}</p></article>`; return; }
    const risk = p => p >= 0.1 ? `${(p * 100).toFixed(0)}%` : p >= 0.001 ? `${(p * 100).toFixed(1)}%` : '<0.1%';
    const level = p => p >= 0.05 ? 'danger' : p >= 0.01 ? 'warn' : 'ok';
    const same = mode => Object.keys(MODES).find(m => m !== mode && Object.keys(MODES).indexOf(m) < Object.keys(MODES).indexOf(mode) && plans[m].route?.join() === plans[mode].route?.join());
    const modeCard = mode => { const pl = plans[mode]; return `<button type="button" class="mode ${mode === haulMode ? 'on' : ''}" data-mode="${mode}" aria-pressed="${mode === haulMode}">
      <b>${MODES[mode].label}</b>${pl.unreachable ? '<small>No route</small>' : `<span class="mode-big num">${plural(pl.jumps, 'jump')}</span><small>${risk(1 - pl.survival)} risk · ${format(pl.expectedLoss, 'isk')} expected loss</small><small>~${Math.round(pl.minutes)} min${pl.lowsec ? ' · <span class="neg">low-sec</span>' : ''}${same(mode) ? ` · same as ${MODES[same(mode)].label}` : ''}</small>`}</button>`; };
    const shipNames = s => Object.entries(s.ships || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => esc(name(Number(id)))).join(', ');
    const step = (st, i) => {
      const c = liveIntel.get(st.system.id), gk = c ? Object.entries(c.gates).filter(([to]) => to === '?' || st.via.includes(Number(to))).reduce((t, [, x]) => t + x.n, 0) : 0;
      const [d24 = 0] = meta.risk?.s?.[st.system.id] || [];
      const ago = c?.last ? Math.max(1, Math.round((Date.now() - c.last) / 60000)) : null;
      return `<li class="hop-row ${level(st.p)}" style="--i:${Math.min(i, 30)}">
        <button type="button" class="light-btn" data-system="${st.system.id}" aria-label="${esc(st.system.name)} on the map">${secLight(st.system.sec)}</button>
        <div><b><a href="https://zkillboard.com/system/${st.system.id}/" target="_blank" rel="noopener noreferrer">${esc(st.system.name)}</a></b>${st.stop ? ' <span class="tag">Stop</span>' : ''}
          <small>${c ? `<span class="gk gk-${gk ? (gk >= 3 ? 'hi' : 'lo') : 'none'}">${gk} on your gates</span> · ${plural(c.kills, 'kill')} last hour${ago ? `, latest ${ago} min ago` : ''}` : 'No kills in the last hour'}${c?.sb ? ' · <span class="tag flag">Smartbombs</span>' : ''}${c?.dictor ? ` · <span class="tag flag">${secClass(st.system.sec) === 'hi' ? 'Interdictors' : 'Bubbles'}</span>` : ''}${c && shipNames(c) ? ` · ${shipNames(c)}` : ''}</small>
          <small>${Math.round(d24)} ship kills over ~24 h · ${(traffic[st.system.id] || 0).toLocaleString()} jumps/h</small></div>
        <span class="risk ${level(st.p)}">${risk(st.p)}</span></li>`;
    };
    const worst = [...chosen.steps].sort((a, b) => b.p - a.p).slice(0, 3).filter(s => s.p >= 0.005);
    const ids = sendable(chosen.route, chosen.stops), pilot = mine(), canSend = pilot?.id && S.backend.has(pilot.id);
    content.innerHTML = `
    <div class="modes">${Object.keys(MODES).map(modeCard).join('')}</div>
    <article class="card"><div class="card-head"><div><h3>${MODES[haulMode].label} route · ${chosen.stops.map(id => esc(g.systems.get(id).name)).join(' → ')}</h3>
      <p class="hint">${esc(HULLS[hull].name)}${$('#haul-hull').value ? '' : ' (suggested)'}: ${esc(HULLS[hull].why)} ${volume > HULLS[hull].cargo ? `<span class="neg">${Math.round(volume).toLocaleString()} m³ won’t fit; split the load.</span>` : ''} Chance of arriving: <b>${risk(chosen.survival)}</b>.</p></div></div>
      ${worst.length ? `<p class="alert ${level(worst[0].p) === 'danger' ? 'danger' : 'warn'}">Watch ${worst.map(s => `${esc(s.system.name)} (${risk(s.p)})`).join(', ')}. ${worst.some(s => liveIntel.get(s.system.id)?.gateKills) ? 'Gate kills in the last hour: a camp may still be there. Scout with an alt or wait it out.' : ''}</p>` : '<p class="alert ok">No hotspots on this route right now.</p>'}
      <div class="actions">${mapButton(chosen.route, `${MODES[haulMode].label} route`)}<a class="button secondary" href="${dotlanRoute(chosen.stops.map(id => g.systems.get(id).name))}" target="_blank" rel="noopener noreferrer">Open on Dotlan ↗</a>${autopilotButton(ids, 'haul-sent')}</div>
      ${canSend && ids.length < chosen.route.length - 1 ? '<p class="hint">Over 40 jumps: only your stops are sent, so the in-game autopilot picks the path between them.</p>' : ''}
      <ol class="hop-list" ${routeAttrs(chosen.route, `${MODES[haulMode].label} route`)}>${chosen.steps.map(step).join('')}</ol>
    </article>`;
    content.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { haulMode = b.dataset.mode; draw(); });
  };
  draw();
  // Pull live kills for every region the candidate routes cross, then re-plan with the camps priced in.
  const regions = [...new Set(Object.values(haulPlans).flatMap(pl => (pl.route || []).map(id => g.systems.get(id).region)))].slice(0, 12);
  try {
    const kills = (await Promise.all(regions.map(r => regionKills(r).catch(() => [])))).flat();
    const onRoute = new Set(Object.values(haulPlans).flatMap(pl => pl.route || []));
    const gateTo = await gateTargets(kills.filter(k => onRoute.has(k.solar_system_id) && k.zkb?.locationID >= 50000000 && k.zkb?.locationID < 60000000).map(k => k.zkb.locationID));
    liveIntel = campIntel(kills, {combat:meta.combat, gateTo});
    await resolveNames([...liveIntel.values()].flatMap(c => Object.keys(c.ships).map(Number)));
    liveNote = `Live: ${kills.filter(k => !k.zkb?.npc).length} kills in the last hour across ${plural(regions.length, 'region')} from zKillboard.`;
  } catch (error) { liveNote = `Live kills unavailable (${error.message}); using history only.`; }
  if (stale()) return;
  haulPlans = planAll();
  draw();
}

// The stop rows, filled from this browser's last plan (or here → Amarr) the first time they're needed.
function ensureRows() {
  const rows = $('#haul-stops');
  if (rows.children.length) return rows;
  const saved = haulSaved(), here = mine()?.ops?.location?.value?.solar_system_id;
  for (const v of saved.stops?.length >= 2 ? saved.stops : [mapGraph()?.systems.get(here)?.name || 'Jita', 'Amarr']) rows.append(haulRow(v));
  for (const key of ['value', 'volume', 'avoid']) if (saved[key] !== undefined) $(`#haul-${key}`).value = saved[key];
  haulNumber();
  return rows;
}
// "Haul here" makes a system the destination (the old destination stays on as a stop), "Haul from" the start,
// and "Add as stop" slots it in before the destination.
function haulWith(kind, name) {
  const rows = ensureRows(), input = row => row.querySelector('input'), first = rows.firstElementChild, last = rows.lastElementChild;
  if (kind === 'to') {
    if (!input(last).value.trim() || input(last).value.trim().toLowerCase() === name.toLowerCase()) input(last).value = name;
    else rows.append(haulRow(name));
  } else if (kind === 'from') input(first).value = name;
  else if (![...rows.querySelectorAll('input')].some(i => i.value.trim().toLowerCase() === name.toLowerCase())) rows.insertBefore(haulRow(name), last);
  haulNumber();
}
export function wire() {
  wireMap();
  document.addEventListener('click', event => {
    const b = event.target.closest('[data-haul-to], [data-haul-from], [data-haul-stop]');
    if (!b) return;
    const kind = b.dataset.haulTo ? 'to' : b.dataset.haulFrom ? 'from' : 'stop';
    const target = mapGraph()?.systems.get(Number(b.dataset.haulTo || b.dataset.haulFrom || b.dataset.haulStop));
    if (!target) return;
    if ($('#map-modal').open) $('#map-modal').close();
    haulWith(kind, target.name);
    go('hauling');
  });
  $('#haul-add').onclick = () => { const rows = $('#haul-stops'); rows.insertBefore(haulRow(), rows.lastElementChild); haulNumber(); rows.children[rows.children.length - 2].querySelector('input').focus(); };
  $('#haul-stops').onclick = event => {
    const row = event.target.closest('.stop-row'), rows = $('#haul-stops');
    if (!row) return;
    if (event.target.matches('[data-remove]') && rows.children.length > 2) row.remove();
    const move = Number(event.target.dataset.move || 0);
    if (move < 0 && row.previousElementSibling) rows.insertBefore(row, row.previousElementSibling);
    if (move > 0 && row.nextElementSibling) rows.insertBefore(row.nextElementSibling, row);
    haulNumber();
  };
  $('#haul-form').onsubmit = event => { event.preventDefault(); renderHauling(); };
}
