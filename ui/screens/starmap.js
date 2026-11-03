// Navigate → Star map: region maps, 3D views and a List view with live overlays, jump range, layers (routes, pins,
// trails, rings), the system panel (a bottom sheet on phones), keyboard moves and an address that names the view.
import {secColor, secBand, ownerColor, inRange, JUMP_SHIPS, strengths, lightYears} from '../../map.js';
import {secLight, regionSvg, StarMap} from '../../mapview.js';
import {secShown} from '../../route.js';
import {S, reduced, mine} from '../state.js';
import {name, resolveNames} from '../esi.js';
import {loadMarket} from '../marketdata.js';
import {$, esc, plural, skeleton, openDrawer} from '../shared.js';
import {mapGraph, fillSystemList, regionName, sendable, autopilotButton} from '../routes.js';
import {mapLive, mapLiveData, systemPanel} from '../mapmodal.js';
import {attach, zoomBox, panBox, fitBox, svgScale, toMap} from '../gestures.js';
import {parseMapHash, serializeMapHash, loadPrefs, savePrefs, removeLayer, neighbourByAngle, lod, sortRows, DEFAULTS} from '../mapstate.js';
import {hashQueries, currentView} from '../shell.js';

// Overlays: label, halo colour (sovereignty is coloured per owner), and which live feed it needs.
const OVERLAYS = {
  security:{label:'Security'},
  shipKills:{label:'Ship kills (last hour)', color:'#FF7E70', feed:'kills'},
  podKills:{label:'Pod kills (last hour)', color:'#FFA26B', feed:'kills'},
  npcKills:{label:'NPC kills (last hour)', color:'#F4C55A', feed:'kills'},
  jumps:{label:'Jumps (last hour)', color:'#5CD3DE', feed:'jumps'},
  kills24:{label:'Ship kills (~24 h)', color:'#FF5C8A', feed:'risk'},
  sov:{label:'Sovereignty', color:'#C3B9FF', feed:'sov'},
  fw:{label:'Faction warfare', color:'#B8E05A', feed:'fw'},
  incursion:{label:'Incursions', color:'#FF4FD8', feed:'incursions'},
  industry:{label:'Manufacturing index', color:'#8FB2FF', feed:'industry'},
  belts:{label:'Asteroid belts', color:'#E8956A'},
  stations:{label:'NPC stations', color:'#62D99B'}
};
const FEED_NAMES = {kills:'Kills feed', jumps:'Jumps feed', sov:'Sovereignty feed', fw:'Faction warfare feed', incursions:'Incursions feed', risk:'Kill history', industry:'Industry indices'};
const VIEW_OPTIONS = [['region', 'Region map'], ['region3d', 'Region in 3D'], ['universe', 'New Eden in 3D'], ['list', 'List']];
const JUMP_OPTIONS = [['', 'Off'], ...Object.entries({blops:'Black Ops · 8 ly', jf:'Jump freighter · 10 ly', capital:'Carrier, Dread, FAX · 7 ly', super:'Super, Titan · 6 ly'})];
const options = list => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
const icon = n => `<svg class="ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;

export const markup = `<div id="map-controls-home" class="map-controls-home"><div id="map-controls" class="map-toolbar">
   <nav id="map-crumbs" class="map-crumbs" aria-label="Map location"></nav>
   <div class="map-selects">
    <label>Region<select id="map-region"></select></label>
    <label>View<select id="map-view">${options(VIEW_OPTIONS)}</select></label>
    <label>Overlay<select id="map-overlay">${options(Object.entries(OVERLAYS).map(([k, v]) => [k, v.label]))}</select></label>
    <label>Jump range<select id="map-jump">${options(JUMP_OPTIONS)}</select></label>
   </div>
  </div></div>
 <p id="map-status" class="hint map-status" role="status">Loading the map…</p>
 <div class="map-layout">
  <div id="map-stage" class="map-stage">
   <form id="map-find" class="map-find" role="search"><label><span class="sr-only">Find system</span><input id="map-search" list="systems" data-filter placeholder="Find a system" autocomplete="off" enterkeyhint="go"></label><button class="secondary small" aria-label="Go to system">Go</button></form>
   <button type="button" id="map-layers-open" class="secondary map-layers-btn" aria-haspopup="dialog">${icon('navigate')}Layers</button>
   <div id="map-route" class="map-route" hidden></div>
   <div id="map-canvas-wrap" class="map-canvas-wrap"></div>
   <div class="map-zoom" role="group" aria-label="Zoom"><button type="button" class="secondary" data-zoom="0.75" aria-label="Zoom in">+</button><button type="button" class="secondary" data-zoom="1.33" aria-label="Zoom out">−</button><button type="button" class="secondary" data-zoom="0" aria-label="Fit the whole region">Fit</button><button type="button" class="secondary" data-locate aria-label="Show my location">◎</button></div>
   <div id="map-tip" class="map-tip" role="tooltip" hidden></div>
   <div id="map-legend" class="map-legend"></div>
  </div>
  <aside id="map-panel" class="map-panel" aria-label="System details" data-snap="peek"><button type="button" class="sheet-handle" id="map-sheet-handle" aria-label="Expand the details sheet" aria-expanded="false"></button><div id="map-panel-body" class="map-panel-body"></div></aside>
 </div>`;

const M = S.map;
const EMPTY = {kills:{}, jumps:{}, sov:{}, fw:{}, incursions:new Map(), failed:[]};
const live = () => mapLiveData() || EMPTY;
const liveFresh = () => mapLiveData() && Date.now() - mapLiveData().at < 600000;
const media = q => typeof matchMedia === 'function' && matchMedia(q).matches;
const coarse = () => media('(pointer: coarse)');
const phone = () => media('(max-width: 720px)');
const sovOwner = id => { const s = live().sov[id]; return s ? s.alliance_id || s.faction_id : null; };
let starMap = null, region = null, gen = 0, listSort = {key:'shipKills', dir:0}, regionLabels = new WeakMap();

// ── State in the address bar and in this browser ──
const query = () => serializeMapHash(M);
hashQueries.map = () => M.linked ? query() : '';
function pushUrl(replace = false) {
  M.linked = true;
  savePrefs(localStorage, M);
  if (currentView() !== 'map') return;
  const hash = `#navigate/map${query() ? `?${query()}` : ''}`;
  if (location.hash === hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', `${location.pathname}${location.search}${hash}`);
}
const isMapHash = h => /^(navigate\/)?map(\?|$)/.test(h);
function fromUrl(hash, restore = false) {
  const parsed = parseMapHash(hash);
  if (!hash.includes('?')) return false;
  Object.assign(M, restore ? {...DEFAULTS, selected:null, ...parsed} : parsed, {linked:true});
  if (parsed.region && !parsed.selected && !restore) M.selected = null;
  return true;
}

