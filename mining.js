// Where to mine right now: ore spawn rules, ship yield, ore value and a score per system. Pure functions; the UI supplies data.
// Spawn rules follow EVE University's ore table (Oct 2026). Belt contents aren't in ESI, so this is what *can* spawn.
import {paths, secShown, secClass} from './route.js';

export const SKILL = {mining:3386, astrogeology:3410, miningFrigate:32918, miningBarge:17940, reprocessing:3385, reprocessingEfficiency:3389, simpleOre:60377, coherentOre:60378};
const FACTION = {
  amarr:[10000043, 10000052, 10000020, 10000065, 10000054, 10000036, 10000038, 10000049, 10000001],
  caldari:[10000002, 10000016, 10000033, 10000069],
  gallente:[10000032, 10000064, 10000037, 10000068, 10000048, 10000044, 10000067],
  minmatar:[10000030, 10000042, 10000028]
};
// shortcut: a region missing from this table gets only the ores every high-sec belt has.
export const faction = region => Object.keys(FACTION).find(f => FACTION[f].includes(region)) || null;
const LOW = {amarr:['Pyroxeres', 'Kernite', 'Jaspet'], caldari:['Kernite', 'Pyroxeres'], gallente:['Omber', 'Jaspet'], minmatar:['Kernite', 'Omber']};
const DEEP_LOW = {amarr:'Hemorphite', caldari:'Hedbergite', gallente:'Hemorphite', minmatar:'Hedbergite'};
export function oresAt(sec, region) {
  const s = secShown(sec), f = faction(region);
  if (s >= 0.5) {
    const out = ['Veldspar', 'Scordite'];
    if (s <= 0.9 && (f === 'amarr' || f === 'caldari')) out.push('Pyroxeres');
    if (s <= 0.9 && (f === 'gallente' || f === 'minmatar' || (f === 'caldari' && s <= 0.7))) out.push('Plagioclase');
    return out;
  }
  if (s > 0 && f) return [...LOW[f], ...(s <= 0.2 ? [DEEP_LOW[f]] : [])];
  return [];
}

// Typical T1 fits: two Miner I/II on frigates, two Strip Miner I on barges. Ore hold in m³.
// shortcut: hull bonuses from EVE University's barge page; verify against your mining ledger.
export const SHIPS = {
  32880:{name:'Venture', hold:5000, skill:SKILL.miningFrigate, frigate:true},
  17480:{name:'Procurer', hold:16000, skill:SKILL.miningBarge, bonus:l => 1 + 0.02 * l},
  17478:{name:'Retriever', hold:22000, skill:SKILL.miningBarge, bonus:l => 1.10 * (1 + 0.03 * l), holdBonus:l => 1 + 0.05 * l},
  17476:{name:'Covetor', hold:9000, skill:SKILL.miningBarge, bonus:l => (1 + 0.03 * l) / 0.75}
};
export const canFly = (shipId, level) => (level(SHIPS[shipId].skill) || 0) >= 1;
// Ore mined per second (m³) for a ship and a pilot's skill levels.
export function yieldRate(shipId, level) {
  const ship = SHIPS[shipId], hull = level(ship.skill) || 0;
  const skills = (1 + 0.05 * (level(SKILL.mining) || 0)) * (1 + 0.05 * (level(SKILL.astrogeology) || 0));
  if (ship.frigate) {
    const laser = (level(SKILL.mining) || 0) >= 4 ? 15 : 10; // Miner II needs Mining IV; both cycle every 15 s
    return 2 * laser / 15 * 2 * (1 + 0.05 * hull) * skills; // Venture role bonus doubles yield
  }
  return 2 * 150 / 45 * ship.bonus(hull) * skills;
}
export const holdOf = (shipId, level) => SHIPS[shipId].hold * (SHIPS[shipId].holdBonus?.(level(SHIPS[shipId].skill) || 0) || 1);
// NPC station reprocessing: 50% base, raised by Reprocessing, Reprocessing Efficiency and the ore's processing skill.
const SIMPLE = new Set(['Veldspar', 'Scordite', 'Pyroxeres', 'Plagioclase']);
export function refineYield(ore, level) {
  const special = SIMPLE.has(ore) ? SKILL.simpleOre : SKILL.coherentOre;
  return 0.5 * (1 + 0.03 * (level(SKILL.reprocessing) || 0)) * (1 + 0.02 * (level(SKILL.reprocessingEfficiency) || 0)) * (1 + 0.02 * (level(special) || 0));
}
// ISK per m³ of an ore: the best of selling it raw, compressed, or reprocessed into minerals, all into hub buy orders.
export function oreValue(ore, book, {salesTax = 0.075, level = () => 0} = {}) {
  const bid = type => book.items.get(type)?.buys[0];
  const net = order => order ? order.price * (1 - salesTax) : 0;
  const raw = net(bid(ore.ore)), compressed = net(bid(ore.comp));
  const share = refineYield(ore.n, level);
  const refined = ore.m.reduce((t, [mineral, qty]) => t + Math.floor(qty * share) * net(bid(mineral)), 0) / ore.portion;
  const options = [['raw', raw, bid(ore.ore)], ['compressed', compressed, bid(ore.comp)], ['reprocessed', refined, null]];
  const [how, perUnit, order] = options.reduce((a, b) => b[1] > a[1] ? b : a);
  return {n:ore.n, how, perUnit, perM3:perUnit / ore.vol, at:order?.loc, raw, compressed, refined};
}

