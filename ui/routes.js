// Gate routes shared by every screen: the universe graph, one route cache, leg widgets, autopilot buttons.
import {graph, leg, secShown, secClass, dotlanSystem, dotlanRoute} from '../route.js';
import {secColor} from '../map.js';
import {S, HUB_SYSTEMS, mine} from './state.js';
import {name} from './esi.js';
import {$, esc, plural, routeAttrs, mapButton} from './shared.js';

let graphCache = null;
// The pipeline's gate graph, rebuilt only when a new market snapshot arrives (and with it a fresh route cache).
export const mapGraph = () => {
  const src = S.marketData?.universe;
  if (!src) return null;
  if (graphCache?.src !== src) graphCache = {src, g:graph(src), cache:new Map()};
  return graphCache.g;
};
// One cached gate route; safe=false allows low-sec, matching what the ranking used.
export const route = (from, to, safe = true) => { const g = mapGraph(); return g ? leg(g, from, to, graphCache.cache, {safe}) : null; };
export const routeCache = () => (mapGraph(), graphCache?.cache);
// System ids along a chain of stops; a stop with no route is kept so the trip still lists it.
export function routeIds(stops, safe = true) {
  const ids = stops.length ? [stops[0]] : [];
  for (let i = 1; i < stops.length; i++) ids.push(...(route(stops[i - 1], stops[i], safe)?.systems.slice(1).map(x => x.id) || [stops[i]]));
  return ids;
}
// The Worker sends at most 40 waypoints; past that only the stops go, and the game plots between them.
export const sendable = (routeIds, stops) => routeIds.length - 1 <= 40 ? routeIds.slice(1) : stops.slice(1);
export function autopilotButton(ids, out, short = '') {
  const pilot = mine(), can = pilot?.id && S.backend?.has(pilot.id), full = can ? `Send to ${esc(pilot.name)}’s autopilot` : '';
  return `${can && ids.length ? `<button type="button" data-waypoints="${ids.join(',')}" data-out="${out}"${short ? ` aria-label="${full}" title="${full}"` : ''}>${short ? esc(short) : full}</button>` : ''}<span id="${out}" class="hint" role="status"></span>`;
}
export function fillSystemList(g) {
  const list = $('#systems');
  if (!list.options.length) list.innerHTML = [...g.systems.values()].map(s => `<option value="${esc(s.name)}">`).join('');
}
export const hop = s => `<li class="sec-${secClass(s.sec)}" data-system="${s.id}" style="--c:${secColor(s.sec)}" title="${esc(s.name)} · security ${secShown(s.sec).toFixed(1)}"><span>${secShown(s.sec).toFixed(1)}</span>${esc(s.name)}</li>`;
export function legHtml(title, place, r, extra = '') {
  if (!r) return `<div class="leg"><div class="leg-head"><b>${title}</b><span>${esc(place || '')}</span><small>No gate route found from here.</small></div></div>`;
  const names = r.systems.map(s => s.name), ids = r.systems.map(s => s.id), label = `${title ? `${title}: ` : ''}${r.systems[0].name} → ${place}`;
  return `<div class="leg" ${routeAttrs(ids, label)}><div class="leg-head"><b>${title}</b><span>${esc(place)}</span><small>${r.jumps ? plural(r.jumps, 'jump') : 'same system'}${r.risky ? ` · <span class="neg">${r.risky} low-sec</span>` : ''}${extra}</small>${mapButton(ids, label)}<a href="${r.jumps ? dotlanRoute(names) : dotlanSystem(names[0])}" target="_blank" rel="noopener noreferrer">Dotlan ↗</a></div>${r.jumps ? `<ol class="hops">${r.systems.map(hop).join('')}</ol>` : ''}</div>`;
}
// The pilot's own system first, then the trade hubs.
export function systemOptions(select) {
  const p = mine(), here = p?.ops?.location?.value?.solar_system_id, prior = Number(select.value);
  const options = [...(here ? [[here, `${name(here)} · ${p.name}’s location`]] : []), ...HUB_SYSTEMS.filter(([id]) => id !== here)];
  select.innerHTML = options.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('');
  select.value = options.some(([id]) => id === prior) ? prior : options[0][0];
  return options;
}
export function wire() {
  document.addEventListener('click', async event => {
    const b = event.target.closest('[data-waypoints]');
    if (!b) return;
    const out = document.getElementById(b.dataset.out), pilot = mine();
    b.disabled = true; out.textContent = 'Sending…';
    try { const r = await S.backend.waypoints(pilot.id, b.dataset.waypoints.split(',').map(Number)); out.textContent = `Autopilot set: ${plural(r.waypoints, 'waypoint')}.`; }
    catch (error) { out.textContent = error.message; }
    b.disabled = false;
  });
}
export const regionName = id => mapGraph()?.regions[id] || name(id);
