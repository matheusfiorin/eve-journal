// Plan → Explore for the Android app: the web's exploration tab (ui/screens/earn.js renderExploration) without the HTML.
// Ranks systems to scan, builds tonight's loop through the best ones, picks the explorer hull and the skills to train,
// and lists EVE-Scout's wormhole shortcuts. The app passes plain JSON; the gate map and region-0 meta stay in the engine.
import {levelOf} from '../../../model.js';
import {BANDS, rankSystems, visitedMap, nextSkills, explorerFor, shortcuts} from '../../../exploration.js';
import {plan as routePlan} from '../../../hauling.js';
import {secClass} from '../../../route.js';

const out = s => s && {id:s.id, name:s.name, sec:s.sec, region:s.region};
const LABEL = {astrometrics:'Astrometrics', hacking:'Hacking', archaeology:'Archaeology', cpuManagement:'CPU Management', rangefinding:'Astrometric Rangefinding', survey:'Survey',
  pinpointing:'Astrometric Pinpointing', acquisition:'Astrometric Acquisition', cloaking:'Cloaking', covertOps:'Covert Ops'};

/** A skill level reader in the web's terms: meta.skills names the type ids; the frigate key takes the best racial frigate. */
export function leveler(skills, meta) {
  const ids = meta?.skills || {};
  const level = key => key === 'frigate' ? Math.max(...['amarrFrigate', 'caldariFrigate', 'gallenteFrigate', 'minmatarFrigate'].map(k => level(k))) : levelOf(skills, ids[key]);
  return level;
}

export const api = ({graph, meta}) => ({
  /**
   * {from, maxJumps, tolerance, bands:[hi|low|null], loop, skills?, trails:[[[id, at]…]…], marks:[[id, at]…], now}
   * → {start, rows, loop, explorer, train, visited, trafficHours, bands}
   */
  'explore.rank': ({from, maxJumps = 10, tolerance = 'normal', bands = ['hi'], loop: loopSize = 5, skills = null, trails = [], marks = [], now = Date.now()}) => {
    const g = graph(), m = meta(), band = new Set(bands.filter(b => b in BANDS));
    const start = g.systems.get(from);
    if (!start) return {error:'unknown-system'};
    const safe = !band.has('low') && !band.has('null');
    const visited = visitedMap(...trails, marks);
    const traffic = m.traffic?.s || {}, kills = Object.fromEntries(Object.entries(m.risk?.s || {}).map(([id, v]) => [id, v[0]]));
    const hour = {jumps:Object.fromEntries(Object.entries(m.activity || {}).map(([id, a]) => [id, a[2]])), kills:Object.fromEntries(Object.entries(m.activity || {}).map(([id, a]) => [id, a[0]]))};
    const ranked = band.size ? rankSystems(g, from, {traffic, kills, hour, bands:band, maxJumps, visited, tolerance, now, limit:20}) : [];
    const best = Math.max(1e-9, ...ranked.map(r => r.score));
    const picks = ranked.filter(r => r.system.id !== from).slice(0, loopSize).map(r => r.system.id);
    const plan = picks.length ? routePlan(g, [from, ...picks], {history:m.risk?.s || {}, traffic:hour.jumps, value:0, hull:'t1'}, {mode:'safest', optimize:true, end:'return', lowsec:!safe}) : null;
    const loop = plan && !plan.unreachable ? {stops:plan.stops.slice(1, -1).map(id => out(g.systems.get(id))), route:plan.route, jumps:plan.jumps, survival:plan.survival,
      minutes:Math.round(plan.jumps + (plan.stops.length - 2) * 12)} : null;
    const level = leveler(skills, m), explorer = explorerFor(level);
    return {
      start:out(start), safe,
      rows:ranked.map(r => ({system:out(r.system), jumps:r.jumps, traffic:Math.round(r.traffic), kills:Math.round(r.kills * 10) / 10, quiet:r.quiet, safe:r.safe,
        deadEnd:r.deadEnd, visited:r.visited ?? null, pirates:r.pirates, score:Math.max(1, Math.round(100 * r.score / best)), band:secClass(r.system.sec)})),
      loop,
      explorer:{ship:explorer.ship, race:explorer.race, typeId:explorer.id, level:skills?.skills ? explorer.level : null},
      train:skills?.skills ? nextSkills(level).map(k => ({...k, name:k.key === 'frigate' ? `${explorer.race} Frigate` : LABEL[k.key] || k.key})) : [],
      visited:visited.size,
      trafficHours:m.traffic?.since ? Math.max(0, (now - m.traffic.since) / 3600000) : 0,
    };
  },
  // A row's route preview uses route.leg (planners.js).
  /** EVE-Scout's signatures (as its API returns them) → the Thera/Turnur connections near `from`. */
  'explore.shortcuts': ({from, signatures = [], maxJumps = 15}) => shortcuts(graph(), from, signatures, {maxJumps})
    .map(c => ({hub:c.hub, system:out(c.system), jumps:c.jumps, size:c.size ?? null, hours:c.hours ?? null, signature:c.signature ?? null, lowsec:c.lowsec})),
});
