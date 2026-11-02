// Navigate: the Star map (region maps, 3D, live overlays, jump range, system panel) and the risk-weighted Haul plan.
import {HULLS, MODES, suggestHull, campIntel, plan} from '../../hauling.js';
import {secColor, inRange, JUMP_SHIPS, strengths, lightYears} from '../../map.js';
import {secLight, regionSvg, StarMap} from '../../mapview.js';
import {secClass, dotlanRoute} from '../../route.js';
import {S, reduced, mine} from '../state.js';
import {esi, json, name, resolveNames} from '../esi.js';
import {loadMarket} from '../marketdata.js';
import {$, esc, format, plural, mapButton, routeAttrs, tabReady, skeleton, go} from '../shared.js';
import {mapGraph, fillSystemList, regionName, sendable, autopilotButton} from '../routes.js';
import {mapLive, mapLiveData, systemPanel} from '../mapmodal.js';

const OVERLAY_OPTIONS = [['security','Security'],['shipKills','Ship kills (last hour)'],['podKills','Pod kills (last hour)'],['npcKills','NPC kills (last hour)'],['jumps','Jumps (last hour)'],['kills24','Ship kills (~24 h)'],['sov','Sovereignty'],['fw','Faction warfare'],['incursion','Incursions'],['industry','Manufacturing index'],['belts','Asteroid belts'],['stations','NPC stations']];
export const markup = {
  map:`<div class="card market-controls">
  <div class="card-head"><div><h2>Star map</h2><p id="map-status" class="hint">Loading the map…</p></div></div>
  <div class="row">
   <form id="map-find" class="find"><label>Find system<input id="map-search" list="systems" data-filter placeholder="Jita, Amarr, Tama…" autocomplete="off"></label><button class="secondary">Go</button></form>
   <label>Region<select id="map-region"></select></label>
  </div>
  <div class="row">
   <label>View<select id="map-view"><option value="region">Region map</option><option value="region3d">Region in 3D</option><option value="universe">New Eden in 3D</option></select></label>
   <label>Overlay<select id="map-overlay">${OVERLAY_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
   <label>Jump range<select id="map-jump"><option value="">Off</option><option value="blops">Black Ops · 8 ly</option><option value="jf">Jump freighter · 10 ly</option><option value="capital">Carrier, Dread, FAX · 7 ly</option><option value="super">Super, Titan · 6 ly</option></select></label>
  </div>
  <div id="map-route" class="map-route" hidden></div>
 </div>
 <div class="map-layout">
  <div id="map-stage" class="map-stage card"><div id="map-canvas-wrap" class="map-canvas-wrap"></div><div class="map-zoom"><button type="button" class="secondary small" data-zoom="0.75" aria-label="Zoom in">+</button><button type="button" class="secondary small" data-zoom="1.33" aria-label="Zoom out">−</button><button type="button" class="secondary small" data-zoom="0" aria-label="Fit the whole region">Fit</button></div><div id="map-tip" class="map-tip" hidden></div><div id="map-legend" class="map-legend"></div></div>
  <aside id="map-panel" class="card map-panel"></aside>
 </div>`,
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

// ── Star map ──
const OVERLAYS = {
  security:{color:'#4ecef8'}, shipKills:{color:'#ff7e70'}, podKills:{color:'#ff7e70'}, npcKills:{color:'#f4c55a'}, jumps:{color:'#4ecef8'}, kills24:{color:'#ff7e70'},
  sov:{color:'#c3b9ff'}, fw:{color:'#f4c55a'}, incursion:{color:'#bb1116'}, industry:{color:'#8fb2ff'}, belts:{color:'#e8956a'}, stations:{color:'#62d99b'}
};
for (const [key, label] of OVERLAY_OPTIONS) OVERLAYS[key].label = label;
let starMap = null;
const mapState = S.map;
function overlayValues(g, overlay) {
  const live = mapLiveData() || {kills:{}, jumps:{}, sov:{}, fw:{}, incursions:new Map()}, meta = S.marketData?.meta?.data || {}, out = {};
  for (const sys of g.systems.values()) {
    const id = sys.id, k = live.kills[id];
    out[id] = {shipKills:k?.ship_kills, podKills:k?.pod_kills, npcKills:k?.npc_kills, jumps:live.jumps[id], kills24:meta.risk?.s?.[id]?.[0], belts:sys.belts,
      sov:live.sov[id] ? 1 : 0, fw:live.fw[id] ? (live.fw[id].contested === 'uncontested' ? 0.3 : 0.6 + 0.4 * (live.fw[id].victory_points / (live.fw[id].victory_points_threshold || 1))) : 0,
      incursion:live.incursions.has(id) ? 1 : 0, industry:S.costIndices?.get(id)?.manufacturing, stations:0}[overlay];
  }
  if (overlay === 'stations') for (const st of g.stations.values()) out[st.system] = (out[st.system] || 0) + 1;
  return out;
}
function mapColor(g, overlay) {
  if (overlay === 'security') return id => secColor(g.systems.get(id).sec);
  const k = strengths(overlayValues(g, overlay)), [r, gg, b] = OVERLAYS[overlay].color.match(/\w\w/g).map(h => parseInt(h, 16));
  return id => { const v = k(id); return v ? `rgba(${r},${gg},${b},${(0.35 + 0.65 * v).toFixed(2)})` : 'rgba(139,155,176,0.35)'; };
}
function mapZoom(f) {
  const svg = $('#map-canvas-wrap svg.region-map');
  if (svg) {
    const b = svg.viewBox.baseVal, [fw, fh] = (svg.dataset.full || `${b.width} ${b.height}`).split(' ').map(Number);
    const box = f ? [b.x + b.width * (1 - f) / 2, b.y + b.height * (1 - f) / 2, b.width * f, b.height * f] : [0, 0, fw, fh];
    svg.setAttribute('viewBox', box.join(' ')); mapState.viewBox = {region:mapState.region, box};
  } else if (starMap && f) starMap.target.distance = Math.max(8, starMap.target.distance * f);
  else { delete $('#map-canvas-wrap').dataset.framed; renderMap(); }
}
const regionIdsWithLayout = g => Object.keys(g.regions).map(Number).filter(r => [...g.systems.values()].some(s => s.region === r && s.p2)).sort((a, b) => regionName(a).localeCompare(regionName(b)));
export async function renderMap() {
  const status = $('#map-status'), stage = $('#map-stage');
  if (!S.backend) { status.textContent = 'The map needs the backend.'; return; }
  try { await loadMarket(); } catch (error) { status.textContent = `Map unavailable: ${error.message}`; return; }
  const g = mapGraph();
  if (!g || !Object.keys(g.regions).length || ![...g.systems.values()].some(x => x.pos)) {
    status.textContent = 'Map data (star positions, region layouts and stations) is still being built by the hourly pipeline. Reload in a few minutes.';
    $('#map-canvas-wrap').innerHTML = skeleton('Charting New Eden…'); return;
  }
  fillSystemList(g);
  const regionSelect = $('#map-region');
  if (!regionSelect.options.length) regionSelect.innerHTML = regionIdsWithLayout(g).map(r => `<option value="${r}">${esc(regionName(r))}</option>`).join('');
  if (!mapState.region) {
    const here = mine()?.ops?.location?.value?.solar_system_id;
    mapState.selected ??= g.systems.has(here) ? here : 30000142;
    mapState.region = g.systems.get(mapState.selected)?.region || 10000002;
  }
  regionSelect.value = mapState.region;
  $('#map-view').value = mapState.view; $('#map-overlay').value = mapState.overlay; $('#map-jump').value = mapState.jump;
  const routeBar = $('#map-route');
  routeBar.hidden = !mapState.route.length;
  routeBar.innerHTML = mapState.route.length ? `<span>${esc(mapState.routeLabel)} · ${plural(mapState.route.length - 1, 'jump')}</span><button type="button" class="secondary small" id="map-route-clear">Clear route</button>` : '';
  status.textContent = 'Loading live kills, jumps, sovereignty and incursions…';
  const live = await mapLive();
  const missing = [...new Set([...Object.values(live.sov).map(x => x.alliance_id || x.faction_id), ...Object.values(live.fw).map(x => x.occupier_faction_id)])].filter(Boolean);
  await resolveNames(missing).catch(() => {});
  const kills = Object.values(live.kills).reduce((t, k) => t + k.ship_kills, 0);
  status.textContent = `${g.systems.size.toLocaleString()} systems · ${Object.keys(g.regions).length} regions · ${kills.toLocaleString()} ship kills and ${Object.values(live.jumps).reduce((t, j) => t + j, 0).toLocaleString()} jumps in the last hour · ${(n => n ? plural(n, 'incursion') : 'no incursions')(new Set([...live.incursions.values()]).size)}`;
  const values = overlayValues(g, mapState.overlay), k = strengths(values);
  const range = mapState.jump && mapState.selected ? inRange(g, mapState.selected, JUMP_SHIPS[mapState.jump].ly) : [];
  const rangeIds = new Set(range.map(r => r.system.id));
  const legend = $('#map-legend');
  legend.innerHTML = mapState.overlay === 'security'
    ? `<span>Security</span>${[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, -0.5].map(v => `<i class="swatch" style="--c:${secColor(v)}" title="${v > 0 ? v.toFixed(1) : '0.0 and below'}"></i>`).join('')}<span>1.0 → null</span>`
    : `<span>${esc(OVERLAYS[mapState.overlay].label)}</span><i class="swatch big" style="--c:${OVERLAYS[mapState.overlay].color}"></i><span>more</span>`;
  if (mapState.jump && mapState.selected) legend.innerHTML += `<span class="range-note">${range.length ? plural(range.length, 'system') : 'No low-sec or null-sec systems'} within ${JUMP_SHIPS[mapState.jump].ly} ly (${esc(JUMP_SHIPS[mapState.jump].name)})</span>`;
  const tip = $('#map-tip');
  const showTip = (sys, x, y) => {
    if (!sys) { tip.hidden = true; return; }
    const v = values[sys.id];
    tip.innerHTML = `<b>${esc(sys.name)}</b> ${secLight(sys.sec)}<small>${esc(regionName(sys.region))}${mapState.overlay !== 'security' ? ` · ${esc(OVERLAYS[mapState.overlay].label)}: ${v === undefined ? '—' : typeof v === 'number' && v < 1 && v > 0 ? `${(v * 100).toFixed(1)}%` : v}` : ''}${rangeIds.has(sys.id) ? ` · ${lightYears(g.systems.get(mapState.selected), sys).toFixed(1)} ly` : ''}</small>`;
    tip.style.left = `${Math.min(x + 14, stage.clientWidth - 200)}px`; tip.style.top = `${y + 14}px`; tip.hidden = false;
  };
  const select = id => { mapState.selected = id; const r = g.systems.get(id)?.region; if (mapState.view === 'region' && r !== mapState.region && g.systems.get(id)?.p2) mapState.region = r; renderMap(); };
  const wrap = $('#map-canvas-wrap');
  if (mapState.view === 'region') {
    starMap?.stop();
    wrap.innerHTML = regionSvg(g, mapState.region, {strength:mapState.overlay === 'security' ? () => 0 : k, value:id => values[id] ?? '', route:mapState.route, selected:mapState.selected, range:rangeIds, overlayColor:OVERLAYS[mapState.overlay].color});
    const svg = wrap.querySelector('svg');
    if (svg) {
      svg.addEventListener('mouseover', e => { const n = e.target.closest('.sys'); if (n) { const r = stage.getBoundingClientRect(); showTip(g.systems.get(Number(n.dataset.system)), e.clientX - r.left, e.clientY - r.top); } });
      svg.addEventListener('mouseout', e => { if (e.target.closest('.sys') && !e.relatedTarget?.closest?.('.sys')) tip.hidden = true; });
      svg.addEventListener('click', e => { const n = e.target.closest('[data-system]'); if (n) { e.stopPropagation(); select(Number(n.dataset.system)); } });
      svg.addEventListener('keydown', e => { const n = e.target.closest('.sys'); if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(Number(n.dataset.system)); } });
      zoomable(svg, box => { mapState.viewBox = {region:mapState.region, box}; });
      // Keep the reader's zoom across overlay changes; a big region opens at reading size around the selected system.
      const full = svg.viewBox.baseVal, px = wrap.clientWidth || 900, ph = wrap.clientHeight || 600;
      const node = svg.querySelector(`.sys[data-system="${mapState.selected}"]`);
      const at = node ? node.getAttribute('transform').match(/[\d.]+/g).map(Number) : [full.width / 2, full.height / 2];
      let box = mapState.viewBox?.region === mapState.region ? mapState.viewBox.box : null;
      if (box && node && (at[0] < box[0] || at[0] > box[0] + box[2] || at[1] < box[1] || at[1] > box[1] + box[3])) box = null;
      if (!box && (full.width > px * 1.05 || full.height > ph * 1.05)) { const w = px * 1.1, h = w * ph / px; box = [at[0] - w / 2, at[1] - h / 2, w, h]; }
      if (box) svg.setAttribute('viewBox', box.join(' '));
      svg.dataset.full = `${full.width} ${full.height}`;
    }
  } else {
    if (!wrap.querySelector('canvas')) { wrap.innerHTML = '<canvas class="star-map" aria-label="3D star map"></canvas>'; starMap = new StarMap(wrap.querySelector('canvas'), {reduced, onHover:(sys, x, y) => showTip(sys, x, y), onSelect:sys => select(sys.id)}); }
    const inRegion = [...g.systems.values()].filter(x => x.region === mapState.region);
    const universeView = mapState.view === 'universe';
    const focus = universeView ? null : new Set([...inRegion.map(x => x.id), ...mapState.route, ...rangeIds]);
    const labels = universeView ? Object.keys(g.regions).map(Number).map(r => { const sysIn = [...g.systems.values()].filter(x => x.region === r && x.pos); const c = sysIn.reduce((t, x) => t.map((v, i) => v + x.pos[i] / sysIn.length), [0, 0, 0]); return {text:regionName(r), pos:c, n:sysIn.length}; }).sort((a, b) => b.n - a.n) : [];
    starMap.set({g, systems:[...g.systems.values()].filter(x => x.pos), color:mapColor(g, mapState.overlay), focus, route:mapState.route, selected:mapState.selected, labels});
    const target = mapState.route.length ? mapState.route.map(id => g.systems.get(id)) : universeView ? [...g.systems.values()] : inRegion;
    if (wrap.dataset.framed !== `${mapState.view}:${mapState.region}:${mapState.route.join()}`) { starMap.fly(target.filter(x => x?.pos), {snap:!wrap.dataset.framed}); wrap.dataset.framed = `${mapState.view}:${mapState.region}:${mapState.route.join()}`; }
  }
  const panel = $('#map-panel');
  if (mapState.selected) panel.innerHTML = systemPanel(mapState.selected);
  else panel.innerHTML = `<h3>${esc(regionName(mapState.region))}</h3><p class="hint">Select a system for details.</p>`;
  if (range.length) panel.innerHTML += `<h4>In jump range (${range.length})</h4><ul class="plain">${range.slice(0, 12).map(r => `<li><button type="button" class="link-btn" data-system="${r.system.id}">${secLight(r.system.sec)} ${esc(r.system.name)}</button><small>${r.ly.toFixed(2)} ly · ${esc(regionName(r.system.region))}</small></li>`).join('')}</ul>`;
}
// Wheel to zoom and drag to pan an SVG map by moving its viewBox.
function zoomable(svg, onChange = () => {}) {
  const vb = () => svg.viewBox.baseVal;
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const box = vb(), r = svg.getBoundingClientRect(), f = e.deltaY > 0 ? 1.15 : 0.87;
    const mx = box.x + (e.clientX - r.left) / r.width * box.width, my = box.y + (e.clientY - r.top) / r.height * box.height;
    const w = Math.max(150, Math.min(3000, box.width * f)), h = box.height * w / box.width;
    svg.setAttribute('viewBox', `${mx - (mx - box.x) * w / box.width} ${my - (my - box.y) * h / box.height} ${w} ${h}`);
    onChange([...svg.getAttribute('viewBox').split(' ').map(Number)]);
  }, {passive:false});
  let drag = null;
  svg.addEventListener('pointerdown', e => { if (!e.target.closest('[data-system]')) drag = {x:e.clientX, y:e.clientY}; });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const box = vb(), r = svg.getBoundingClientRect();
    svg.setAttribute('viewBox', `${box.x - (e.clientX - drag.x) * box.width / r.width} ${box.y - (e.clientY - drag.y) * box.height / r.height} ${box.width} ${box.height}`);
    drag = {x:e.clientX, y:e.clientY};
    onChange([...svg.getAttribute('viewBox').split(' ').map(Number)]);
  });
  svg.addEventListener('pointerup', () => { drag = null; });
  svg.addEventListener('pointerleave', () => { drag = null; });
}

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
  const rows = $('#haul-stops');
  if (!rows.children.length) {
    const saved = haulSaved(), here = mine()?.ops?.location?.value?.solar_system_id;
    for (const v of saved.stops?.length >= 2 ? saved.stops : [g.systems.get(here)?.name || 'Jita', 'Amarr']) rows.append(haulRow(v));
    for (const key of ['value', 'volume', 'avoid']) if (saved[key] !== undefined) $(`#haul-${key}`).value = saved[key];
    haulNumber();
  }
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