// ── Overlay values, colours and words ──
function overlayValues(g, overlay) {
  const L = live(), meta = S.marketData?.meta?.data || {}, out = {};
  for (const sys of g.systems.values()) {
    const id = sys.id, k = L.kills[id];
    out[id] = {shipKills:k?.ship_kills, podKills:k?.pod_kills, npcKills:k?.npc_kills, jumps:L.jumps[id], kills24:meta.risk?.s?.[id]?.[0], belts:sys.belts,
      sov:L.sov[id] ? 1 : 0, fw:L.fw[id] ? (L.fw[id].contested === 'uncontested' ? 0.3 : 0.6 + 0.4 * (L.fw[id].victory_points / (L.fw[id].victory_points_threshold || 1))) : 0,
      incursion:L.incursions.has(id) ? 1 : 0, industry:S.costIndices?.get(id)?.manufacturing, stations:0}[overlay];
  }
  if (overlay === 'stations') for (const st of g.stations.values()) out[st.system] = (out[st.system] || 0) + 1;
  return out;
}
function valueText(overlay, id, v) {
  const L = live();
  if (overlay === 'sov') return sovOwner(id) ? name(sovOwner(id)) : '';
  if (overlay === 'fw') { const f = L.fw[id]; return f ? `${name(f.occupier_faction_id)} · ${f.contested === 'uncontested' ? 'uncontested' : `${f.contested} ${Math.round(100 * f.victory_points / (f.victory_points_threshold || 1))}%`}` : ''; }
  if (overlay === 'incursion') return L.incursions.get(id)?.state || '';
  if (overlay === 'industry') return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '';
  if (overlay === 'kills24') return Number.isFinite(v) ? `~${Math.round(v)}` : '';
  return Number.isFinite(v) ? v.toLocaleString() : '';
}
const colorOf = overlay => overlay === 'sov' ? id => ownerColor(sovOwner(id) || 0) : () => OVERLAYS[overlay].color || '#C3B9FF';
const rgba = (hex, a) => `rgba(${hex.match(/\w\w/g).map(h => parseInt(h, 16)).join(',')},${(Math.round(a * 10) / 10).toFixed(1)})`;
function mapColor(g, overlay, k) {
  if (overlay === 'security') return id => secColor(g.systems.get(id).sec);
  const c = colorOf(overlay);
  return id => { const v = k(id); return v ? rgba(c(id), 0.35 + 0.65 * v) : 'rgba(139,155,176,0.35)'; };
}
function feedDown(overlay) {
  const feed = OVERLAYS[overlay].feed, meta = S.marketData?.meta?.data || {};
  if (!feed) return '';
  if (feed === 'risk') return meta.risk?.s ? '' : FEED_NAMES.risk;
  if (feed === 'industry') return S.costIndices ? '' : FEED_NAMES.industry;
  return live().failed?.includes(feed) ? FEED_NAMES[feed] : '';
}

