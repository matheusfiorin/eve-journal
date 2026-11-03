// Star map state that outlives a render: the address (#navigate/map?r=…&s=…), remembered preferences, the layer list,
// keyboard moves between systems and the text level of detail. Pure functions (no DOM), unit-tested in tests/mapstate.test.js.

export const VIEWS = {region:'region', region3d:'3d', universe:'universe', list:'list'};
const VIEW_OF = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [v, k]));
export const OVERLAY_IDS = ['security', 'danger', 'shipKills', 'podKills', 'npcKills', 'jumps', 'kills24', 'kills7', 'jumps24', 'sov', 'fw', 'incursion', 'industry', 'belts', 'stations'];
export const JUMP_IDS = ['', 'blops', 'jf', 'capital', 'super'];
export const DEFAULTS = {view:'region', overlay:'security', jump:''};
const id = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

// "navigate/map?r=10000002&s=30000142&o=shipKills&j=jf&v=3d" (or just the query) → the parts it names.
// Unknown or malformed values are dropped, so a hand-edited link can't put the map in a bad state.
export function parseMapHash(hash = '') {
  const q = String(hash).replace(/^#/, '');
  const i = q.indexOf('?');
  const params = new URLSearchParams(i < 0 ? (q.includes('=') ? q : '') : q.slice(i + 1));
  const out = {};
  if (id(params.get('r'))) out.region = id(params.get('r'));
  if (id(params.get('s'))) out.selected = id(params.get('s'));
  if (OVERLAY_IDS.includes(params.get('o'))) out.overlay = params.get('o');
  if (params.has('j') && JUMP_IDS.includes(params.get('j'))) out.jump = params.get('j');
  if (VIEW_OF[params.get('v')]) out.view = VIEW_OF[params.get('v')];
  return out;
}
// The query for a map state, defaults left out: "r=10000002&s=30000142&o=shipKills".
export function serializeMapHash({region, selected, overlay = DEFAULTS.overlay, jump = DEFAULTS.jump, view = DEFAULTS.view} = {}) {
  const p = new URLSearchParams();
  if (region) p.set('r', region);
  if (selected) p.set('s', selected);
  if (overlay && overlay !== DEFAULTS.overlay) p.set('o', overlay);
  if (jump) p.set('j', jump);
  if (view && view !== DEFAULTS.view && VIEWS[view]) p.set('v', VIEWS[view]);
  return p.toString();
}

// Remembered per browser: which view, overlay and jump range the map opens with. Storage may throw (private mode).
export const PREFS_KEY = 'eve-map:v1';
export function loadPrefs(storage) {
  try {
    const raw = JSON.parse(storage.getItem(PREFS_KEY)) || {};
    const out = {};
    if (VIEWS[raw.view]) out.view = raw.view;
    if (OVERLAY_IDS.includes(raw.overlay)) out.overlay = raw.overlay;
    if (JUMP_IDS.includes(raw.jump)) out.jump = raw.jump;
    return out;
  } catch { return {}; }
}
export function savePrefs(storage, {view, overlay, jump}) {
  try { storage.setItem(PREFS_KEY, JSON.stringify({view, overlay, jump})); return true; } catch { return false; }
}

// Layers drawn over the map: routes, pins, trails and rings, each with its own colour. The newest is last;
// past MAX_LAYERS the oldest is dropped. Adding a layer with the same ids and label replaces it instead.
export const MAX_LAYERS = 4;
export const LAYER_COLORS = ['#A99BFF', '#5CD3DE', '#F0BB5C', '#FF6FAE', '#62D99B'];
export function addLayer(layers, {label = 'Route', kind = 'route', ids = [], color} = {}) {
  const clean = ids.map(Number).filter(Number.isSafeInteger);
  const same = layers.find(l => l.kind === kind && l.label === label && l.ids.join() === clean.join());
  if (same) return layers;
  const kept = layers.slice(-(MAX_LAYERS - 1));
  const used = new Set(kept.map(l => l.color));
  const layer = {id:`L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label, kind, ids:clean, color:color || LAYER_COLORS.find(c => !used.has(c)) || LAYER_COLORS[0]};
  return [...kept, layer];
}
export const removeLayer = (layers, layerId) => layers.filter(l => l.id !== layerId);
// Where a route enters and leaves one region: the runs of consecutive systems inside it, and for each run the
// system just outside it on either end (so the map can point at the exit and say how many jumps remain).
export function routeInRegion(ids, inside) {
  const runs = [];
  let run = null;
  ids.forEach((sys, i) => {
    if (inside(sys)) { if (!run) runs.push(run = {start:i, ids:[]}); run.ids.push(sys); run.end = i; }
    else run = null;
  });
  return runs.map(r => ({ids:r.ids, from:r.start > 0 ? ids[r.start - 1] : null, to:r.end < ids.length - 1 ? ids[r.end + 1] : null, remaining:ids.length - 1 - r.end, before:r.start}));
}

// Keyboard moves on the region map: from one point, the closest candidate in the arrow's direction
// (within ±60°), preferring straight ahead. candidates: [{id, xy}]. Screen y grows downward.
const DIRS = {ArrowRight:0, ArrowDown:Math.PI / 2, ArrowLeft:Math.PI, ArrowUp:-Math.PI / 2};
export function neighbourByAngle(from, candidates, key) {
  const dir = DIRS[key];
  if (dir === undefined) return null;
  let best = null, bestScore = Infinity;
  for (const c of candidates) {
    const dx = c.xy[0] - from[0], dy = c.xy[1] - from[1], d = Math.hypot(dx, dy);
    if (!d) continue;
    let off = Math.abs(Math.atan2(dy, dx) - dir);
    if (off > Math.PI) off = 2 * Math.PI - off;
    if (off > Math.PI / 3) continue;
    const score = d * (1 + 2 * off);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Text level of detail from screen pixels per map unit: below 0.8 security values go, below 0.6 names too.
export const lod = scale => scale < 0.6 ? 'min' : scale < 0.8 ? 'low' : 'full';

// Sort rows of the List view: by a key, numbers descending first (most kills on top), text ascending.
export function sortRows(rows, key, dir = 0) {
  const sign = dir || (typeof rows.find(r => r[key] !== undefined && r[key] !== null)?.[key] === 'number' ? -1 : 1);
  return [...rows].sort((a, b) => {
    const x = a[key] ?? (sign < 0 ? -Infinity : ''), y = b[key] ?? (sign < 0 ? -Infinity : '');
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sign;
  });
}
