// The web's planners for the Android app: one script (bundled by scripts/bundle-android.mjs into
// android/app/src/main/assets/planners.js) that QuickJS evaluates once. Kotlin calls
// EchelonPlanners.call(name, args) with plain JSON-shaped values and gets a JSON string back; everything that is
// not JSON (the graph's Maps, typed arrays) stays inside the engine.
//
// To expose another planner function, add an entry to `api` that turns JSON arguments into the module's inputs and
// its result back into JSON, then run `npm run bundle:android`. The modules themselves are not changed.
import * as route from '../../route.js';
import * as exploration from '../../exploration.js';
import * as industry from '../../industry.js';
import * as mining from '../../mining.js';
import * as market from '../../market.js';
import * as hauling from '../../hauling.js';
import * as sell from '../../sell.js';
import * as fit from '../../fit.js';
import * as jobs from '../../jobs.js';

// The gate map is about 1 MB: it is loaded once with universe.load and kept, with its graph.
let universe = null, g = null;
const need = () => { if (!g) throw new Error('Load the universe first (universe.load).'); return g; };
const systemOut = s => s && {id:s.id, name:s.name, sec:s.sec, region:s.region};

const api = {
  'universe.load': ({universe:u}) => { universe = u; g = route.graph(u); return {systems:g.systems.size, version:u?.version ?? null}; },
  'universe.loaded': () => ({loaded:Boolean(g), systems:g ? g.systems.size : 0}),
  // A jump list from one system to another; safe avoids low/null-sec where it can (route.paths' default).
  'route.path': ({from, to, safe = true}) => route.paths(need(), from, {safe}).path(to),
  // One leg with its systems and the count of risky (non high-sec) systems, as the web's route lists show it.
  'route.leg': ({from, to, safe = true}) => { const l = route.leg(need(), from, to, new Map(), {safe}); return l && {jumps:l.jumps, risky:l.risky, systems:l.systems.map(systemOut)}; },
  // Jumps from one system to every system within max (whatever the security), as {systemId: jumps}.
  'route.within': ({from, max = 5}) => { const d = route.hops(need(), from, max), ids = [...route.systemIndex(need()).keys()], out = {}; ids.forEach((id, i) => { if (d[i] >= 0) out[id] = d[i]; }); return out; },
  'route.secShown': ({sec}) => route.secShown(sec),
  // The Fly feature. A fit's rows are [type_id, location_flag, quantity]; `charges` lists the type ids whose category is
  // Charge (the app looks them up), and `names` maps type id to name for the EFT text.
  'fit.groups': ({items, charges = []}) => { const c = new Set(charges), catOf = id => c.has(id) ? 'Charge' : null; return {groups:fit.fitGroups(items, catOf), counts:fit.fitCounts(items, catOf), slots:fit.SLOTS}; },
  'fit.eft': ({ship, title, items, names = {}, charges = []}) => { const c = new Set(charges); return fit.eft({ship, title, items, nameOf:id => names[id] ?? `#${id}`, catOf:id => c.has(id) ? 'Charge' : null}); },
  // Every pilot's industry jobs in one list (ready first), with slot use: pilots are [{name, jobs, skills}], skills as ESI sends them.
  'jobs.wing': ({pilots = [], now = Date.now()}) => jobs.wingJobs(pilots.map(p => ({name:p.name, jobs:p.jobs || [], levels:p.skills?.skills ? industry.skillLevels(p.skills, industry.SLOT_SKILLS) : null})), now),
};

// Every planner module stays reachable for the Plan agent's adapters, and keeps esbuild from dropping it.
const modules = {route, exploration, industry, mining, market, hauling, sell, fit, jobs};

globalThis.EchelonPlanners = {
  version: 1,
  names: () => JSON.stringify(Object.keys(api)),
  modules: () => JSON.stringify(Object.fromEntries(Object.entries(modules).map(([k, m]) => [k, Object.keys(m).sort()]))),
  call(name, args) {
    const fn = api[name];
    if (!fn) throw new Error(`Unknown planner call ${name}`);
    return JSON.stringify(fn(args ?? {}) ?? null);
  },
};