// Score systems within reach: ISK per hour at the site, discounted for recent kills, crowds and travel.
const DOCK_SECONDS = 240; // warp to a station, unload, warp back
export function sites(g, from, {values, rate, hold, activity = {}, maxJumps = 10, lowsec = false, session = 7200, limit = 8}) {
  const route = paths(g, from, {safe:!lowsec}), out = [];
  const fill = hold / rate, efficiency = fill / (fill + DOCK_SECONDS);
  for (const system of g.systems.values()) {
    if (!system.belts || (!lowsec && secClass(system.sec) !== 'hi') || secClass(system.sec) === 'null') continue;
    const list = route.path(system.id);
    if (!list || list.length - 1 > maxJumps) continue;
    if (!lowsec && list.some(id => secClass(g.systems.get(id).sec) !== 'hi')) continue;
    const ores = oresAt(system.sec, system.region).map(n => values.get(n)).filter(v => v?.perM3 > 0).sort((a, b) => b.perM3 - a.perM3);
    if (!ores.length) continue;
    const iskHour = rate * 3600 * efficiency * ores[0].perM3;
    const [kills = 0, , jumps = 0] = activity[system.id] || [];
    const travel = (list.length - 1) * 60;
    const risk = 1 / (1 + kills) * (secClass(system.sec) === 'hi' ? 1 : 0.6);
    const crowd = jumps > 1000 ? 0.7 : jumps > 300 ? 0.85 : 1;
    const score = iskHour * risk * crowd * Math.max(0, session - travel) / session;
    out.push({system, jumps:list.length - 1, ores, iskHour, kills, traffic:jumps, risk, crowd, score, lowsec:list.slice(1).some(id => secClass(g.systems.get(id).sec) !== 'hi')});
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// The mining ledger (last 30 days) summed per system and valued at today's prices.
export function ledger(rows, ores, values, names = id => `System ${id}`) {
  const grade = new Map(ores.flatMap(o => Object.entries(o.grades).map(([id, bonus]) => [Number(id), {ore:o, bonus}])));
  const bySystem = new Map(); let units = 0, m3 = 0, isk = 0;
  for (const row of rows || []) {
    const g = grade.get(row.type_id); if (!g) continue;
    const value = row.quantity * (values.get(g.ore.n)?.perUnit || 0) * (1 + g.bonus), vol = row.quantity * g.ore.vol;
    units += row.quantity; m3 += vol; isk += value;
    const s = bySystem.get(row.solar_system_id) || {id:row.solar_system_id, name:names(row.solar_system_id), m3:0, isk:0, days:new Set()};
    s.m3 += vol; s.isk += value; s.days.add(row.date); bySystem.set(row.solar_system_id, s);
  }
  return {units, m3, isk, days:new Set((rows || []).map(r => r.date)).size, systems:[...bySystem.values()].map(s => ({...s, days:s.days.size})).sort((a, b) => b.isk - a.isk)};
}
