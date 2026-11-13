// Runs the Haul plan's three route searches off the main thread. Planning with the best stop order searches the gate
// map dozens of times, which froze the page for seconds on a phone, so a module Worker (ui/haulworker.js) does it and
// the page shows "Planning…" meanwhile. If a Worker can't start, or fails, the same code runs here instead.
import {graph} from '../route.js';
import {MODES, plan} from '../hauling.js';

// All three modes for one trip. Pure: the Worker and the fallback both call this.
export const planModes = (g, stops, ctx, options) => Object.fromEntries(Object.keys(MODES).map(mode => [mode, plan(g, stops, ctx, {...options, mode})]));

// What the plans need from the market snapshot besides the stops: the gate map, kill history and traffic. It goes to the
// Worker once per snapshot (key), not with every plan.
let keys = 0;
const snapshots = new WeakMap();
export function snapshotOf(marketData) {
  if (!snapshots.has(marketData)) {
    const meta = marketData.meta?.data || {};
    snapshots.set(marketData, {key:++keys, universe:marketData.universe, history:meta.risk?.s || {}, traffic:Object.fromEntries(Object.entries(meta.activity || {}).map(([id, a]) => [id, a[2]]))});
  }
  return snapshots.get(marketData);
}

// Steps carry whole system records; across the Worker they travel as ids and are looked up in the page's own graph.
const slim = plans => Object.fromEntries(Object.entries(plans).map(([mode, p]) => [mode, p.steps ? {...p, steps:p.steps.map(s => ({...s, system:s.system.id}))} : p]));
const fatten = (plans, g) => { for (const p of Object.values(plans)) if (p.steps) for (const s of p.steps) s.system = g.systems.get(s.system); return plans; };
export const forWorker = slim; // the Worker's side of the same trip

let worker = null, broken = false, sent = 0, calls = 0;
const waiting = new Map();
function fail(error) {
  broken = true; worker?.terminate(); worker = null; sent = 0;
  for (const [, w] of waiting) { clearTimeout(w.timer); w.reject(error); }
  waiting.clear();
}
function start() {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL('./haulworker.js', import.meta.url), {type:'module'});
    worker.onmessage = ({data}) => {
      const w = waiting.get(data.id); if (!w) return;
      waiting.delete(data.id); clearTimeout(w.timer);
      if (data.error) w.reject(new Error(data.error)); else w.resolve(data.plans);
    };
    worker.onerror = event => fail(new Error(event.message || 'The route planner failed to start.'));
    worker.onmessageerror = () => fail(new Error('The route planner sent something unreadable.'));
  } catch { broken = true; worker = null; }
  return worker;
}
const viaWorker = (snapshot, stops, ctx, options) => new Promise((resolve, reject) => {
  const w = start();
  if (!w) { reject(new Error('No Worker.')); return; }
  const id = ++calls, timer = setTimeout(() => fail(new Error('The route planner took too long.')), 30000);
  waiting.set(id, {resolve, reject, timer});
  if (sent !== snapshot.key) { w.postMessage({setup:snapshot}); sent = snapshot.key; }
  w.postMessage({id, key:snapshot.key, stops, ctx, options});
});
// Plan every mode for `stops` (system ids) on the page's gate graph `g`. ctx: {value, hull, live, now}; options: {lowsec, avoid, optimize, end}.
export async function planAll(g, snapshot, stops, ctx, options) {
  if (!broken) {
    try { return fatten(await viaWorker(snapshot, stops, ctx, options), g); }
    catch { /* Plan here instead. */ }
  }
  await new Promise(resolve => setTimeout(resolve)); // let "Planning…" paint before the page is busy
  return planModes(g, stops, {history:snapshot.history, traffic:snapshot.traffic, ...ctx}, options);
}
// Used by the Worker.
export const workerGraph = snapshot => ({g:graph(snapshot.universe), history:snapshot.history, traffic:snapshot.traffic});
