// Who owns each NPC station (and which faction that corporation belongs to), for broker fees with standings.
// The universe map does not carry owners, so they come from ESI's /universe/stations/{id}/ (owner) and /corporations/{id}/
// (faction_id). Both are static, so every answer is kept in this browser and asked for once; failures are retried after a day.
import {levelOf} from '../model.js';
import {feeBook} from '../standings.js';
import {HUB_SYSTEMS, opsOf} from './state.js';
import {esi, corporation} from './esi.js';

const KEY = 'eve.station-owners:v1', FAILED_KEY = 'eve.station-owners-failed:v1', RETRY = 24 * 3600000;
const owners = new Map(), failed = new Map(), inflight = new Map();
try { for (const [loc, corp, faction] of JSON.parse(localStorage.getItem(KEY) || '[]')) owners.set(loc, [corp, faction]); } catch { /* Asked again. */ }
// A station ESI failed on is not asked again for 24 hours, across page loads, so a bad batch cannot burn ESI's error limit on every visit.
try { for (const [loc, at] of JSON.parse(localStorage.getItem(FAILED_KEY) || '[]')) failed.set(loc, at); } catch { /* Asked again. */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...owners].map(([loc, [corp, faction]]) => [loc, corp, faction]))); } catch { /* Cache is optional. */ } };
const saveFailed = () => { try { localStorage.setItem(FAILED_KEY, JSON.stringify([...failed])); } catch { /* Cache is optional. */ } };
const barred = (id, now) => failed.has(id) && now - failed.get(id) < RETRY;
export const isNpcStation = id => id >= 60000000 && id < 64000000;
export const ownerOf = loc => { const o = owners.get(loc); return o ? {corp:o[0], faction:o[1] || undefined} : undefined; };

// One request chain per station at a time: concurrent callers that want the same station share it.
function lookup(id) {
  if (!inflight.has(id)) inflight.set(id, (async () => {
    try {
      const corp = (await esi(`universe/stations/${id}/`)).owner;
      owners.set(id, [corp, corp ? (await corporation(corp)).faction_id || 0 : 0]); failed.delete(id); return true;
    } catch { failed.set(id, Date.now()); return false; }
    finally { inflight.delete(id); }
  })());
  return inflight.get(id);
}
/** Look up the owners of these NPC stations that are not known yet (four at a time). Resolves true when something new was learned. */
export async function resolveOwners(ids, now = Date.now()) {
  const todo = [...new Set(ids)].filter(id => isNpcStation(id) && !owners.has(id) && !barred(id, now)), queue = todo.values();
  let learned = false;
  await Promise.all(Array.from({length:Math.min(4, todo.length)}, async () => { for (const id of queue) if (await lookup(id)) learned = true; }));
  if (todo.length) { if (learned) save(); saveFailed(); }
  return learned;
}
/** One station per trade hub that the market scan covers: [{system, hub, loc}]. */
export function hubStations(book) {
  return HUB_SYSTEMS.map(([system, hub]) => ({system, hub, loc:[...book.stations].find(([, st]) => st.system === system)?.[0]})).filter(h => h.loc !== undefined);
}
/**
 * The fee book for a pilot: waits for the hubs' owners only. Stations of the rows on screen are learned afterwards with
 * learnOwners, so a book of hundreds of stations costs nothing. Only a pilot who has their own session here has standings;
 * a wingmate's fee is skills only.
 */
export async function brokerFor(pilot, skills, ids, book) {
  const hubs = hubStations(book);
  await resolveOwners(hubs.map(h => h.loc));
  const standings = opsOf(pilot).standings?.value;
  return {hubs, ...feeBook({level:levelOf(skills, ids?.brokerRelations), standings:Array.isArray(standings) ? standings : undefined, owner:ownerOf})};
}
/** Learn the owners of the stations the visible rows use, in the background; onMore runs when it found any (the caller redraws). */
export const learnOwners = (locs, onMore) => resolveOwners(locs).then(learned => { if (learned) onMore?.(); }, () => {});
export const brokerNote = x => x.applied ? `standing ${x.faction.toFixed(1)} with the faction, ${x.corp.toFixed(1)} with the corporation` : 'standings not applied';
