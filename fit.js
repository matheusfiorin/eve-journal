// A ship's current fit from the items inside it: [type_id, location_flag, quantity] rows, as the Worker keeps them
// (worker/pilotdata.js fitOf). Pure; names are resolved by the caller.
const SLOT = [[/^HiSlot(\d+)$/, 'high'], [/^MedSlot(\d+)$/, 'mid'], [/^LoSlot(\d+)$/, 'low'], [/^RigSlot(\d+)$/, 'rig'], [/^SubSystemSlot(\d+)$/, 'sub']];
export const SLOTS = [['high', 'High slots'], ['mid', 'Mid slots'], ['low', 'Low slots'], ['rig', 'Rigs'], ['sub', 'Subsystems'], ['drones', 'Drone bay'], ['fighters', 'Fighters'], ['special', 'Special holds'], ['cargo', 'Cargo']];
const FITTED = ['high', 'mid', 'low', 'rig', 'sub'];
/** The group a location flag belongs to, or null for flags that are not part of a fit (implants, skills, hangars). */
export function groupOf(flag) {
  for (const [pattern, group] of SLOT) if (pattern.test(flag)) return group;
  if (flag === 'DroneBay') return 'drones';
  if (/^Fighter(Bay|Tube\d*)$/.test(flag)) return 'fighters';
  if (flag === 'Cargo') return 'cargo';
  if (/^Specialized\w*(Hold|Bay)$|^(FleetHangar|ShipHangar|QuafeBay|FrigateEscapeBay|MobileDepotHold)$/.test(flag)) return 'special';
  return null;
}
const order = flag => Number(/(\d+)$/.exec(flag)?.[1] ?? 0);
/**
 * {group: [{type, qty, flag, charge?}]} in slot order. Fitted modules are one item each; a charge loaded in a module
 * shares its flag, so when catOf says a type is a Charge it hangs on the module in that slot instead of taking a slot.
 */
export function fitGroups(items, catOf = () => null) {
  const out = Object.fromEntries(SLOTS.map(([g]) => [g, []]));
  const rows = (items || []).filter(r => Array.isArray(r) && typeof r[1] === 'string' && groupOf(r[1]) !== null).map(([type, flag, qty]) => ({type, flag, qty: qty || 1, group: groupOf(flag)}))
    .sort((a, b) => order(a.flag) - order(b.flag));
  for (const r of rows) {
    const slot = FITTED.includes(r.group);
    if (slot && catOf(r.type) === 'Charge') { const module = out[r.group].find(m => m.flag === r.flag && !m.charge); if (module) { module.charge = r.type; continue; } }
    // Cargo and bays stack: the same type in two stacks reads as one line.
    const same = !slot && out[r.group].find(m => m.type === r.type);
    if (same) same.qty += r.qty; else out[r.group].push(r);
  }
  return out;
}
/** Standard EFT text: [Ship, fit name], lows, mids, highs, rigs, subsystems, drones, fighters, cargo; blocks split by a blank line.
 * Special holds (ore, gas, fleet hangar) are what the ship is carrying, not its fit: the card shows them, the text leaves them out. */
export function eft({ship, title, items, nameOf, catOf}) {
  const g = fitGroups(items, catOf), n = id => nameOf(id);
  const slots = key => g[key].map(m => m.charge ? `${n(m.type)}, ${n(m.charge)}` : n(m.type));
  const stacks = key => g[key].map(m => `${n(m.type)} x${m.qty}`);
  const blocks = [slots('low'), slots('mid'), slots('high'), slots('rig'), slots('sub'), stacks('drones'), stacks('fighters'), stacks('cargo')].filter(b => b.length);
  return `[${n(ship)}, ${title || n(ship)}]\n${blocks.map(b => b.join('\n')).join('\n\n')}`.trimEnd();
}
/** How many modules sit in each slot group, and the stacked quantities in the bays and holds. */
export function fitCounts(items, catOf) {
  const g = fitGroups(items, catOf);
  return Object.fromEntries(SLOTS.map(([key]) => [key, FITTED.includes(key) ? g[key].length : g[key].reduce((t, m) => t + m.qty, 0)]));
}
