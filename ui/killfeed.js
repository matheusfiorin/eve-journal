// Live zKillboard kills per region and the stargates they happened at, shared by the Haul plan and the Star map's
// Danger overlay. Both caches live for the page; a region's kills are refetched after 5 minutes.
import {esi, json} from './esi.js';

const killCache = new Map(), gateCache = new Map();
// The last hour of kills in a region, straight from zKillboard.
export async function regionKills(region) {
  const hit = killCache.get(region);
  if (hit && Date.now() - hit.at < 300000) return hit.kills;
  const kills = await json(`https://zkillboard.com/api/regionID/${region}/pastSeconds/3600/`, {headers:{Accept:'application/json'}});
  killCache.set(region, {at:Date.now(), kills:Array.isArray(kills) ? kills : []});
  return killCache.get(region).kills;
}
// Whatever is cached for a region right now, without fetching (null when nothing is, or it's older than 5 minutes).
export function cachedKills(region) {
  const hit = killCache.get(region);
  return hit && Date.now() - hit.at < 300000 ? hit.kills : null;
}
// Stargate → the system it leads to, so a camp can be pinned to the gate it sits on.
export async function gateTargets(ids) {
  await Promise.all([...new Set(ids)].filter(id => !gateCache.has(id)).slice(0, 60).map(async id => {
    try { gateCache.set(id, (await esi(`universe/stargates/${id}/`)).destination?.system_id); } catch { gateCache.set(id, undefined); }
  }));
  return new Map([...gateCache].filter(([, to]) => to));
}