// ── One frame of map state: everything a draw needs, computed once. ──
function frameOf(g) {
  const overlay = M.overlay, values = overlayValues(g, overlay);
  const scope = M.view === 'universe' ? [...g.systems.keys()] : [...g.systems.values()].filter(s => s.region === M.region).map(s => s.id);
  const scoped = Object.fromEntries(scope.map(id => [id, values[id]]));
  const k = overlay === 'security' ? () => 0 : strengths(scoped);
  const range = M.jump && M.selected && g.systems.get(M.selected)?.pos ? inRange(g, M.selected, JUMP_SHIPS[M.jump].ly) : [];
  return {g, overlay, values, scope, scoped, k, range, rangeIds:new Set(range.map(r => r.system.id))};
}
function systemLabel(f, s) {
  const k = live().kills[s.id], v = f.values[s.id], text = f.overlay !== 'security' && f.overlay !== 'shipKills' ? valueText(f.overlay, s.id, v) : '';
  return [`${s.name}`, `${secShown(s.sec).toFixed(1)} ${secBand(s.sec)}`, k?.ship_kills ? `ship kills ${k.ship_kills}` : '', text ? `${OVERLAYS[f.overlay].label} ${text}` : '',
    f.rangeIds.has(s.id) ? 'in jump range' : '', s.id === M.selected ? 'selected' : ''].filter(Boolean).join(', ');
}
function legendHtml(f) {
  const {g, overlay} = f;
  let html;
  if (overlay === 'security') {
    const band = (label, values) => `<span class="band">${values.map(v => `<i class="swatch" style="--c:${secColor(v)}"></i>`).join('')}<b>${label}</b></span>`;
    html = `<span class="legend-title">Security</span>${band('High 0.5+', [1, 0.8, 0.5])}${band('Low 0.1–0.4', [0.4, 0.3, 0.1])}${band('Null', [-0.5])}`;
  } else if (overlay === 'sov') {
    const owners = new Map();
    for (const id of f.scope) { const o = sovOwner(id); if (o) owners.set(o, (owners.get(o) || 0) + 1); }
    const top = [...owners].sort((a, b) => b[1] - a[1]).slice(0, 4);
    html = `<span class="legend-title">Sovereignty</span>${top.map(([o]) => `<span class="band"><i class="swatch" style="--c:${ownerColor(o)}"></i><b>${esc(name(o))}</b></span>`).join('')}${owners.size > 4 ? `<span>+${owners.size - 4} more</span>` : ''}`;
  } else if (overlay === 'incursion') {
    html = `<span class="legend-title">Incursions</span><span class="band"><i class="swatch" style="--c:${OVERLAYS.incursion.color}"></i><b>Infested system</b></span>`;
  } else if (overlay === 'fw') {
    html = `<span class="legend-title">Faction warfare</span><span>uncontested</span><i class="swatch big" style="--c:${OVERLAYS.fw.color}"></i><span>close to flipping</span>`;
  } else {
    const max = Math.max(0, ...Object.values(f.scoped).filter(Number.isFinite));
    html = `<span class="legend-title">${esc(OVERLAYS[overlay].label)}</span><span class="num">0</span><i class="swatch big" style="--c:${OVERLAYS[overlay].color}"></i><span class="num">max ${esc(valueText(overlay, 0, max) || '0')}</span><small class="scale-note">halo size on a √ scale</small>`;
  }
  const down = feedDown(overlay);
  if (down) html += `<span class="feed-bad">${esc(down)} unavailable</span>`;
  else if (overlay !== 'security' && !f.scope.some(id => f.values[id] > 0)) html += `<span class="empty-note">No ${esc(OVERLAYS[overlay].label.replace(/ \(.*\)/, '').toLowerCase())} in ${M.view === 'universe' ? 'New Eden' : esc(regionName(M.region))} right now</span>`;
  if (M.jump && M.selected) html += `<span class="range-note">${f.range.length ? plural(f.range.length, 'system') : 'No low-sec or null-sec systems'} within ${JUMP_SHIPS[M.jump].ly} ly (${esc(JUMP_SHIPS[M.jump].name)})</span>`;
  return html;
}
function statusText(g) {
  const L = mapLiveData();
  if (!L) return `${g.systems.size.toLocaleString()} systems · ${Object.keys(g.regions).length} regions · loading live kills, jumps, sovereignty and incursions…`;
  const kills = Object.values(L.kills).reduce((t, k) => t + k.ship_kills, 0);
  return `${g.systems.size.toLocaleString()} systems · ${Object.keys(g.regions).length} regions · ${kills.toLocaleString()} ship kills and ${Object.values(L.jumps).reduce((t, j) => t + j, 0).toLocaleString()} jumps in the last hour · ${(n => n ? plural(n, 'incursion') : 'no incursions')(new Set([...L.incursions.values()]).size)}${L.failed?.length ? ` · ${L.failed.length} live ${L.failed.length === 1 ? 'feed' : 'feeds'} unavailable` : ''}`;
}

// ── Tooltip: mouse hover or keyboard focus, never a finger. ──
function showTip(f, sys, x, y) {
  const tip = $('#map-tip'), stage = $('#map-stage');
  if (!sys) { tip.hidden = true; return; }
  const v = f.values[sys.id], text = valueText(f.overlay, sys.id, v);
  tip.innerHTML = `<b>${esc(sys.name)}</b> ${secLight(sys.sec)}<small>${esc(regionName(sys.region))}${f.overlay !== 'security' ? ` · ${esc(OVERLAYS[f.overlay].label)}: ${esc(text || '—')}` : ''}${f.rangeIds.has(sys.id) ? ` · ${lightYears(f.g.systems.get(M.selected), sys).toFixed(1)} ly` : ''}</small>`;
  tip.hidden = false;
  tip.style.left = `${Math.max(8, Math.min(x + 14, stage.clientWidth - tip.offsetWidth - 8))}px`;
  tip.style.top = `${Math.max(8, Math.min(y + 14, stage.clientHeight - tip.offsetHeight - 8))}px`;
}

