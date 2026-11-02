// Exploration: rank nearby systems by how little traffic they see, how safe they are and whether you were there lately.
// ESI has no signature counts, so "least explored" is measured by its best public proxy: jumps through the system.
import {paths, secClass} from './route.js';
import {faction} from './mining.js';

// Security bands a pilot can explore. Wormholes come from EVE-Scout's Thera/Turnur connections, not this ranking.
export const BANDS = {hi:'High-sec', low:'Low-sec', null:'Null-sec'};
export const TOLERANCE = {careful:0.5, normal:0.25, bold:0.1};
const PIRATES = {amarr:'Sansha / Blood Raiders', caldari:'Guristas', gallente:'Serpentis', minmatar:'Angel Cartel'};
export const pirates = region => PIRATES[faction(region)] || 'Varies by region';

// traffic: jumps over ~24 h per system; kills: ship kills over ~24 h; hour: {jumps, kills} from the last hour as a fallback.
export function rankSystems(g, from, {traffic = {}, kills = {}, hour = {}, bands = new Set(['hi']), maxJumps = 10, visited = new Map(), tolerance = 'normal', now = Date.now(), limit = 20} = {}) {
  const route = paths(g, from, {safe:!bands.has('low') && !bands.has('null')}), out = [];
  for (const system of g.systems.values()) {
    const band = secClass(system.sec);
    if (!bands.has(band)) continue;
    const list = route.path(system.id);
    if (!list || list.length - 1 > maxJumps) continue;
    if (!bands.has('low') && !bands.has('null') && list.some(id => secClass(g.systems.get(id).sec) !== 'hi')) continue;
    const jumps = list.length - 1;
    const day = traffic[system.id] ?? (hour.jumps?.[system.id] || 0) * 24;
    const dead = kills[system.id] ?? (hour.kills?.[system.id] || 0) * 6;
    // Each factor is 0–1 (dead ends a little more): quiet, safe, close, and not just visited.
    const quiet = 1 / (1 + day / 150);
    const safe = Math.exp(-dead * TOLERANCE[tolerance]) * (band === 'hi' || tolerance === 'bold' ? 1 : band === 'low' ? 0.75 : 0.6);
    const pocket = system.links.length === 1 ? 1.25 : system.links.length === 2 ? 1.08 : 1;
    const near = Math.exp(-jumps / 10);
    const seen = visited.get(system.id), ago = seen ? (now - seen) / 3600000 : Infinity;
    const fresh = ago < 24 ? 0.15 : ago < 72 ? 0.6 : 1;
    out.push({system, jumps, traffic:day, kills:dead, deadEnd:system.links.length === 1, visited:seen, quiet, safe, score:quiet * safe * pocket * near * fresh, pirates:pirates(system.region)});
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Systems either pilot was seen in (trail entries are [systemId, time]) and systems marked by hand; newest wins.
export function visitedMap(...sources) {
  const out = new Map();
  for (const list of sources) for (const [id, at] of list || []) if (!(out.get(id) >= at)) out.set(id, at);
  return out;
}

// What to train for relic and data sites, then for leaving high-sec.
const PLAN = [
  ['astrometrics', 3, 'Stronger probes and faster scans: find sites at all'],
  ['hacking', 3, 'Data sites: more virus coherence'],
  ['archaeology', 3, 'Relic sites: more virus coherence'],
  ['frigate', 3, 'Your race’s exploration frigate (Heron, Imicus, Magnate or Probe) with better bonuses'],
  ['cpuManagement', 3, 'Room to fit analyzers and a scanner on a frigate'],
  ['rangefinding', 3, '+5% scan strength per level'],
  ['survey', 3, 'Longer ship scanner range to spot cans'],
  ['astrometrics', 4, 'Needed for Astrometric Pinpointing and the covert-ops path'],
  ['pinpointing', 2, 'Smaller probe deviation: fewer scans per site'],
  ['acquisition', 2, 'Faster probe scans'],
  ['cloaking', 4, 'Covert Ops Cloaking Device: warp cloaked, the way to survive low and null'],
  ['covertOps', 1, 'Astero or covert-ops frigates for low-sec, null-sec and wormholes']
];
export function nextSkills(level, count = 4) {
  return PLAN.filter(([key, lvl]) => level(key) < lvl).slice(0, count).map(([key, lvl, why]) => ({key, from:level(key), level:lvl, why}));
}
// The race whose frigate skill is highest picks the hull.
export const EXPLORERS = {caldariFrigate:{race:'Caldari', ship:'Heron', id:605}, gallenteFrigate:{race:'Gallente', ship:'Imicus', id:607}, amarrFrigate:{race:'Amarr', ship:'Magnate', id:29248}, minmatarFrigate:{race:'Minmatar', ship:'Probe', id:586}};
export function explorerFor(level) {
  return Object.entries(EXPLORERS).map(([key, e]) => ({...e, key, level:level(key)})).sort((a, b) => b.level - a.level)[0];
}

// EVE-Scout's live Thera/Turnur connections that open into known space near you.
export function shortcuts(g, from, signatures, {maxJumps = 15, limit = 8} = {}) {
  const route = paths(g, from, {safe:false}), out = [];
  for (const s of signatures || []) {
    if (s.signature_type !== 'wormhole' || !g.systems.has(s.in_system_id)) continue;
    const list = route.path(s.in_system_id);
    if (!list || list.length - 1 > maxJumps) continue;
    out.push({hub:s.out_system_name, system:g.systems.get(s.in_system_id), jumps:list.length - 1, size:s.max_ship_size, hours:s.remaining_hours, type:s.wh_type, signature:s.in_signature,
      lowsec:list.some(id => secClass(g.systems.get(id).sec) !== 'hi')});
  }
  return out.sort((a, b) => a.jumps - b.jumps).slice(0, limit);
}
