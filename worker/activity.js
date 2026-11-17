// Kill and jump history per system, kept by the Worker's cron from ESI's hourly counts (it used to be the market
// pipeline's job, but GitHub drops most of its scheduled runs). Pure functions, so they test without a Worker.

// Ship kills per system as exponentially decayed sums over ~24 h and ~7 days, updated from ESI's last-hour counts.
// shortcut: hours that were missed are filled with the latest hour's rate (at most 6).
export function decayRisk(prev, kills, now) {
  const hours = prev?.at ? Math.max(0, (now - prev.at) / 3600000) : 1, weight = Math.min(hours, 6), s = {};
  for (const [id, [d, w]] of Object.entries(prev?.s || {})) s[id] = [d * Math.exp(-hours / 24), w * Math.exp(-hours / 168)];
  for (const k of kills) if (k.ship_kills) { const v = s[k.system_id] ||= [0, 0]; v[0] += k.ship_kills * weight; v[1] += k.ship_kills * weight; }
  for (const id of Object.keys(s)) { s[id] = s[id].map(x => Math.round(x * 100) / 100); if (s[id][1] < 0.05) delete s[id]; }
  return {at:now, since:prev?.since || now, s};
}
// Jumps per system as a ~24-hour decayed sum: how busy a system is over a day, not just this hour.
export function decayTraffic(prev, jumps, now) {
  const hours = prev?.at ? Math.max(0, (now - prev.at) / 3600000) : 1, weight = Math.min(hours, 6), s = {};
  for (const [id, d] of Object.entries(prev?.s || {})) s[id] = d * Math.exp(-hours / 24);
  for (const j of jumps) if (j.ship_jumps) s[j.system_id] = (s[j.system_id] || 0) + j.ship_jumps * weight;
  for (const id of Object.keys(s)) { s[id] = Math.round(s[id]); if (s[id] < 1) delete s[id]; }
  return {at:now, since:prev?.since || now, s};
}
// This sample's kill and traffic sums. Missing ESI data (null) carries the previous sums forward unchanged.
export function history(previous, kills, jumps, now) {
  return {risk:kills ? decayRisk(previous?.risk, kills, now) : previous?.risk, traffic:jumps ? decayTraffic(previous?.traffic, jumps, now) : previous?.traffic};
}
// Last hour's [ship + pod kills, NPC kills, jumps] per system, for systems keep() accepts (high- and low-sec: the
// Mining tab's reach). A feed that did not come (null) keeps its column from the previous hour.
export function lastHour(previous, kills, jumps, keep = () => true) {
  const out = {};
  if (kills) { for (const k of kills) if (keep(k.system_id)) out[k.system_id] = [k.ship_kills + k.pod_kills, k.npc_kills, 0]; }
  else for (const [id, a] of Object.entries(previous || {})) if (a[0] || a[1]) out[id] = [a[0], a[1], 0];
  if (jumps) { for (const j of jumps) if (keep(j.system_id)) (out[j.system_id] ||= [0, 0, 0])[2] = j.ship_jumps; }
  else for (const [id, a] of Object.entries(previous || {})) if (a[2]) (out[id] ||= [0, 0, 0])[2] = a[2];
  return out;
}
