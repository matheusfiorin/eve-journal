// Corporation data: pure helpers for the corp sync (worker/index.js syncCorp), the /api/corp answer and the Discord alerts.
// No network, no D1 here.

// ESI answers 403 to a corporation route unless the pilot holds the matching in-game role. The role named here is what the
// route's documentation asks for (the first one listed is the one most corporations hand out).
export const CORP_SECTIONS = {
  starbases: 'Director or Station Manager', structures: 'Station Manager', wallets: 'Accountant', divisions: 'Director',
  members: 'Director', jobs: 'Factory Manager or Director', customs: 'Director', assets: 'Director'
};
export const roleNote = key => `needs role ${CORP_SECTIONS[key]}`;

// Starbase (control tower) numbers. Source: EVE University wiki, "POS Setup" (https://wiki.eveuniversity.org/POS_Setup):
//   fuel blocks per hour: small 10, medium 20, large 40; strontium clathrates per hour of reinforcement: small 100, medium 200,
//   large 400 (the older "Player-owned starbases" page counts per-unit fuel and is outdated). Faction towers burn a bit less
//   (about 10%); they are rated like their size here, so a faction tower's hours come out slightly short and its alert early,
//   never late. The wiki also says starbases "will soon be removed", with no date; ESI still serves
//   /corporations/{id}/starbases/ (checked 2026-11-21: an unauthenticated call answers 401, not 404), and the sync treats a 404
//   as "no starbases" so the day CCP removes it nothing breaks.
export const TOWER_HOURLY = {large: {fuel: 40, strontium: 400}, medium: {fuel: 20, strontium: 200}, small: {fuel: 10, strontium: 100}};
// Nitrogen, Hydrogen, Helium and Oxygen fuel blocks; the towers' strontium clathrates.
export const FUEL_BLOCKS = new Set([4051, 4246, 4247, 4312]);
export const STRONTIUM = 16275;
// The size comes from the tower's type: the names ("Amarr Control Tower Medium", "Blood Control Tower Small", plain for large)
// are read once per type from ESI and kept. An unnamed type counts as large, the fastest burner, so a guess errs early.
export const towerSize = name => /\bSmall\b/i.test(name || '') ? 'small' : /\bMedium\b/i.test(name || '') ? 'medium' : 'large';

const HOUR = 3600000;
/** One starbase with its fuels: blocks, hours of fuel and strontium, and when the fuel runs out. */
export function starbaseHealth(sb, details, size, fetchedAt) {
  const fuels = details?.fuels || [], rate = TOWER_HOURLY[size] || TOWER_HOURLY.large;
  const blocks = fuels.filter(f => FUEL_BLOCKS.has(f.type_id)).reduce((n, f) => n + (f.quantity || 0), 0);
  const stront = fuels.filter(f => f.type_id === STRONTIUM).reduce((n, f) => n + (f.quantity || 0), 0);
  const state = details?.state || sb.state;
  // Only an online tower burns fuel; an offline or onlining one keeps what it has.
  const fuelHours = fuels.length || details ? Math.round(blocks / rate.fuel * 10) / 10 : null;
  return {id: sb.starbase_id, type: sb.type_id, size, system: sb.system_id, moon: sb.moon_id ?? null, state,
    onlined: sb.onlined_since ?? details?.onlined_since ?? null, reinforcedUntil: details?.reinforced_until ?? sb.reinforced_until ?? null, unanchorAt: details?.unanchor_at ?? sb.unanchor_at ?? null,
    fuelBlocks: blocks, strontium: stront, fuelHours, strontiumHours: Math.round(stront / rate.strontium * 10) / 10,
    fuelEmptyAt: state === 'online' && fuelHours !== null ? fetchedAt + fuelHours * HOUR : null};
}
export function structureHealth(s) {
  return {id: s.structure_id, type: s.type_id, system: s.system_id, name: typeof s.name === 'string' ? s.name.slice(0, 100) : null, state: s.state, fuelExpires: s.fuel_expires ?? null,
    stateTimerStart: s.state_timer_start ?? null, stateTimerEnd: s.state_timer_end ?? null, unanchorsAt: s.unanchors_at ?? null, reinforceHour: s.reinforce_hour ?? null,
    services: (s.services || []).slice(0, 12).map(x => ({name: String(x.name).slice(0, 60), state: x.state}))};
}
/** The snapshot as the app reads it: hours and days left worked out for `now` (stored times are absolute, so this never goes stale). */
export function withHealth(snapshot, now = Date.now()) {
  const out = {...snapshot};
  const sb = snapshot.starbases?.value;
  if (Array.isArray(sb)) out.starbases = {...snapshot.starbases, value: sb.map(t => ({...t, fuelHoursLeft: t.fuelEmptyAt ? Math.max(0, Math.round((t.fuelEmptyAt - now) / HOUR * 10) / 10) : null}))};
  const st = snapshot.structures?.value;
  if (Array.isArray(st)) out.structures = {...snapshot.structures, value: st.map(s => ({...s, fuelDaysLeft: Date.parse(s.fuelExpires) ? Math.max(0, Math.round((Date.parse(s.fuelExpires) - now) / 86400000 * 10) / 10) : null}))};
  return out;
}

