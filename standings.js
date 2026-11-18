// Broker fees with standings. Pure functions; ui/brokers.js finds each station's owner.
// Formula and floor: EVE University, "Trading" (https://wiki.eveuniversity.org/Trading, section on broker's fees):
//   broker's fee = 3% − 0.3% × Broker Relations level − 0.03% × faction standing − 0.02% × corporation standing,
// using the unmodified standings (skills that boost standings change nothing). Best case is 1.0% (level V, 10.0 and 10.0),
// so 1% is the floor here. The wiki's own minimum is 100 ISK per order, which this planner does not model.
export const BROKER = {base:0.03, perLevel:0.003, perFaction:0.0003, perCorp:0.0002, floor:0.01};
const clamp = v => Math.max(-10, Math.min(10, Number.isFinite(v) ? v : 0));
export function brokerFee(level = 0, faction = 0, corp = 0) {
  return Math.max(BROKER.floor, BROKER.base - BROKER.perLevel * level - BROKER.perFaction * clamp(faction) - BROKER.perCorp * clamp(corp));
}
// The pilot's standing toward one NPC faction or corporation. rows: [[from_id, from_type, standing]] as the Worker stores them.
export const standingOf = (rows, id, type) => rows?.find(r => r[0] === id && r[1] === type)?.[2] ?? 0;
/**
 * The fee at each station for one pilot. owner(loc) gives {corp, faction} for an NPC station (faction may be missing for
 * a corporation without one) or nothing when it is not known; standings is the stored list, or undefined when it was not read.
 * Returns {at(loc), explain(loc)}: explain says how the figure came about, and applied is false whenever standings could not be used.
 */
export function feeBook({level = 0, standings, owner}) {
  const explain = loc => {
    const o = Array.isArray(standings) ? owner?.(loc) : null;
    if (!o?.corp) return {fee:brokerFee(level), applied:false, why:Array.isArray(standings) ? 'owner unknown' : 'standings not read'};
    const faction = o.faction ? standingOf(standings, o.faction, 'faction') : 0, corp = standingOf(standings, o.corp, 'npc_corp');
    return {fee:brokerFee(level, faction, corp), applied:true, faction, corp, factionId:o.faction, corpId:o.corp};
  };
  return {at:loc => explain(loc).fee, explain};
}
