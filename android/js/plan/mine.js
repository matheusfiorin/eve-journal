// Plan → Mine for the Android app: the web's mining tab (ui/screens/earn.js renderMining) without the HTML. Ranks belts
// by ISK per hour for the pilot's ship and skills, compares ships, values ore and sums the 30-day mining ledger.
import {levelOf} from '../../../model.js';
import {fees} from '../../../market.js';
import {SHIPS, SKILL, yieldRate, holdOf, canFly, oreValue, sites, ledger} from '../../../mining.js';
import {paths, secClass} from '../../../route.js';

const out = s => s && {id:s.id, name:s.name, sec:s.sec, region:s.region};
const NEXT = [[SKILL.miningFrigate, 1, 'Fly the Venture: a free-to-replace starter miner'], [SKILL.mining, 4, 'Miner II: +50% laser yield, and +5% per level'], [SKILL.astrogeology, 3, '+5% yield per level'],
  [SKILL.miningBarge, 1, 'Fly the Procurer, Retriever or Covetor: about 3× a Venture'], [SKILL.reprocessing, 4, 'Better mineral yield when ore sells for less than its minerals'], [SKILL.miningFrigate, 3, '+5% Venture yield per level']];
const SKILL_NAME = {[SKILL.mining]:'Mining', [SKILL.astrogeology]:'Astrogeology', [SKILL.miningFrigate]:'Mining Frigate', [SKILL.miningBarge]:'Mining Barge', [SKILL.reprocessing]:'Reprocessing'};
const DOCK = 240;

// A pilot as the web's minerOf sees them: skills, sales tax, location, ship and ledger.
function miner(p, m) {
  if (!p) return null;
  const level = id => levelOf(p.skills, id);
  return {name:p.name, level, known:Boolean(p.skills?.skills), salesTax:fees(p.skills, m.skills).salesTax, location:p.location ?? null, ship:p.ship ?? null, ledger:p.ledger ?? null};
}
function shipFor(me, choice) {
  if (SHIPS[choice]) return Number(choice);
  if (SHIPS[me.ship]) return me.ship;
  const flyable = Object.keys(SHIPS).map(Number).filter(id => canFly(id, me.level));
  return flyable.sort((a, b) => yieldRate(b, me.level) - yieldRate(a, me.level))[0] || 32880;
}

export const api = ({graph, meta, book}) => ({
  /**
   * {from, maxJumps, lowsec, ship:'auto'|id, me:{name, skills, location, ship, ledger:{permission, value}}, mate?:{…}}
   * → {ready, me:{ship, rate, hold, start, sites}, mate?:{…}, ships, train, ores, ledgers, together}
   */
  'mine.plan': ({from, maxJumps = 5, lowsec = false, ship: choice = null, me: meIn, mate: mateIn = null}) => {
    const g = graph(), m = meta(), b = book();
    if (!m.ores?.length) return {ready:false};
    const stationName = id => id ? b.stations.get(id)?.name ?? null : null;
    const me = miner(meIn, m), mate = miner(mateIn, m);
    const valuesFor = x => new Map(m.ores.map(o => [o.n, oreValue(o, b, {salesTax:x.salesTax, level:x.level})]));
    const activity = m.activity || {};
    const plan = (x, start, shipChoice, limit) => {
      const ship = shipFor(x, shipChoice), values = valuesFor(x), rate = yieldRate(ship, x.level), hold = holdOf(ship, x.level);
      const list = start && g.systems.has(start) ? sites(g, start, {values, rate, hold, activity, maxJumps, lowsec, limit}) : [];
      return {x, ship, values, rate, hold, start, list};
    };
    const shipOut = pl => ({id:pl.ship, name:SHIPS[pl.ship].name, current:pl.x.ship === pl.ship, flyable:canFly(pl.ship, pl.x.level), rate:pl.rate * 60, hold:pl.hold});
    const siteOut = s => ({system:out(s.system), jumps:s.jumps, belts:s.system.belts, iskHour:s.iskHour, kills:s.kills, traffic:s.traffic, crowd:s.crowd < 1, lowsecRoute:s.lowsec,
      lowsec:secClass(s.system.sec) !== 'hi', ores:s.ores.map(o => ({name:o.n, perM3:o.perM3, how:o.how, at:stationName(o.at)}))});
    const mine1 = plan(me, from, choice, 8), mate1 = mate ? plan(mate, mate.location || from, '', 3) : null;
    const best = mine1.list[0];
    const ships = Object.keys(SHIPS).map(Number).map(id => {
      const rate = yieldRate(id, me.level), hold = holdOf(id, me.level), perM3 = best?.ores[0].perM3 || 0, fill = hold / rate;
      return {id, name:SHIPS[id].name, current:me.ship === id, flyable:canFly(id, me.level), needs:canFly(id, me.level) ? null : `${id === 32880 ? 'Mining Frigate' : 'Mining Barge'} I`,
        rate:rate * 60, hold, iskHour:perM3 ? rate * 3600 * fill / (fill + DOCK) * perM3 : null};
    });
    const train = me.known ? NEXT.filter(([id, lvl]) => me.level(id) < lvl).slice(0, 3).map(([id, level, why]) => ({name:SKILL_NAME[id], level, from:me.level(id), why})) : [];
    const ores = [...mine1.values.values()].sort((a, b2) => b2.perM3 - a.perM3).map(v => ({name:v.n, perM3:v.perM3, how:v.how, raw:v.raw, compressed:v.compressed, refined:v.refined}));
    const sysName = id => g.systems.get(id)?.name || `System ${id}`;
    const ledgerOf = x => {
      if (!x?.ledger) return {state:'not-shared'};
      if (x.ledger.permission === false) return {state:'no-permission'};
      const r = ledger(x.ledger.value || [], m.ores, valuesFor(x), sysName);
      return r.units ? {state:'ok', m3:r.m3, isk:r.isk, days:r.days, systems:r.systems.slice(0, 4).map(s => ({name:s.name, m3:s.m3, isk:s.isk, days:s.days}))} : {state:'none'};
    };
    const mateTop = mate1?.list[0];
    const apart = mateTop && from && g.systems.has(from) ? paths(g, from, {safe:!lowsec}).path(mateTop.system.id) : null;
    return {
      ready:true,
      me:{name:me.name, known:me.known, ship:shipOut(mine1), start:out(g.systems.get(from)), sites:mine1.list.map(siteOut)},
      mate:mate1 ? {name:mate.name, ship:shipOut(mate1), start:out(g.systems.get(mate1.start)), usesYourStart:!mate.location, sites:mate1.list.map(siteOut)} : null,
      together:!mate ? null : !mateTop ? {kind:'none'} : best && mateTop.system.id === best.system.id ? {kind:'same', system:out(best.system)} : {kind:'apart', system:out(mateTop.system), jumps:apart ? apart.length - 1 : null},
      ships, train, ores,
      ledgers:{me:ledgerOf(me), mate:mate ? ledgerOf(mate) : null},
    };
  },
});