export const POS_FUEL_ALERT_H = 24, STRUCTURE_FUEL_ALERT_D = 3;
const REINFORCED = new Set(['armor_reinforce', 'hull_reinforce']);
// A structure's own name is used only when it has one that carries no place: Upwell names default to "System - Name", and a
// name may hold a system's name or a wormhole designation. systemName is the name of the structure's system, if known.
export function safeLabel(name, systemName) {
  if (!name) return null;
  const n = name.trim();
  if (!n || / - /.test(n) || /\bJ\d{6}\b/i.test(n) || (systemName && n.toLowerCase().includes(systemName.toLowerCase()))) return null;
  return n.replace(/[`*_~|<>@]/g, '').slice(0, 40) || null;
}
const HOURS = ms => { const h = Math.max(1, Math.round(ms / HOUR)); return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`; };
/** Alert candidates [{key, text}] for one corporation snapshot. systemNames maps a system id to its name (for hiding names that hold one). Never a place. */
export function corpCandidates(corpId, snap, {now = Date.now(), systemNames = {}} = {}) {
  const out = [];
  for (const t of snap.starbases?.value || []) {
    const empty = t.fuelEmptyAt;
    if (t.state === 'online' && empty && empty - now < POS_FUEL_ALERT_H * HOUR && empty > now - 6 * HOUR)
      // The bucket is three days wide: a refuel moves the empty time out of it, and the next dry spell is a new alert.
      out.push({key: `pos-fuel:${corpId}:${t.id}:${Math.floor(empty / (3 * 86400000))}`, text: `A tower is low on fuel: about ${HOURS(Math.max(0, empty - now))} left`});
    if (t.state === 'reinforced' || t.state === 'unanchoring') out.push({key: `pos-state:${corpId}:${t.id}:${t.state}:${t.reinforcedUntil || t.unanchorAt || ''}`, text: t.state === 'reinforced' ? 'A tower is reinforced, possibly under attack' : 'A tower is unanchoring'});
  }
  for (const s of snap.structures?.value || []) {
    const label = safeLabel(s.name, systemNames[s.system]) || 'A structure', who = label === 'A structure' ? label : `Structure ${label}`;
    const left = Date.parse(s.fuelExpires) - now;
    if (Number.isFinite(left) && left < STRUCTURE_FUEL_ALERT_D * 86400000 && left > -86400000)
      out.push({key: `struct-fuel:${corpId}:${s.id}:${s.fuelExpires}`, text: `${who} is low on fuel: ${left <= 0 ? 'it has run out' : `about ${HOURS(left)} left`}`});
    if (REINFORCED.has(s.state)) out.push({key: `struct-state:${corpId}:${s.id}:${s.state}:${s.stateTimerEnd || ''}`, text: `${who} is reinforced (${s.state === 'hull_reinforce' ? 'hull' : 'armor'}), possibly under attack`});
  }
  return out;
}
