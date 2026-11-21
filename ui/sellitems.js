// What the Sell view reads from pilots' synced data and from pasted lists. Pure, unit-tested in tests/sellitems.test.js.

const count = text => { const n = Number(String(text).replace(/[,\s']/g, '')); return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : null; };
// EVE's copy formats: "Name<TAB>Qty<TAB>…" from an inventory, "5 x Name" and "Name x5" from contracts and the market.
// Same names add up. → {rows:[{name, qty}], bad:[lines that are neither]}
export function parsePaste(text) {
  const sums = new Map(), bad = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let name, qty, m;
    if (raw.includes('\t')) { const [a, b] = raw.split('\t').map(x => x.trim()); name = a; qty = count(b ?? ''); }
    else if ((m = /^([\d,.']+)\s*x\s+(.+)$/i.exec(line))) { qty = count(m[1]); name = m[2]; }
    else if ((m = /^(.+?)\s+x\s*([\d,.']+)$/i.exec(line))) { name = m[1]; qty = count(m[2]); }
    if (!name || qty === null) { bad.push(line); continue; }
    const key = name.trim().toLowerCase();
    sums.set(key, {name:name.trim(), qty:(sums.get(key)?.qty || 0) + qty});
  }
  return {rows:[...sums.values()], bad};
}
// Items in a ship's cargo hold, from the fit snapshot (rows [type, flag, qty]); only while the snapshot is of this very ship.
export function cargoOf(fit, shipItemId) {
  if (!fit?.items || !(shipItemId > 0) || fit.ship !== shipItemId) return [];
  const sums = new Map();
  for (const [type, flag, qty] of fit.items) if (flag === 'Cargo' && qty > 0) sums.set(type, (sums.get(type) || 0) + qty);
  return [...sums];
}
// Hangar stacks {station: [[type, qty]]} → [{station, type, qty}], only for the stations asked for.
export function hangarOf(stacks, stations) {
  const out = [];
  for (const station of stations) for (const [type, qty] of stacks?.[station] || []) if (qty > 0) out.push({station, type, qty});
  return out;
}
