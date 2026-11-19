// Loading both pilots: public profile, private backend record or shared snapshot, wingmate summary and holdings.
import {S, mine, summary, assetsOf, opsOf} from './state.js';
import {esi, corporation, resolveNames, loadSkillGroups, loadPrices, loadAssetCategories, isStation} from './esi.js';
import {$, notice, setSync, clock} from './shared.js';

function referencedIds(p) {
  const o = p.ops || {}, v = key => o[key]?.value;
  return [
    ...(p.queue || []).map(q => q.skill_id), ...(p.skills?.skills || []).map(s => s.skill_id),
    v('ship')?.ship_type_id, v('location')?.solar_system_id, v('location')?.station_id,
    ...(v('jobs') || []).flatMap(j => [j.product_type_id, j.blueprint_type_id]),
    ...(v('transactions') || []).flatMap(t => [t.type_id, t.location_id]),
    ...(v('implants') || []), v('clones')?.home_location?.location_id,
    ...(v('clones')?.jump_clones || []).flatMap(c => [c.location_id, ...(c.implants || [])]),
    ...(v('fit')?.items || []).map(row => row[0]),
    ...[...(v('orders') || []), ...(v('orderHistory') || [])].flatMap(o => [o.type_id, isStation(o.location_id) ? o.location_id : null]),
    ...(v('contracts') || []).flatMap(c => [c.issuer_id, c.assignee_id, c.acceptor_id, ...[c.start_location_id, c.end_location_id].filter(isStation)]),
    ...(v('killmails')?.losses || []).flatMap(l => [l.ship, l.system, l.corp])
  ];
}
// Charges loaded in a module share its slot flag, so only types that share a flag with another item need a category lookup.
function chargeCandidates(ps) {
  const out = [];
  for (const p of ps) {
    const seen = new Map();
    for (const [type, flag] of opsOf(p).fit?.value?.items || []) { if (/Slot\d+$/.test(flag)) { if (seen.has(flag)) out.push(type, seen.get(flag)); else seen.set(flag, type); } }
  }
  return out;
}
async function loadProfile(p) {
  try {
    p.profile = await esi(`characters/${p.id}/`);
    p.corp = await corporation(p.profile.corporation_id);
    try {
      const history = await esi(`characters/${p.id}/corporationhistory/`);
      p.career = await Promise.all(history.filter(item => !item.is_deleted).sort((a,b) => b.start_date.localeCompare(a.start_date)).slice(0,6).map(async item => ({...item, name:(await corporation(item.corporation_id)).name})));
      delete p.careerError;
    } catch (error) { p.careerError = error.message; }
  } catch (error) { p.error = `Public profile: ${error.message}`; }
}
// Why a pilot's private data is missing: their sign-in ended (401), or EVE or the backend isn't answering (5xx, offline).
// The two need different words and buttons: Reconnect fixes the first, only waiting or Retry fixes the second.
export const problemOf = error => ({kind:error.status === 401 || /Connect this pilot again/.test(error.message) ? 'expired' : 'outage', message:error.message});
async function loadPrivate(p, force, shared) {
  p.shared = shared.find(row => row.characterId === p.id) || null;
  if (S.backend?.has(p.id)) {
    try {
      const record = await S.backend.privatePilot(p.id, force);
      // A disconnect during the request must not restore private data.
      if (!S.backend.has(p.id)) return;
      Object.assign(p, {skills:record.skills, queue:record.queue, ops:record.operations || {}, sellStation:record.sellStation || null, synced:record.fetchedAt, private:true});
      if (record.lastError) p.error = record.lastError;
      return;
    } catch (error) { p.error = error.message; p.problem = problemOf(error); }
  }
  Object.assign(p, {skills:p.shared?.skills, queue:p.shared?.queue, ops:undefined, synced:p.shared?.fetchedAt, private:false});
  if (p.shared?.stale && !p.error) p.error = 'The shared training snapshot could not be refreshed. This pilot may need to reconnect.';
}
// When the oldest private data on screen was fetched from EVE: the pilot's own snapshot, or the wing summary for a
// wingmate connected elsewhere. The Worker refreshes each pilot every 10 minutes, so older than that means a sync
// is failing or the page has been open a while.
export function dataTime() {
  const times = S.pilots.filter(p => p.id).map(p => p.private ? p.synced : S.wing.get(p.id)?.fetchedAt).filter(Boolean).map(Date.parse).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}
