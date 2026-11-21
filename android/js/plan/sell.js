// Plan → Sell for the Android app: the web's Sell view (ui/screens/sell.js) without the HTML. What the pilots carry (ship
// holds, the pickup hangar, a pasted list), the regions whose buy orders matter, and the sell plans (sell.js planSell)
// once the app has fetched those orders from ESI. Station and system names are filled in here.
import {SELL_DEFAULTS, planSell} from '../../../sell.js';
import {hops, systemIndex} from '../../../route.js';
import {fees} from '../../../market.js';
import {parsePaste, cargoOf, hangarOf} from '../../../ui/sellitems.js';

const HUBS = [30000142, 30002187, 30002659, 30002510, 30002053];
const RANGE = r => typeof r === 'number' ? (r === 0 ? 'this system' : `range ${r} ${r === 1 ? 'jump' : 'jumps'}`) : r === 'region' ? 'region wide' : r === 'solarsystem' ? 'same system' : 'this station';

export const api = ({graph, meta, book}) => {
  const systemOf = loc => graph().stations.get(loc)?.system ?? book().stations.get(loc)?.system;
  const sysName = id => graph().systems.get(id)?.name || `System ${id}`;
  const stationName = loc => graph().stations.get(loc)?.name || book().stations.get(loc)?.name || null;
  const placeName = (loc, sys) => stationName(loc) || `Structure in ${sysName(sys ?? systemOf(loc))}`;
  return {
    /**
     * What there is to sell. pilots: [{id, name, connected, own (their own snapshot here), shareLevel, ship:{ship_type_id, ship_name, ship_item_id},
     * location:{solar_system_id, station_id, structure_id}, fit, stacks, sellStation}] with the flying pilot first; pasted: [[type, qty]].
     * → {ships, rows, notes, pickup, pickupName, canPick}
     */
    'sell.gather': ({pilots = [], pasted = []}) => {
      const ships = [], rows = new Map(), notes = [];
      for (const p of pilots) {
        const ship = p.ship, loc = p.location, level3 = p.own || p.shareLevel >= 3;
        if (!level3 || !ship?.ship_type_id) { notes.push({pilot:p.name, text:p.own ? `${p.name}’s ship is not synced yet.` : `${p.name} has not shared a ship with the wing.`}); continue; }
        const station = loc?.station_id || loc?.structure_id || null;
        if (!station && !loc?.solar_system_id) { notes.push({pilot:p.name, text:`${p.name}’s location is not known yet, so their ship is left out.`}); continue; }
        const system = loc?.solar_system_id ?? (station ? systemOf(station) : undefined);
        ships.push({pilot:p.id, owner:p.name, name:ship.ship_name || 'Ship', shipType:ship.ship_type_id, system:system ?? null, systemName:system ? sysName(system) : null,
          station, stationName:station ? placeName(station, system) : null, connected:Boolean(p.connected)});
        for (const [type, qty] of cargoOf(p.fit, ship.ship_item_id)) rows.set(`s:${p.id}:${type}`, {key:`s:${p.id}:${type}`, type, avail:qty, from:{kind:'ship', pilot:p.id}, fromName:`${ship.ship_name || 'Ship'}’s hold`});
        for (const h of hangarOf(p.stacks, [station, p.own ? p.sellStation : null].filter(Boolean))) {
          const key = `h:${h.station}:${h.type}`, row = rows.get(key);
          if (row) row.avail += h.qty; else rows.set(key, {key, type:h.type, avail:h.qty, from:{kind:'hangar', station:h.station}, fromName:`Hangar at ${placeName(h.station)}`});
        }
      }
      const me = pilots[0], mineShip = ships.find(s => s.pilot === me?.id), pickup = (me?.own && me.sellStation) || mineShip?.station || null;
      // A pasted list lands in the pickup hangar, or in the hold when there is no station to take it from.
      const source = pickup ? {kind:'hangar', station:pickup, tag:`h:${pickup}`, name:`Hangar at ${placeName(pickup)}`} : ships[0] ? {kind:'ship', pilot:ships[0].pilot, tag:`s:${ships[0].pilot}`, name:`${ships[0].name}’s hold`} : null;
      if (source) for (const [type, qty] of pasted) rows.set(`${source.tag}:${type}`, {key:`${source.tag}:${type}`, type, avail:qty, pasted:true,
        from:source.kind === 'hangar' ? {kind:'hangar', station:source.station} : {kind:'ship', pilot:source.pilot}, fromName:source.name});
      return {ships, rows:[...rows.values()], notes, pickup, pickupName:pickup ? placeName(pickup) : null, chosen:Boolean(me?.own && me.sellStation), canPick:Boolean(me?.own)};
    },
    /** Regions worth asking about, most relevant first (ui/sellquotes.js candidateRegions): where the ships and pickups are, the hubs, then within maxJumps. */
    'sell.regions': ({starts = [], pickups = [], maxJumps = 0}) => {
      const g = graph(), out = new Set(), add = id => { const r = g.systems.get(id)?.region; if (r) out.add(r); };
      const from = [...starts, ...pickups.map(systemOf)].filter(Boolean);
      from.forEach(add); HUBS.forEach(add);
      if (maxJumps > 0) { const index = systemIndex(g), ids = [...g.systems.keys()]; for (const s of from) { const d = hops(g, s, maxJumps); for (const id of ids) if (d[index.get(id)] >= 0) add(id); } }
      return [...out];
    },
    /** EVE's copy formats → {rows:[{name, qty}], bad:[lines]} (ui/sellitems.js parsePaste). */
    'sell.parse': ({text = ''}) => parsePaste(text),
    /** Up to `limit` stations whose name starts with (then contains) the query, for the pickup picker. */
    'sell.stations': ({query = '', limit = 8}) => {
      const q = query.trim().toLowerCase(); if (q.length < 2) return [];
      const seen = new Map();
      for (const s of graph().stations.values()) seen.set(s.id, s.name);
      for (const [id, s] of book().stations) if (!seen.has(id)) seen.set(id, s.name);
      const all = [...seen].filter(([, n]) => n && n.toLowerCase().includes(q));
      return all.sort((a, b) => (b[1].toLowerCase().startsWith(q) - a[1].toLowerCase().startsWith(q)) || a[1].localeCompare(b[1])).slice(0, limit).map(([id, name]) => ({id, name}));
    },
    /**
     * {lots:[{type, qty, m3, from}], ships:[{pilot, name, shipType, capacity, system, station}], quotes:{type:[quote]}, skills, options:{perJump, maxJumps, lowsec, together, returnHome}, now}
     * → {plans:[{key, label, also, jumps, net, expectedLoss, score, soldShare, ships:[{pilot, name, route, routeNames, jumps, net, stops:[…]}], unsold}], notes}
     */
    'sell.plan': ({lots = [], ships = [], quotes = {}, skills = null, options = {}, now = Date.now()}) => {
      const g = graph(), m = meta(), b = book();
      const stations = new Map();
      for (const [loc, s] of b.stations) if (g.systems.has(s.system)) stations.set(loc, {system:s.system, name:s.name, region:g.systems.get(s.system).region});
      for (const s of ships) if (s.station && s.system && !g.stations.has(s.station) && !stations.has(s.station)) stations.set(s.station, {system:s.system, name:'', region:g.systems.get(s.system)?.region});
      const quoteMap = new Map(Object.entries(quotes).map(([t, list]) => [Number(t), list]));
      const byOrder = new Map(); for (const list of quoteMap.values()) for (const q of list) byOrder.set(q.order, q);
      const traffic = Object.fromEntries(Object.entries(m.activity || {}).map(([id, a]) => [id, a[2]]));
      const r = planSell({g, lots, ships, quotes:quoteMap, stations, salesTax:fees(skills, m.skills).salesTax, risk:{history:m.risk?.s || {}, traffic, now}, options:{...SELL_DEFAULTS, ...options}});
      const shipOut = s => ({pilot:s.pilot, name:s.name, route:s.route, jumps:s.jumps, net:s.net, start:sysName(s.route[0]),
        routeNames:s.route.slice(0, 10).map(sysName).concat(s.route.length > 10 ? [`… ${sysName(s.route.at(-1))}`] : []),
        stops:s.stops.map(x => ({station:x.station, name:placeName(x.station, x.system), system:sysName(x.system), systemId:x.system,
          pickups:x.pickups.map(k => ({type:k.type, qty:k.qty})),
          sales:x.sales.map(k => { const q = byOrder.get(k.order), far = k.orderLoc !== x.station;
            return {type:k.type, qty:k.qty, price:k.price, net:k.net, far, orderAt:far ? placeName(k.orderLoc, q?.system) : null, range:far ? RANGE(q?.range) : null}; })}))});
      return {
        plans:r.plans.map(p => ({key:p.key, label:p.label, also:p.also, jumps:p.jumps, net:p.net, expectedLoss:p.expectedLoss, score:p.score, soldShare:p.soldShare, together:p.together,
          ships:p.ships.map(shipOut), unsold:p.unsold.filter(u => u.qty > 0).map(u => ({type:u.type, qty:u.qty, reason:u.reason, at:u.station ? placeName(u.station) : null}))})),
        notes:r.notes.map(n => ({kind:n.kind, type:n.type, qty:n.qty ?? null, share:n.share ?? null, plan:n.plan ?? null})),
      };
    },
  };
};
