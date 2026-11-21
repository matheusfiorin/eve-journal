// Plan → Haul routes for the Android app: the web's Haul plan (ui/screens/navigate.js renderHauling, ui/haulplan.js
// planModes) without the HTML. Plans every mode for a trip, prices each system with kill history, traffic and, when the
// app has fetched them, the last hour of zKillboard kills (campIntel), and says which regions and gates to look up.
import {HULLS, MODES, plan, suggestHull, campIntel} from '../../../hauling.js';
import {secClass} from '../../../route.js';

const out = s => s && {id:s.id, name:s.name, sec:s.sec, region:s.region};

export const api = ({graph, meta}) => ({
  /** The hulls and modes the screen offers, with the web's words. */
  'haul.options': () => ({hulls:Object.entries(HULLS).map(([key, h]) => ({key, name:h.name, cargo:h.cargo, why:h.why})), modes:Object.entries(MODES).map(([key, m]) => ({key, label:m.label}))}),
  /**
   * {stops:[ids], value, volume, hull?, lowsec, avoid:[ids], optimize, end:'fixed'|'return', kills?:[zKillboard kills], gateTo?:{gateId:systemId}, now}
   * → {hull, suggested, fits, modes:{safest|balanced|shortest: plan}, regions:[ids], gates:[ids], live:{kills, regions}|null, killDays}
   */
  'haul.plan': ({stops = [], value = 0, volume = 0, hull = null, lowsec = false, avoid = [], optimize = false, end = 'fixed', kills = null, gateTo = {}, now = Date.now()}) => {
    const g = graph(), m = meta();
    const ids = stops.filter(id => g.systems.has(id));
    if (ids.length < 2) return {error:'need-two-stops'};
    const suggested = suggestHull(volume, value), use = HULLS[hull] ? hull : suggested;
    const history = m.risk?.s || {}, traffic = Object.fromEntries(Object.entries(m.activity || {}).map(([id, a]) => [id, a[2]]));
    const live = kills ? campIntel(kills, {combat:m.combat, gateTo:new Map(Object.entries(gateTo).map(([k, v]) => [Number(k), v])), now}) : new Map();
    const ctx = {history, traffic, live, value, hull:use, now};
    const options = {lowsec, avoid:new Set(avoid), optimize, end};
    const modes = {}, crossed = new Set();
    for (const mode of Object.keys(MODES)) {
      const p = plan(g, ids, ctx, {...options, mode});
      if (p.unreachable) { modes[mode] = {unreachable:p.unreachable.map(id => out(g.systems.get(id)))}; continue; }
      for (const id of p.route) crossed.add(g.systems.get(id).region);
      modes[mode] = {
        stops:p.stops.map(id => out(g.systems.get(id))), route:p.route, jumps:p.jumps, survival:p.survival, expectedLoss:p.expectedLoss, minutes:p.minutes, lowsec:p.lowsec,
        steps:p.steps.map(st => {
          const c = live.get(st.system.id);
          const gateKills = c ? Object.entries(c.gates).filter(([to]) => to === '?' || st.via.includes(Number(to))).reduce((t, [, x]) => t + x.n, 0) : 0;
          return {system:out(st.system), stop:st.stop, p:st.p, band:secClass(st.system.sec), d24:Math.round((history[st.system.id] || [0])[0]), perHour:traffic[st.system.id] || 0,
            live:c ? {kills:c.kills, gateKills, last:c.last || null, sb:Boolean(c.sb), dictor:Boolean(c.dictor),
              ships:Object.entries(c.ships || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => Number(id))} : null};
        }),
      };
    }
    // The same route under two modes reads "same as": the app shows it once.
    const keys = Object.keys(MODES);
    for (const [i, k] of keys.entries()) { const same = keys.slice(0, i).find(j => modes[j].route && modes[j].route.join() === modes[k].route?.join()); if (same) modes[k].sameAs = same; }
    // Gate kills name the stargate (zkb.locationID); the app resolves those to destination systems through ESI.
    const onRoute = new Set(Object.values(modes).flatMap(p => p.route || []));
    const gates = kills ? [...new Set(kills.filter(k => onRoute.has(k.solar_system_id) && k.zkb?.locationID >= 50000000 && k.zkb?.locationID < 60000000).map(k => k.zkb.locationID))] : [];
    return {
      hull:{key:use, ...HULLS[use]}, suggested, fits:volume <= HULLS[use].cargo,
      modes, regions:[...crossed].slice(0, 12), gates,
      live:kills ? {kills:kills.filter(k => !k.zkb?.npc).length} : null,
      killDays:m.risk?.since ? Math.max(1, Math.round((now - m.risk.since) / 86400000)) : 0,
    };
  },
});
