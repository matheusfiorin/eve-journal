// Planetary colonies from a pilot's stored planets: [{id, type, system, level, num, updated, pins:{ext, fac, store, links, cap, vault}}].
// ESI refreshes a colony's state only when it is viewed in game, so every figure is as of `updated` (last_update).
export const SOON = 24 * 3600000;
export const planetName = t => { const s = String(t || 'unknown').replace(/_/g, ' '); return s[0].toUpperCase() + s.slice(1); };
/** An extractor's state at `now`: expired, soon (inside 24 h), ok, or unknown without an expiry. perHour is the current cycle's yield. */
export function extractor([product, expiry, heads, qty, cycle], now = Date.now()) {
  const end = Date.parse(expiry), known = Number.isFinite(end);
  return {product, heads, end: known ? end : null, perHour: qty > 0 && cycle > 0 ? qty * 3600 / cycle : null, state: !known ? 'unknown' : end <= now ? 'expired' : end - now < SOON ? 'soon' : 'ok'};
}
/** volumeOf(type) gives m3 per unit or undefined; fill is held / cap, or null when either is unknown. */
export function storage(pins, volumeOf) {
  if (!pins?.cap) return null;
  let m3 = 0;
  for (const [type, amount] of pins.vault || []) { const v = volumeOf(type); if (!(v >= 0)) return {cap:pins.cap, held:null, fill:null}; m3 += v * amount; }
  return {cap:pins.cap, held:m3, fill:Math.min(1, m3 / pins.cap)};
}
export function colony(p, now = Date.now(), volumeOf = () => undefined) {
  const ext = (p.pins?.ext || []).map(x => extractor(x, now)).sort((a, b) => (a.end ?? Infinity) - (b.end ?? Infinity));
  const worst = ext.some(x => x.state === 'expired') ? 'expired' : ext.some(x => x.state === 'soon') ? 'soon' : 'ok';
  const updated = Date.parse(p.updated);
  return {id:p.id, type:p.type, name:planetName(p.type), system:p.system, level:p.level, pinCount:p.num, ext, worst:ext.length ? worst : null, factories:(p.pins?.fac || []).length,
    perHour:ext.reduce((t, x) => t + (x.perHour || 0), 0), hasRates:ext.some(x => x.perHour), storage:storage(p.pins, volumeOf), links:p.pins?.links, updated:Number.isFinite(updated) ? updated : null, pending:!p.pins};
}
// Colonies needing attention first (expired, then expiring), then by planet type.
const RANK = {expired:0, soon:1, ok:2, null:3};
export const colonies = (planets, now, volumeOf) => (planets || []).map(p => colony(p, now, volumeOf)).sort((a, b) => RANK[a.worst] - RANK[b.worst] || a.name.localeCompare(b.name));