// ── Region map: pan/zoom controller over the SVG viewBox, written once per animation frame. ──
function regionController(svg, f) {
  const [, , fw, fh] = svg.getAttribute('viewBox').split(' ').map(Number);
  const wrap = svg.parentElement, rect = () => svg.getBoundingClientRect();
  const aspect = () => (wrap.clientWidth || 900) / (wrap.clientHeight || 600);
  const px = () => wrap.clientWidth || 900;
  const limits = () => ({min:120, max:Math.max(fw, fh * aspect()) * 1.6});
  let box = null, raf = 0;
  const apply = () => {
    raf = 0;
    svg.setAttribute('viewBox', box.map(v => Math.round(v * 100) / 100).join(' '));
    M.viewBox = {region:M.region, box:[...box]};
    const r = rect();
    svg.dataset.lod = lod(r.width ? svgScale(box, r) : 1);
  };
  const set = (b, now = false) => { box = b; if (now) { cancelAnimationFrame(raf); apply(); } else if (!raf) raf = requestAnimationFrame(apply); };
  const nodeAt = id => { const n = svg.querySelector(`.sys[data-system="${id}"]`); return n && n.getAttribute('transform').match(/-?[\d.]+/g).map(Number); };
  // Fit into the part of the stage the floating search, layer bar and legend leave free, then grow the box to the
  // whole stage so those overlays sit over empty space.
  const insets = () => {
    const st = wrap.getBoundingClientRect(), below = sel => { const el = $(sel); return el && !el.hidden && el.offsetParent ? el.getBoundingClientRect().bottom - st.top + 8 : 0; };
    const legend = $('#map-legend').getBoundingClientRect();
    return [Math.max(0, below('#map-find'), below('#map-route')), legend.height ? Math.max(0, st.bottom - legend.top + 8) : 0];
  };
  const within = (extent, pad) => {
    const [top, bottom] = insets(), w = wrap.clientWidth || 900, h = Math.max(120, (wrap.clientHeight || 600) - top - bottom);
    const b = fitBox(extent, {pad, aspect:w / h, minWidth:px() / 1.6}), s = w / b[2];
    return [b[0], b[1] - top / s, b[2], b[3] + (top + bottom) / s];
  };
  // Fit: the whole region, never blown up past 1.6× (the old Fit kept the zoomed box as the "full" size).
  const fit = () => within([0, 0, fw, fh], 0);
  const fitTo = pts => pts.length ? within([Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))], 60) : fit();
  // Opening view: the saved box if it still shows the selection, else the whole region when it reads well,
  // else a reading-size window (bigger text on touch screens) around the selected system, kept inside the region.
  const initial = () => {
    const at = nodeAt(M.selected) || [fw / 2, fh / 2];
    const saved = M.viewBox?.region === M.region ? M.viewBox.box : null;
    if (saved && at[0] >= saved[0] && at[0] <= saved[0] + saved[2] && at[1] >= saved[1] && at[1] <= saved[1] + saved[3]) return saved;
    const whole = fit(), read = coarse() ? 1.3 : 0.9;
    if (px() / whole[2] >= read) return whole;
    const [top, bottom] = insets(), H = wrap.clientHeight || 600, w = px() / read, h = H / read, free = Math.max(120, H - top - bottom);
    return [Math.max(-40, Math.min(fw - w + 40, at[0] - w / 2)), Math.max(-40 - top / read, Math.min(fh - h + 40 + bottom / read, at[1] - (top + free / 2) / read)), w, h];
  };
  svg.dataset.full = `${fw} ${fh}`;
  set(initial(), true);
  const detach = attach(svg, {
    start:() => { $('#map-tip').hidden = true; },
    pan:(dx, dy) => set(panBox(box, dx, dy, svgScale(box, rect()))),
    zoom:(k, x, y) => set(zoomBox(box, k, toMap(box, rect(), x, y), limits()))
  });
  return {
    svg, detach,
    zoom:k => set(zoomBox(box, k, undefined, limits())),
    fit:() => set(fit()),
    fitIds:ids => set(fitTo(ids.map(nodeAt).filter(Boolean))),
    // Pan just enough that a system is on screen, clear of anything covering the bottom (the phone sheet).
    reveal:(id, bottom = 0) => {
      const at = nodeAt(id), r = rect();
      if (!at || !r.width) return;
      const s = svgScale(box, r), ox = (r.width - box[2] * s) / 2, oy = (r.height - box[3] * s) / 2;
      const sx = ox + (at[0] - box[0]) * s, sy = oy + (at[1] - box[1]) * s, visH = r.height - bottom;
      if (sx > 40 && sx < r.width - 40 && sy > 30 && sy < visH - 30) return;
      set(panBox(box, r.width / 2 - sx, visH / 2 - sy, s));
    }
  };
}
const layersKey = () => M.layers.map(l => `${l.id}:${l.ids.length}`).join();
function drawRegion(f, wrap) {
  const key = [M.region, f.overlay, layersKey(), mapLiveData()?.at || 0, S.costIndices ? 1 : 0, S.marketData?.meta?.updatedAt || 0].join('|');
  let svg = wrap.querySelector('svg.region-map');
  const hadFocus = svg?.contains(document.activeElement);
  if (!svg || svg.dataset.key !== key || region?.svg !== svg) {
    region?.detach();
    wrap.innerHTML = regionSvg(f.g, M.region, {strength:f.k, value:id => f.values[id] ?? '', colorOf:colorOf(f.overlay), layers:M.layers, selected:M.selected, range:f.rangeIds, label:s => systemLabel(f, s)});
    svg = wrap.querySelector('svg');
    if (!svg) { region = null; return; }
    svg.dataset.key = key;
    region = regionController(svg, f);
  }
  // Selection, range rings, roving focus and labels change in place; the drawing stays.
  let focusable = null;
  for (const n of svg.querySelectorAll('.sys')) {
    const id = Number(n.dataset.system), s = f.g.systems.get(id);
    n.classList.toggle('selected', id === M.selected); n.classList.toggle('in-range', f.rangeIds.has(id));
    n.setAttribute('aria-label', systemLabel(f, s));
    n.setAttribute('tabindex', '-1');
    if (id === M.selected) focusable = n;
  }
  for (const n of svg.querySelectorAll('.exit')) n.setAttribute('tabindex', '-1');
  focusable ||= svg.querySelector('.sys');
  focusable?.setAttribute('tabindex', '0');
  if (hadFocus && focusable && document.activeElement !== focusable) focusable.focus({preventScroll:true});
  wrap.$frame = f;
}
// Arrow keys: to the nearest gate neighbour (or region exit) in that direction, else the nearest system that way.
function moveFocus(svg, from, key) {
  const xy = el => el.getAttribute('transform').match(/-?[\d.]+/g).map(Number);
  const id = Number(from.dataset.system), sys = mapGraph()?.systems.get(id);
  const nodes = [...svg.querySelectorAll('.sys, .exit')].filter(n => n !== from);
  const linked = from.classList.contains('sys') ? nodes.filter(n => n.classList.contains('exit') ? Number(n.dataset.from) === id : sys?.links.includes(Number(n.dataset.system))) : nodes.filter(n => n.classList.contains('sys') && Number(n.dataset.system) === Number(from.dataset.from));
  const pick = list => neighbourByAngle(xy(from), list.map(n => ({id:n, xy:xy(n)})), key)?.id;
  const to = pick(linked) || pick(nodes.filter(n => n.classList.contains('sys')));
  if (!to) return;
  from.setAttribute('tabindex', '-1'); to.setAttribute('tabindex', '0'); to.focus({preventScroll:true});
  if (to.classList.contains('sys')) region?.reveal(Number(to.dataset.system), sheetCover());
}

