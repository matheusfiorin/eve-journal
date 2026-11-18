// Who owns each NPC station (and which faction that corporation belongs to), for broker fees with standings.
// The universe map does not carry owners, so they come from ESI's /universe/stations/{id}/ (owner) and /corporations/{id}/
// (faction_id). Both are static, so every answer is kept in this browser and asked for once.
import {levelOf} from '../model.js';
import {feeBook} from '../standings.js';
import {HUB_SYSTEMS, opsOf} from './state.js';
import {esi, corporation} from './esi.js';

const KEY = 'eve.station-owners:v1';
const owners = new Map(), failed = new Set();
try { for (const [loc, corp, faction] of JSON.parse(localStorage.getItem(KEY) || '[]')) owners.set(loc, [corp, faction]); } catch { /* Asked again. */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...owners].map(([loc, [corp, faction]]) => [loc, corp, faction]))); } catch { /* Cache is optional. */ } };
export const isNpcStation = id => id >= 60000000 && id < 64000000;
export const ownerOf = loc => { const o = owners.get(loc); return o ? {corp:o[0], faction:o[1] || undefined} : undefined; };

/** Look up the owners of these NPC stations that are not known yet (four at a time). Resolves true when something new was learned. */
export async function resolveOwners(ids) {
  const todo = [...new Set(ids)].filter(id => isNpcStation(id) && !owners.has(id) && !failed.has(id)), queue = todo.values();
  let learned = false;
  await Promise.all(Array.from({length:Math.min(4, todo.length)}, async () => { for (const id of queue) {
    try {
      const corp = (await esi(`universe/stations/${id}/`)).owner;
      owners.set(id, [corp, corp ? (await corporation(corp)).faction_id || 0 : 0]); learned = true;
    } catch { failed.add(id); /* Not applied for this station until the page is reloaded. */ }
  } }));
  if (learned) save();
  return learned;
}
/** One station per trade hub that the market scan covers: [{system, hub, loc}]. */
export function hubStations(book) {
  return HUB_SYSTEMS.map(([system, hub]) => ({system, hub, loc:[...book.stations].find(([, st]) => st.system === system)?.[0]})).filter(h => h.loc !== undefined);
}
/**
 * The fee book for a pilot: waits for the hubs' owners, and looks up the rest in the background (onMore runs when it found any).
 * Only a pilot who has their own session here has standings; a wingmate's fee is skills only.
 */
export async function brokerFor(pilot, skills, ids, book, onMore) {
  const hubs = hubStations(book);
  await resolveOwners(hubs.map(h => h.loc));
  resolveOwners([...book.stations.keys()]).then(learned => { if (learned) onMore?.(); }, () => {});
  const standings = opsOf(pilot).standings?.value;
  return {hubs, ...feeBook({level:levelOf(skills, ids?.brokerRelations), standings:Array.isArray(standings) ? standings : undefined, owner:ownerOf})};
}
export const brokerNote = x => x.applied ? `standing ${x.faction.toFixed(1)} with the faction, ${x.corp.toFixed(1)} with the corporation` : 'standings not applied';
