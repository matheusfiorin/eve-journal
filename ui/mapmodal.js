// The map modal (a route or one system in 3D), the system panel it shares with the Star map, live ESI overlays,
// and the page-wide map hooks: [data-map-route], [data-system], [data-destination] and route hover previews.
import {lightYears, secColor, frame} from '../map.js';
import {secLight, routeSketch, StarMap} from '../mapview.js';
import {dotlanSystem} from '../route.js';
import {S, reduced, mine} from './state.js';
import {esi, name} from './esi.js';
import {loadMarket} from './marketdata.js';
import {$, esc, fact, go, plural} from './shared.js';
import {mapGraph, route, regionName} from './routes.js';
import {addLayer} from './mapstate.js';

const SERVICES = [[1, 'Factory'], [2, 'Lab'], [4, 'Market'], [8, 'Refinery'], [16, 'Clone bay']];
let liveData = null, modalMap = null;
export const mapLiveData = () => liveData;
// Public ESI feeds for the overlays, cached for 10 minutes (1 minute when a feed failed, so it's retried soon).
// A failed feed is listed in `failed` so the map can say so instead of showing an empty overlay.
let liveTask = null;
export function mapLive() {
  if (liveData && Date.now() - liveData.at < (liveData.failed.length ? 60000 : 600000)) return Promise.resolve(liveData);
  return liveTask ||= loadLive().finally(() => { liveTask = null; });
}
async function loadLive() {
  const failed = [];
  const get = (path, feed) => esi(path).then(x => Array.isArray(x) ? x : Promise.reject(new Error('bad'))).catch(() => { failed.push(feed); return []; });
  const [kills, jumps, sov, fw, inc] = await Promise.all([['universe/system_kills/', 'kills'], ['universe/system_jumps/', 'jumps'], ['sovereignty/map/', 'sov'], ['fw/systems/', 'fw'], ['incursions/', 'incursions']].map(([p, f]) => get(p, f)));
  liveData = {at:Date.now(), failed, kills:Object.fromEntries(kills.map(k => [k.system_id, k])), jumps:Object.fromEntries(jumps.map(j => [j.system_id, j.ship_jumps])),
    sov:Object.fromEntries(sov.filter(x => x.alliance_id || x.faction_id).map(x => [x.system_id, x])), fw:Object.fromEntries(fw.map(x => [x.solar_system_id, x])),
    incursions:new Map(inc.flatMap(i => i.infested_solar_systems.map(id => [id, i])))};
  return liveData;
}
export function systemPanel(id, {compact = false} = {}) {
  const g = mapGraph(), sys = g?.systems.get(id);
  if (!sys) return '<p class="hint">Unknown system.</p>';
  const live = liveData, k = live?.kills[id], meta = S.marketData?.meta?.data || {};
  const constellation = g.constellations[sys.constellation]?.[0];
  const stations = [...g.stations.values()].filter(st => st.system === id);
  const here = mine()?.ops?.location?.value?.solar_system_id, from = here && here !== id && g.systems.has(here) ? route(here, id) : null;
  const sov = live?.sov[id], fw = live?.fw[id], inc = live?.incursions.get(id), idx = S.costIndices?.get(id);
  const pilot = mine(), canSend = pilot?.id && S.backend?.has(pilot.id);
  return `<div class="sys-panel" data-panel="${id}">
    <div class="sys-head"><div><h3>${esc(sys.name)}</h3><p class="hint">${esc(constellation || '')} · ${esc(regionName(sys.region))}</p></div><span class="sec-badge" style="--c:${secColor(sys.sec)}">${secLight(sys.sec)}</span></div>
    <div class="actions">${from?.jumps ? `<button type="button" class="secondary small" data-map-route="${from.systems.map(x => x.id).join(',')}" data-label="${esc(`${from.systems[0].name} → ${sys.name}`)}">Route from ${esc(from.systems[0].name)} · ${from.jumps} j</button>` : ''}<button type="button" class="secondary small" data-haul-to="${id}">Haul here</button><button type="button" class="secondary small" data-haul-from="${id}">Haul from</button><button type="button" class="secondary small" data-haul-stop="${id}">Add as stop</button>${canSend ? `<button type="button" class="secondary small" data-destination="${id}">Set destination</button>` : ''}<a class="button secondary small" href="${dotlanSystem(sys.name)}" target="_blank" rel="noopener noreferrer">Dotlan ↗</a><a class="button secondary small" href="https://zkillboard.com/system/${id}/" target="_blank" rel="noopener noreferrer">zKillboard ↗</a></div>
    <p class="hint" data-destination-status role="status"></p>
    <dl class="facts">${fact('Ship kills', `${k?.ship_kills ?? 0}<small>last hour · ~${Math.round(meta.risk?.s?.[id]?.[0] || 0)} over 24 h</small>`)}${fact('Pods / NPCs', `${k?.pod_kills ?? 0} / ${k?.npc_kills ?? 0}<small>last hour</small>`)}${fact('Jumps', `${(live?.jumps[id] ?? 0).toLocaleString()}<small>last hour</small>`)}${fact('Belts', sys.belts)}${idx ? fact('Industry', `${(idx.manufacturing * 100).toFixed(2)}%<small>build · ME ${((idx.researching_material_efficiency || 0) * 100).toFixed(2)}%</small>`) : ''}</dl>
    ${sov ? `<p class="tagline"><span class="tag">Sovereignty</span> ${esc(name(sov.alliance_id || sov.faction_id))}</p>` : ''}
    ${fw ? `<p class="tagline"><span class="tag flag">Faction warfare</span> ${esc(name(fw.occupier_faction_id))}${fw.contested !== 'uncontested' ? ` · ${esc(fw.contested)} ${Math.round(100 * fw.victory_points / (fw.victory_points_threshold || 1))}%` : ''}</p>` : ''}
    ${inc ? `<p class="tagline"><span class="tag flag">Incursion</span> ${esc(inc.state)} · influence ${Math.round((inc.influence || 0) * 100)}%</p>` : ''}
    ${compact ? '' : `<h4>Gates</h4><ul class="neighbors">${sys.links.map(n => g.systems.get(n)).filter(Boolean).map(n => `<li><button type="button" class="link-btn" data-system="${n.id}">${secLight(n.sec)} ${esc(n.name)}${n.region !== sys.region ? ` <small>${esc(regionName(n.region))}</small>` : ''}</button></li>`).join('')}</ul>`}
    <h4>NPC stations (${stations.length})</h4>${stations.length ? `<ul class="plain stations">${stations.slice(0, compact ? 4 : 30).map(st => `<li>${esc(st.name || `Station ${st.id}`)}<small>${SERVICES.filter(([bit]) => st.flags & bit).map(([, label]) => `<span class="tag dim">${label}</span>`).join(' ') || 'No industry or market services'}</small></li>`).join('')}</ul>` : '<p class="hint">No NPC stations.</p>'}
  </div>`;
}
// A route (3D view plus hop strip) or one system (panel plus its neighbourhood).
export async function openMap({route:ids0 = [], system = null, label = ''} = {}) {
  try { await loadMarket(); } catch { return; }
  const g = mapGraph(), dialog = $('#map-modal');
  if (!g) return;
  mapLive().then(() => { if (dialog.open && system) $('#map-modal-body .sys-panel')?.replaceWith(Object.assign(document.createElement('div'), {innerHTML:systemPanel(system, {compact:true})}).firstElementChild); }).catch(() => {});
  const ids = ids0.filter(id => g.systems.has(id)), sys = g.systems.get(system);
  $('#map-modal-title').textContent = ids.length ? label || 'Route' : sys?.name || 'System';
  const risky = ids.filter(id => g.systems.get(id).sec < 0.45).length;
  $('#map-modal-body').innerHTML = `<div class="modal-grid"><div class="modal-stage"><canvas class="star-map modal-canvas"></canvas><div class="map-zoom" role="group" aria-label="Zoom"><button type="button" class="secondary" data-zoom3d="0.75" aria-label="Zoom in">+</button><button type="button" class="secondary" data-zoom3d="1.33" aria-label="Zoom out">−</button></div></div><div class="modal-side">
    ${ids.length ? `<p class="hint">${plural(ids.length - 1, 'jump')} · ${[...new Set(ids.map(id => g.systems.get(id).region))].map(regionName).map(esc).join(' → ')}${risky ? ` · <span class="neg">${risky} outside high-sec</span>` : ''}</p>
      <ol class="hop-strip">${ids.map(id => { const x = g.systems.get(id); return `<li><button type="button" class="link-btn" data-system="${id}">${secLight(x.sec)} ${esc(x.name)}</button></li>`; }).join('')}</ol>` : systemPanel(system, {compact:true})}
    <div class="actions"><button type="button" id="map-modal-open">Open in Star map</button></div></div></div>`;
  if (!dialog.open) dialog.showModal();
  const canvas = dialog.querySelector('canvas');
  modalMap?.destroy();
  modalMap = new StarMap(canvas, {reduced, onSelect:x => openMap({system:x.id})});
  dialog.querySelectorAll('[data-zoom3d]').forEach(b => b.onclick = () => modalMap.zoomBy(Number(b.dataset.zoom3d)));
  // Only the neighbourhood is drawn: systems within reach of the route (or the system), not all of New Eden.
  const near = sys ? [...g.systems.values()].filter(x => x.pos && lightYears(sys, x) < 12) : [];
  const f = frame(ids.length ? ids.map(id => g.systems.get(id)) : [sys]), reach = f.radius * 1.6 + 20;
  const around = [...g.systems.values()].filter(x => x.pos && Math.hypot(x.pos[0] - f.center[0], x.pos[1] - f.center[1], x.pos[2] - f.center[2]) <= reach);
  modalMap.set({g, systems:around, color:id => secColor(g.systems.get(id).sec), focus:new Set(ids.length ? ids.flatMap(id => [id, ...g.systems.get(id).links]) : near.map(x => x.id)), route:ids, selected:sys?.id ?? ids.at(-1),
    summary:ids.length ? `3D view of ${label || 'the route'}: ${plural(ids.length - 1, 'jump')} from ${g.systems.get(ids[0]).name} to ${g.systems.get(ids.at(-1)).name}.` : `3D view around ${sys?.name}.`});
  modalMap.fly(ids.length ? ids.map(id => g.systems.get(id)) : near.length ? near : [sys], {snap:true});
  dialog.querySelector('#map-modal-open').onclick = () => {
    dialog.close();
    if (ids.length) S.map.layers = addLayer(S.map.layers, {label:label || 'Route', ids});
    showOnMap(ids.length ? ids.at(-1) : system);
  };
}
// Show a system on the Star map (from the palette, the modal or anywhere else) and remember it in the address.
export function showOnMap(id) {
  const g = mapGraph(), sys = g?.systems.get(id);
  if (sys) Object.assign(S.map, {selected:id, region:sys.region, linked:true});
  go('map');
}
// Hover previews: a sketch of any route under the pointer.
function routePop(target, event) {
  const pop = $('#route-pop'), g = mapGraph();
  if (!target || !g) { pop.hidden = true; return; }
  const ids = target.dataset.route.split(',').map(Number).filter(id => g.systems.has(id));
  if (ids.length < 2) { pop.hidden = true; return; }
  const key = `${target.dataset.route}|${target.dataset.label}`;
  if (pop.dataset.key !== key) {
    pop.dataset.key = key;
    const low = ids.filter(id => g.systems.get(id).sec < 0.45).length;
    pop.innerHTML = `<b>${esc(target.dataset.label || 'Route')}</b><small>${ids.length - 1} jumps${low ? ` · <span class="neg">${low} outside high-sec</span>` : ''}</small>${routeSketch(g, ids)}<small class="hint">Press 3D view for the full map</small>`;
  }
  pop.hidden = false;
  const x = Math.min(event.clientX + 16, innerWidth - 270), y = event.clientY + 16 + 200 > innerHeight ? event.clientY - 210 : event.clientY + 16;
  pop.style.left = `${x}px`; pop.style.top = `${y}px`;
}
export function wire() {
  document.addEventListener('click', event => {
    const routeBtn = event.target.closest('[data-map-route]');
    if (routeBtn) { event.preventDefault(); openMap({route:routeBtn.dataset.mapRoute.split(',').map(Number), label:routeBtn.dataset.label}); return; }
    const dest = event.target.closest('[data-destination]');
    if (dest) {
      const out = dest.closest('.sys-panel').querySelector('[data-destination-status]'), pilot = mine();
      out.textContent = 'Sending…';
      S.backend.waypoints(pilot.id, [Number(dest.dataset.destination)]).then(() => { out.textContent = `Destination set for ${pilot.name}.`; }, error => { out.textContent = error.message; });
      return;
    }
    // The Star map handles systems on its own canvas and panel.
    const sys = event.target.closest('[data-system]');
    if (sys && !sys.closest('#map-canvas-wrap, #map-panel')) { event.preventDefault(); openMap({system:Number(sys.dataset.system)}); }
  });
  document.addEventListener('mouseover', event => { const t = event.target.closest?.('[data-route]'); if (t && matchMedia('(hover: hover)').matches) routePop(t, event); });
  document.addEventListener('mousemove', event => { const t = event.target.closest?.('[data-route]'); if (t && !$('#route-pop').hidden) routePop(t, event); });
  document.addEventListener('mouseout', event => { const t = event.target.closest?.('[data-route]'); if (t && !t.contains(event.relatedTarget)) routePop(null); });
  $('#map-modal-close').onclick = () => $('#map-modal').close();
  $('#map-modal').addEventListener('close', () => modalMap?.stop());
  $('#map-modal').addEventListener('click', event => { if (event.target === $('#map-modal')) $('#map-modal').close(); });
}