// ── 3D ──
function labelsFor(g) {
  if (!regionLabels.has(g)) regionLabels.set(g, Object.keys(g.regions).map(Number).map(r => {
    const sysIn = [...g.systems.values()].filter(x => x.region === r && x.pos);
    return {text:regionName(r), n:sysIn.length, pos:sysIn.reduce((t, x) => t.map((v, i) => v + x.pos[i] / sysIn.length), [0, 0, 0])};
  }).filter(l => l.n).sort((a, b) => b.n - a.n));
  return regionLabels.get(g);
}
function draw3d(f, wrap) {
  const {g} = f;
  if (!wrap.querySelector('canvas')) {
    starMap?.destroy?.(); region?.detach(); region = null;
    wrap.innerHTML = '<canvas class="star-map"></canvas>';
    starMap = new StarMap(wrap.querySelector('canvas'), {reduced, onHover:(sys, x, y) => showTip(wrap.$frame, sys, x, y), onSelect:sys => select(sys.id)});
  }
  wrap.$frame = f;
  const universeView = M.view === 'universe';
  const inRegion = [...g.systems.values()].filter(x => x.region === M.region);
  const routeIds = M.layers.flatMap(l => l.ids);
  const focus = universeView ? null : new Set([...inRegion.map(x => x.id), ...routeIds, ...f.rangeIds]);
  const all = starMap.systemsRef?.length && starMap.graph === g ? starMap.systemsRef : [...g.systems.values()].filter(x => x.pos);
  starMap.set({g, systems:all, color:mapColor(g, f.overlay, f.k), focus, layers:M.layers, selected:M.selected, labels:universeView ? labelsFor(g) : [],
    summary:`${universeView ? 'New Eden' : regionName(M.region)} in 3D${M.selected ? `, ${g.systems.get(M.selected)?.name} selected` : ''}${M.layers.length ? `, ${plural(M.layers.length, 'layer')} shown` : ''}. Arrow keys turn, plus and minus zoom, Enter selects the system in the middle.`});
  const framed = `${M.view}:${M.region}:${routeIds.join()}`;
  if (wrap.dataset.framed !== framed) {
    const target = routeIds.length ? routeIds.map(id => g.systems.get(id)) : universeView ? all : inRegion;
    starMap.fly(target.filter(x => x?.pos), {snap:!wrap.dataset.framed});
    wrap.dataset.framed = framed;
  }
}