export const STALE_MS = 10 * 60000;
// The strip's sync line says what is true: synced, EVE not answering (with the time of the data on screen), or a sign-in
// that ended. Problems get the warning tone and the button that fixes them.
export function syncStatus(at) {
  const bad = S.pilots.filter(p => p.problem), expired = bad.filter(p => p.problem.kind === 'expired'), tell = list => list.map(p => `${p.name}’s`).join(' and ');
  if (expired.length) return setSync(`${tell(expired)} sign-in${expired.length > 1 ? 's' : ''} expired.`, 'warn', `<button type="button" class="small" data-connect="${S.pilots.indexOf(expired[0])}">Reconnect</button>`);
  if (bad.length) return setSync(`EVE isn’t answering.${at ? ` Showing data from ${clock(at)}.` : ''}`, 'warn', '<button type="button" class="small secondary" data-retry>Retry</button>');
  setSync(at && Date.now() - at > STALE_MS ? `EVE data from ${clock(at)}` : `Synced ${clock(at || Date.now())}`);
}
// render() redraws the page; it runs at the start (to show "refreshing") and once everything has settled.
export async function loadPilots(force, render) {
  const request = ++S.generation;
  const statusTask = esi('status/').then(value => { S.universeStatus = {...value, fetched:Date.now()}; }).catch(() => { if (S.universeStatus) S.universeStatus.stale = true; }).finally(() => { S.statusTried = true; });
  const sharedTask = S.backend ? S.backend.publicPilots().catch(error => { notice(`Shared training snapshots: ${error.message}`); return []; }) : Promise.resolve([]);
  const next = S.config.pilots.map(n => ({...S.pilots.find(p => p.name.toLowerCase() === n.toLowerCase()), name:n, error:null, problem:null, refreshing:true}));
  S.pilots = next;
  $('#refresh').disabled = true; $('#refresh').setAttribute('aria-busy', 'true');
  S.settling = true; setSync('Syncing…');
  render();
  let ok = false;
  try {
    const result = next.length ? await esi('universe/ids/?language=en', {method:'POST', body:JSON.stringify(next.map(p => p.name))}) : {};
    const shared = await sharedTask;
    await Promise.all(next.map(async p => {
      const match = (result.characters || []).find(c => c.name.toLowerCase() === p.name.toLowerCase());
      if (!match) { p.error = `Couldn’t find ${p.name} in EVE.`; return; }
      p.id = match.id; p.name = match.name;
      await Promise.all([loadProfile(p), loadPrivate(p, force, shared)]);
      p.queue?.sort((a,b) => a.queue_position - b.queue_position);
    }));
    if (request !== S.generation) return false;
    try { await resolveNames(next.flatMap(referencedIds)); } catch { notice('Some EVE names could not be loaded. IDs are shown instead.'); }
    await loadWing();
    // A wingmate's shared ship and fit come with the wing summary, after the first round of names.
    try { await resolveNames(next.flatMap(p => [opsOf(p).ship?.value?.ship_type_id, ...(opsOf(p).fit?.value?.items || []).map(row => row[0])])); } catch { /* IDs show instead. */ }
    if (next.some(p => p.skills?.skills) || [...S.wing.values()].some(w => w.skills?.skills)) await loadSkillGroups();
    await loadHoldings();
    try { await loadAssetCategories(chargeCandidates(next)); } catch { /* A charge then reads as a module. */ }
    const at = dataTime();
    S.settling = false; syncStatus(at);
    ok = true;
  } catch (error) {
    if (request !== S.generation) return false;
    S.settling = false;
    next.forEach(p => { p.error = error.message; p.problem = problemOf(error); });
    syncStatus(dataTime());
  } finally {
    await statusTask; S.settling = false;
    if (request === S.generation) { next.forEach(p => p.refreshing = false); $('#refresh').disabled = false; $('#refresh').removeAttribute('aria-busy'); render(); }
  }
  return ok;
}
async function loadWing() {
  const holder = [mine(), ...S.pilots].find(p => p?.id && S.backend?.has(p.id));
  if (!holder) { S.wing = new Map(); return; }
  try { S.wing = new Map((await S.backend.wing(holder.id)).map(row => [row.characterId, row])); }
  catch (error) { notice(`Wingmate summary: ${error.message}`); }
}
// Value assets, then name and categorize the top holdings that the Wing screen shows.
async function loadHoldings() {
  if (!S.pilots.some(p => assetsOf(p))) return;
  await loadPrices();
  const top = S.pilots.flatMap(p => summary(p).holdings?.rows.slice(0, 60).map(r => r.type) || []);
  try { await Promise.all([resolveNames(top), loadAssetCategories(top)]); } catch { /* Names fall back to IDs. */ }
}
// The wing summary also carries the pilot's own figures, so drop it with their session.
function forgetWing(id) {
  S.wing.delete(id);
  if (!S.pilots.some(p => p.id && S.backend?.has(p.id))) S.wing = new Map();
}
export function clearPrivate(p) {
  forgetWing(p.id);
  Object.assign(p, {skills:p.shared?.skills, queue:p.shared?.queue, synced:p.shared?.fetchedAt, ops:undefined, private:false});
}