export function wire() {
  document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => mapZoom(Number(b.dataset.zoom)));
  $('#map-region').onchange = event => { mapState.region = Number(event.target.value); mapState.selected = null; renderMap(); };
  $('#map-view').onchange = event => { mapState.view = event.target.value; renderMap(); };
  $('#map-overlay').onchange = event => { mapState.overlay = event.target.value; renderMap(); };
  $('#map-jump').onchange = event => { mapState.jump = event.target.value; renderMap(); };
  $('#map-find').onsubmit = event => {
    event.preventDefault();
    const g = mapGraph(), q = $('#map-search').value.trim().toLowerCase();
    const hit = g && [...g.systems.values()].find(x => x.name.toLowerCase() === q) || g && [...g.systems.values()].find(x => x.name.toLowerCase().startsWith(q));
    if (!hit) { $('#map-status').textContent = `No system named “${$('#map-search').value}”.`; return; }
    mapState.selected = hit.id; mapState.region = hit.region; renderMap();
  };
  // Systems in the side panel select on the map; the route bar clears; "Haul here" fills the last haul stop.
  document.addEventListener('click', event => {
    const sys = event.target.closest('#map-panel [data-system]');
    if (sys) { event.preventDefault(); mapState.selected = Number(sys.dataset.system); const r = mapGraph()?.systems.get(mapState.selected)?.region; if (mapState.view === 'region' && r) mapState.region = r; renderMap(); }
    if (event.target.id === 'map-route-clear') { mapState.route = []; mapState.routeLabel = ''; renderMap(); }
    const haulTo = event.target.closest('[data-haul-to]');
    if (haulTo) {
      const target = mapGraph()?.systems.get(Number(haulTo.dataset.haulTo));
      if (target) { $('#map-modal').close(); go('hauling'); requestAnimationFrame(() => { $('#haul-stops').lastElementChild.querySelector('input').value = target.name; renderHauling(); }); }
    }
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