// ── List view: every system in the region as a sortable table. ──
const SERVICES = [[1, 'Factory'], [2, 'Lab'], [4, 'Market']];
const COLUMNS = [['name', 'System'], ['sec', 'Security'], ['shipKills', 'Kills 1 h'], ['kills24', 'Kills ~24 h'], ['kills7', 'Kills ~7 d'], ['jumps', 'Jumps 1 h'], ['belts', 'Belts'], ['stations', 'NPC stations'], ['industry', 'Build index'], ['special', 'Incursion / FW']];
function drawList(f, wrap) {
  const {g} = f, L = live(), meta = S.marketData?.meta?.data || {};
  starMap?.destroy?.(); starMap = null; region?.detach(); region = null; delete wrap.dataset.framed;
  const stations = new Map();
  for (const st of g.stations.values()) stations.set(st.system, [...(stations.get(st.system) || []), st]);
  const rows = [...g.systems.values()].filter(s => s.region === M.region).map(s => {
    const st = stations.get(s.id) || [], fw = L.fw[s.id], inc = L.incursions.get(s.id);
    return {id:s.id, name:s.name, sec:s.sec, shipKills:L.kills[s.id]?.ship_kills ?? 0, kills24:meta.risk?.s?.[s.id]?.[0], kills7:meta.risk?.s?.[s.id]?.[1], jumps:L.jumps[s.id] ?? 0, belts:s.belts || 0, stations:st.length,
      services:SERVICES.filter(([bit]) => st.some(x => x.flags & bit)).map(([, l]) => l).join(', '), industry:S.costIndices?.get(s.id)?.manufacturing,
      special:[inc ? `Incursion (${inc.state})` : '', fw ? `FW ${fw.contested === 'uncontested' ? 'uncontested' : `${Math.round(100 * fw.victory_points / (fw.victory_points_threshold || 1))}%`}` : ''].filter(Boolean).join(' · ')};
  });
  const sorted = sortRows(rows, listSort.key, listSort.dir);
  const dir = listSort.eff = listSort.dir || (typeof rows.find(r => r[listSort.key] != null)?.[listSort.key] === 'number' ? -1 : 1);
  const cell = (r, key) => key === 'name' ? `<th scope="row"><button type="button" class="link-btn" data-system="${r.id}">${esc(r.name)}</button></th>`
    : key === 'sec' ? `<td>${secLight(r.sec)}</td>` : key === 'industry' ? `<td class="num">${Number.isFinite(r.industry) ? `${(r.industry * 100).toFixed(2)}%` : '—'}</td>`
    : key === 'stations' ? `<td>${r.stations}${r.services ? ` <small>${esc(r.services)}</small>` : ''}</td>` : key === 'special' ? `<td>${esc(r.special) || '—'}</td>`
    : `<td class="num">${r[key] == null ? '—' : Math.round(r[key]).toLocaleString()}</td>`;
  wrap.innerHTML = `<div class="map-list"><table class="map-table"><caption class="sr-only">Systems in ${esc(regionName(M.region))}. Column buttons sort.</caption>
    <thead><tr>${COLUMNS.map(([key, label]) => `<th scope="col" aria-sort="${listSort.key === key ? (dir < 0 ? 'descending' : 'ascending') : 'none'}"><button type="button" class="link-btn" data-sort="${key}">${label}${listSort.key === key ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('')}</tr></thead>
    <tbody>${sorted.map(r => `<tr data-system="${r.id}"${r.id === M.selected ? ' class="selected" aria-current="true"' : ''}>${COLUMNS.map(([key]) => cell(r, key)).join('')}</tr>`).join('')}</tbody></table></div>`;
  wrap.$frame = f;
}

// ── Chrome around the map: breadcrumbs, the layer bar, the panel ──
function crumbs(g) {
  const sys = g.systems.get(M.selected), con = sys && sys.region === M.region ? g.constellations[sys.constellation] : null;
  $('#map-crumbs').innerHTML = `<button type="button" class="link-btn" data-crumb="universe"${M.view === 'universe' ? ' aria-current="page"' : ''}>New Eden</button><span aria-hidden="true">›</span><button type="button" class="link-btn" data-crumb="region"${M.view !== 'universe' && !con ? ' aria-current="page"' : ''}>${esc(regionName(M.region))}</button>${con ? `<span aria-hidden="true">›</span><button type="button" class="link-btn" data-crumb="constellation" data-id="${sys.constellation}">${esc(con[0])}</button>` : ''}`;
}
function layerBar() {
  const bar = $('#map-route'), many = M.layers.length > 1;
  bar.hidden = !M.layers.length;
  $('#map').toggleAttribute('data-layers', !!M.layers.length);
  bar.innerHTML = M.layers.length ? `${M.layers.map(l => `<div class="layer-row" style="--c:${l.color}"><i class="layer-chip" aria-hidden="true"></i><span class="layer-name">${esc(l.label)} · ${l.kind === 'route' ? plural(Math.max(0, l.ids.length - 1), 'jump') : plural(l.ids.length, 'system')}</span>
    <button type="button" class="secondary small" data-layer-fit="${l.id}" aria-label="Fit route" title="Fit route">Fit</button>${l.kind === 'route' ? autopilotButton(sendable(l.ids, [l.ids[0], l.ids.at(-1)]), `map-ap-${l.id}`, 'Autopilot') : ''}${many ? `<button type="button" class="secondary small" data-layer-remove="${l.id}" aria-label="Remove ${esc(l.label)}">✕</button>` : `<button type="button" class="secondary small" id="map-route-clear" aria-label="Clear route">✕</button>`}</div>`).join('')}${many ? '<button type="button" class="secondary small" id="map-route-clear">Clear all</button>' : ''}` : '';
}
function panel(f) {
  const body = $('#map-panel-body');
  body.innerHTML = M.selected ? systemPanel(M.selected) : `<h3>${esc(regionName(M.region))}</h3><p class="hint">Select a system for details.</p>`;
  if (f.range.length) body.innerHTML += `<h4>In jump range (${f.range.length})</h4><ul class="plain">${f.range.slice(0, 12).map(r => `<li><button type="button" class="link-btn" data-system="${r.system.id}">${secLight(r.system.sec)} ${esc(r.system.name)}</button><small>${r.ly.toFixed(2)} ly · ${esc(regionName(r.system.region))}</small></li>`).join('')}</ul>`;
}
// Phone bottom sheet: peek (a strip of the panel), half or full; the handle drags or cycles.
const SNAPS = ['peek', 'half', 'full'];
function setSnap(snap) {
  const p = $('#map-panel'), h = $('#map-sheet-handle');
  p.dataset.snap = snap; p.style.height = '';
  h.setAttribute('aria-expanded', String(snap !== 'peek'));
  h.setAttribute('aria-label', snap === 'full' ? 'Collapse the details sheet' : 'Expand the details sheet');
  if (snap === 'peek') $('#map-panel-body').scrollTop = 0;
  if (M.selected) requestAnimationFrame(() => region?.reveal(M.selected, sheetCover()));
}
// How much of the stage the sheet covers (0 on desktop).
function sheetCover() {
  if (!phone()) return 0;
  const s = $('#map-stage').getBoundingClientRect(), p = $('#map-panel').getBoundingClientRect();
  return Math.max(0, s.bottom - p.top);
}
function measure() {
  const stage = $('#map-stage'), view = $('#map');
  if (!stage || view.hidden) return;
  view.style.setProperty('--map-top', `${Math.round(stage.getBoundingClientRect().top + scrollY)}px`);
  const bar = $('#tabbar');
  if (phone() && bar?.offsetHeight) view.style.setProperty('--tabbar-h', `${bar.offsetHeight}px`);
}

// ── Draw ──
function paint() {
  const g = mapGraph(), wrap = $('#map-canvas-wrap');
  if (!g || !M.region) return renderMap();
  $('#map-tip').hidden = true;
  const regionSelect = $('#map-region');
  if (regionSelect.value !== String(M.region)) regionSelect.value = M.region;
  $('#map-view').value = M.view; $('#map-overlay').value = M.overlay; $('#map-jump').value = M.jump;
  $('#map').dataset.view = M.view;
  measure();
  const f = frameOf(g);
  $('#map-legend').innerHTML = legendHtml(f);
  layerBar(); crumbs(g);
  if (M.view === 'region') { starMap?.destroy?.(); starMap = null; delete wrap.dataset.framed; drawRegion(f, wrap); }
  else if (M.view === 'list') drawList(f, wrap);
  else draw3d(f, wrap);
  panel(f);
  $('#map-status').textContent = statusText(g);
  measure();
}
export async function renderMap() {
  const my = ++gen, status = $('#map-status');
  if (!S.backend) { status.textContent = 'The map needs the backend.'; return; }
  try { await loadMarket(); } catch (error) { status.textContent = `Map unavailable: ${error.message}`; return; }
  if (my !== gen) return;
  const g = mapGraph();
  if (!g || !Object.keys(g.regions).length || ![...g.systems.values()].some(x => x.pos)) {
    status.textContent = 'Map data (star positions, region layouts and stations) is still being built by the hourly pipeline. Reload in a few minutes.';
    $('#map-canvas-wrap').innerHTML = skeleton('Charting New Eden…'); return;
  }
  fillSystemList(g);
  const regionSelect = $('#map-region');
  if (!regionSelect.options.length) regionSelect.innerHTML = Object.keys(g.regions).map(Number).filter(r => [...g.systems.values()].some(s => s.region === r && s.p2)).sort((a, b) => regionName(a).localeCompare(regionName(b))).map(r => `<option value="${r}">${esc(regionName(r))}</option>`).join('');
  if (M.selected && !g.systems.has(M.selected)) M.selected = null;
  if (!M.region || !g.regions[M.region]) {
    const here = mine()?.ops?.location?.value?.solar_system_id;
    if (!M.selected && !M.region) M.selected = g.systems.has(here) ? here : 30000142;
    M.region = g.systems.get(M.selected)?.region || 10000002;
  }
  // Draw first with whatever live data there is; fill the overlays when the feeds arrive.
  paint();
  if (liveFresh()) return;
  const L = await mapLive();
  const missing = [...new Set([...Object.values(L.sov).map(x => x.alliance_id || x.faction_id), ...Object.values(L.fw).map(x => x.occupier_faction_id)])].filter(Boolean);
  await resolveNames(missing).catch(() => {});
  if (my === gen && currentView() === 'map') paint();
}

// Select a system: same region → classes change in place; another region on the region map → that region.
function select(id, {reveal = true} = {}) {
  const g = mapGraph(), s = g?.systems.get(id);
  if (!s) return;
  M.selected = id;
  if (M.view !== 'universe' && s.region !== M.region && (s.p2 || M.view !== 'region')) M.region = s.region;
  pushUrl();
  paint();
  if (phone() && $('#map-panel').dataset.snap === 'full') setSnap('peek');
  if (reveal) region?.reveal(id, sheetCover());
}
export function wire() {
  // Preferences first, then anything the address names (a shared link wins over this browser's habits).
  Object.assign(M, loadPrefs(localStorage));
  const h = location.hash.slice(1);
  if (isMapHash(h)) fromUrl(h);
  addEventListener('popstate', () => {
    const hash = location.hash.slice(1);
    if (!isMapHash(hash)) return;
    fromUrl(hash, true);
    if (currentView() === 'map') { if (mapGraph()) paint(); } else document.dispatchEvent(new CustomEvent('go', {detail:'map'}));
  });
  addEventListener('resize', () => { if (currentView() === 'map') measure(); });
  document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => {
    const k = Number(b.dataset.zoom);
    if (region && M.view === 'region') { if (k) region.zoom(k); else region.fit(); }
    else if (starMap && k) starMap.zoomBy(k);
    else if (starMap) { delete $('#map-canvas-wrap').dataset.framed; paint(); }
  });
  $('#map-stage [data-locate]').onclick = () => {
    const here = mine()?.ops?.location?.value?.solar_system_id;
    if (here && mapGraph()?.systems.has(here)) { if (M.view === 'list') M.view = 'region'; select(here); }
    else $('#map-status').textContent = 'Your location is unknown: connect your pilot to share it.';
  };
  $('#map-region').onchange = event => { M.region = Number(event.target.value); M.selected = null; pushUrl(); paint(); };
  $('#map-view').onchange = event => { M.view = event.target.value; pushUrl(); paint(); };
  $('#map-overlay').onchange = event => { M.overlay = event.target.value; pushUrl(true); paint(); };
  $('#map-jump').onchange = event => { M.jump = event.target.value; pushUrl(true); paint(); };
  $('#map-find').onsubmit = event => {
    event.preventDefault();
    const g = mapGraph(), q = $('#map-search').value.trim().toLowerCase();
    const hit = g && q && ([...g.systems.values()].find(x => x.name.toLowerCase() === q) || [...g.systems.values()].find(x => x.name.toLowerCase().startsWith(q)));
    if (!hit) { $('#map-status').textContent = `No system named “${$('#map-search').value}”.`; return; }
    M.region = hit.region; select(hit.id);
  };
  // Phones: the toolbar moves into the drawer sheet while it's open, and back when it closes.
  $('#map-layers-open').onclick = () => {
    const d = openDrawer({title:'Map layers', body:''});
    $('#drawer-body').append($('#map-controls'));
    d.addEventListener('close', () => $('#map-controls-home').append($('#map-controls')), {once:true});
  };
  const wrap = $('#map-canvas-wrap'), stage = $('#map-stage');
  // Region map and List view: one set of delegated listeners on the wrapper survives every redraw.
  wrap.addEventListener('click', event => {
    const sort = event.target.closest('[data-sort]');
    if (sort) { const key = sort.dataset.sort; listSort = listSort.key === key ? {key, dir:-(listSort.eff || 1)} : {key, dir:0}; paint(); wrap.querySelector(`[data-sort="${key}"]`)?.focus(); return; }
    const n = event.target.closest('[data-system]');
    if (n) { event.stopPropagation(); select(Number(n.dataset.system)); if (M.view === 'list') wrap.querySelector(`tr[data-system="${n.dataset.system}"] button`)?.focus(); }
  });
  wrap.addEventListener('keydown', event => {
    const n = event.target.closest?.('svg.region-map .sys, svg.region-map .exit');
    if (!n) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(Number(n.dataset.system)); return; }
    if (event.key.startsWith('Arrow')) { event.preventDefault(); moveFocus(n.ownerSVGElement, n, event.key); }
  });
  const tipAt = (n, x, y) => wrap.$frame && showTip(wrap.$frame, mapGraph()?.systems.get(Number(n.dataset.system)), x, y);
  wrap.addEventListener('pointerover', event => {
    const n = event.target.closest?.('svg.region-map .sys');
    if (!n || wrap.querySelector('[data-gesture]') || !(event.pointerType === 'mouse' || media('(hover: hover)'))) return;
    const r = stage.getBoundingClientRect(); tipAt(n, event.clientX - r.left, event.clientY - r.top);
  });
  wrap.addEventListener('pointerout', event => { if (event.target.closest?.('.sys') && !event.relatedTarget?.closest?.('.sys')) $('#map-tip').hidden = true; });
  wrap.addEventListener('focusin', event => {
    const n = event.target.closest?.('svg.region-map .sys');
    if (!n || !n.matches(':focus-visible')) return;
    const r = stage.getBoundingClientRect(), b = n.getBoundingClientRect(); tipAt(n, b.right - r.left - 10, b.top - r.top);
  });
  wrap.addEventListener('focusout', () => { $('#map-tip').hidden = true; });
  // Panel, layer bar and breadcrumbs.
  document.addEventListener('click', event => {
    const sys = event.target.closest('#map-panel [data-system]');
    if (sys) { event.preventDefault(); select(Number(sys.dataset.system)); }
    if (event.target.id === 'map-route-clear') { M.layers = []; paint(); }
    const rm = event.target.closest('[data-layer-remove]');
    if (rm) { M.layers = removeLayer(M.layers, rm.dataset.layerRemove); paint(); }
    const fit = event.target.closest('[data-layer-fit]');
    if (fit) {
      const l = M.layers.find(x => x.id === fit.dataset.layerFit), g = mapGraph();
      if (!l || !g) return;
      if (M.view === 'region') {
        const inside = l.ids.filter(id => g.systems.get(id)?.region === M.region);
        if (!inside.length) { M.region = g.systems.get(l.ids[0]).region; pushUrl(); paint(); region?.fitIds(l.ids.filter(id => g.systems.get(id)?.region === M.region)); }
        else region?.fitIds(inside);
      } else if (starMap) starMap.fly(l.ids.map(id => g.systems.get(id)).filter(s => s?.pos));
    }
    const crumb = event.target.closest('[data-crumb]');
    if (crumb) {
      const g = mapGraph(), kind = crumb.dataset.crumb;
      if ($('#drawer').open) $('#drawer').close();
      if (kind === 'universe') { M.view = 'universe'; pushUrl(); paint(); }
      else if (kind === 'region') { if (M.view === 'universe') { M.view = 'region'; pushUrl(); paint(); } else if (region) region.fit(); else { delete $('#map-canvas-wrap').dataset.framed; paint(); } }
      else if (kind === 'constellation' && g) {
        const ids = [...g.systems.values()].filter(s => s.constellation === Number(crumb.dataset.id)).map(s => s.id);
        if (M.view === 'universe' || M.view === 'list') { M.view = 'region'; pushUrl(); paint(); }
        if (region) region.fitIds(ids); else starMap?.fly(ids.map(id => g.systems.get(id)).filter(s => s?.pos));
      }
    }
  });
  // The sheet handle: tap cycles peek → half → full; drag follows the finger and snaps to the nearest stop.
  const handle = $('#map-sheet-handle'), sheet = $('#map-panel');
  let drag = null;
  handle.addEventListener('pointerdown', e => { drag = {y:e.clientY, h:sheet.getBoundingClientRect().height, moved:0}; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', e => {
    if (!drag) return;
    drag.moved = Math.max(drag.moved, Math.abs(e.clientY - drag.y));
    if (drag.moved > 6) { drag.to = Math.max(80, Math.min(innerHeight * 0.92, drag.h - (e.clientY - drag.y))); sheet.classList.add('dragging'); sheet.style.height = `${drag.to}px`; }
  });
  const end = e => {
    if (!drag) return;
    const {moved, to:h} = drag; drag = null; sheet.classList.remove('dragging');
    if (moved <= 6 || !h) { if (e.type === 'pointerup') setSnap(SNAPS[(SNAPS.indexOf(sheet.dataset.snap) + 1) % SNAPS.length]); return; }
    const stops = [112, innerHeight * 0.5, innerHeight * 0.88];
    setSnap(SNAPS[stops.reduce((best, s, i) => Math.abs(s - h) < Math.abs(stops[best] - h) ? i : best, 0)]);
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', e => {
    const d = {ArrowUp:1, ArrowDown:-1}[e.key];
    if (!d) return;
    e.preventDefault(); setSnap(SNAPS[Math.max(0, Math.min(2, SNAPS.indexOf(sheet.dataset.snap) + d))]);
  });
}
