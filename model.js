export const emptyData = () => ({version:1, goals:[], entries:[]});
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
// Fields this build knows, in the order records are written: sync fingerprints (ui/syncplan.js) need a stable order.
const GOAL_KEYS = ['id','title','pilot','done','due','category','notes','target','result','steps','updatedAt'], ENTRY_KEYS = ['id','title','pilot','date','body','category','updatedAt'], STEP_KEYS = ['text','done'];
// Fields a newer build added are kept as they are, so an older tab, device or backup can't strip them on its next save
// or sync. They must be plain JSON with no prototype keys, and a record's extras (its steps' included) are capped: the
// known fields are bounded already, so the whole record stays within what the Worker accepts.
export const EXTRA_MAX = 8000;
const BAD_KEYS = new Set(['__proto__','constructor','prototype']);
function plain(v, depth = 0) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'object' || depth > 5) return false;
  if (Array.isArray(v)) return v.every(x => plain(x, depth + 1));
  const proto = Object.getPrototypeOf(v);
  return (proto === Object.prototype || proto === null) && Object.keys(v).every(k => !BAD_KEYS.has(k) && plain(v[k], depth + 1));
}
function extras(item, known) {
  const out = {};
  for (const k of Object.keys(item).filter(k => !known.includes(k)).sort()) {
    if (item[k] === undefined) continue; // Never reaches JSON anyway.
    if (BAD_KEYS.has(k) || !plain(item[k])) throw new Error('Invalid extra field in backup.');
    out[k] = item[k];
  }
  return out;
}
// Copies the extras (a record never shares nested objects with its input) and enforces the cap.
function fit(...parts) {
  const json = JSON.stringify(parts);
  if (json.length > EXTRA_MAX) throw new Error('A record in this backup carries too much extra data.');
  return JSON.parse(json);
}
// updatedAt is the edit time in ms since 1970; merges keep the newer copy of a record (see mergeBackups).
const stamp = v => v === undefined || (Number.isSafeInteger(v) && v > 0 && v <= 8.64e15);
// Stamp an edit, never earlier than the record's last stamp, so a device whose clock runs behind still moves it forward.
export const editedAt = (prior, now = Date.now()) => Math.max(now, (prior?.updatedAt || 0) + 1);
export function validateBackup(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.goals) || !Array.isArray(value.entries)) throw new Error('This is not a Flight Journal v1 backup.');
  if (value.goals.length + value.entries.length > 10000) throw new Error('Backup is too large.');
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  for (const item of [...value.goals,...value.entries]) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !text(item.id,100) || !item.id || !text(item.title,160) || !item.title.trim() || !text(item.pilot,100) || !stamp(item.updatedAt)) throw new Error('Invalid record in backup.');
  }
  for (const g of value.goals) if (typeof g.done !== 'boolean') throw new Error('Invalid goal.');
  for (const g of value.goals) if ((g.due !== undefined && g.due !== '' && !validDate(g.due)) || (g.category !== undefined && !text(g.category,40))) throw new Error('Invalid goal details.');
  // Optional goal details: notes, an ISK target, the actual result, and a checklist of steps.
  const isk = v => v === undefined || v === '' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e15);
  for (const g of value.goals) if ((g.notes !== undefined && !text(g.notes,4000)) || !isk(g.target) || !isk(g.result) || (g.steps !== undefined && (!Array.isArray(g.steps) || g.steps.length > 30 || g.steps.some(st => !st || typeof st !== 'object' || !text(st.text,160) || !st.text.trim() || typeof st.done !== 'boolean')))) throw new Error('Invalid goal details.');
  for (const e of value.entries) if (!text(e.body,20000) || !e.body.trim() || !validDate(e.date) || (e.category !== undefined && !text(e.category,40))) throw new Error('Invalid journal entry.');
  for (const list of [value.goals,value.entries]) if(new Set(list.map(x=>x.id)).size!==list.length) throw new Error('Duplicate record IDs in backup.');
  const at = ({updatedAt}) => updatedAt ? {updatedAt} : {};
  return {version:1, goals:value.goals.map(g => {
    const {id,title,pilot,done,due,category,notes,target,result,steps} = g, [more, stepMore] = fit(extras(g, GOAL_KEYS), (steps || []).map(st => extras(st, STEP_KEYS)));
    return {id,title,pilot,done,...(due?{due}:{}),...(category?{category}:{}),...(notes?{notes}:{}),...(typeof target==='number'?{target}:{}),...(typeof result==='number'?{result}:{}),...(steps?.length?{steps:steps.map(({text,done},i)=>({text,done,...stepMore[i]}))}:{}),...at(g),...more};
  }), entries:value.entries.map(e => {
    const {id,title,pilot,date,body,category} = e, [more] = fit(extras(e, ENTRY_KEYS));
    return {id,title,pilot,date,body,...(category?{category}:{}),...at(e),...more};
  })};
}
// Each id keeps whichever copy was edited last, so an old backup can't revert newer edits. Records without updatedAt
// (written before it existed) count as oldest, and on a tie the current copy stays.
const newer = (theirs, mine) => !mine || (theirs.updatedAt || 0) > (mine.updatedAt || 0);
function pick(mine, theirs) {
  const out = new Map(mine.map(r => [r.id, r]));
  for (const r of theirs) if (newer(r, out.get(r.id))) out.set(r.id, r);
  return [...out.values()];
}
// A pilot's synced preference (journal kind 'pref'): id '<name>:<characterId>'. Checked the same in the browser and the
// Worker, so neither side stores what the other would refuse. Returns the record with only the known fields.
export const PREF_MARKS = 1000, PREF_BYTES = 64000;
export function validatePref(record) {
  const [name, owner] = typeof record?.id === 'string' ? record.id.split(':') : [];
  if (!/^\d{1,12}$/.test(owner || '')) throw new Error('Invalid preference id.');
  const text = (v, max) => typeof v === 'string' && v.length <= max, when = v => Number.isSafeInteger(v) && v >= 0;
  let out;
  if (name === 'explored') {
    const marks = record.marks;
    if (!marks || typeof marks !== 'object' || Array.isArray(marks) || Object.keys(marks).length > PREF_MARKS || Object.entries(marks).some(([k, v]) => !/^\d{8}$/.test(k) || !when(v))) throw new Error('Invalid scanned systems.');
    out = {id:record.id, marks:{...marks}};
  } else if (name === 'haul') {
    const {stops = [], value = '', volume = '', avoid = '', updatedAt} = record;
    if (!Array.isArray(stops) || stops.length > 50 || stops.some(s => !text(s, 100)) || ![value, volume].every(v => (typeof v === 'number' && Number.isFinite(v)) || text(v, 30)) || !text(avoid, 2000) || !when(updatedAt)) throw new Error('Invalid haul plan.');
    out = {id:record.id, stops:[...stops], value:String(value), volume:String(volume), avoid, updatedAt};
  } else throw new Error('Unknown preference.');
  if (JSON.stringify(out).length > PREF_BYTES) throw new Error('Preference is too large.');
  return out;
}
export function mergeBackups(current, incoming) {
  const a=validateBackup(current), b=validateBackup(incoming);
  return validateBackup({version:1, goals:pick(a.goals,b.goals), entries:pick(a.entries,b.entries)});
}
// What a merge would do with each incoming record, for the import prompt.
export function mergeSummary(current, incoming) {
  const a=validateBackup(current), b=validateBackup(incoming), out={added:0, newer:0, kept:0};
  for (const [mine, theirs] of [[a.goals,b.goals],[a.entries,b.entries]]) {
    const have = new Map(mine.map(r => [r.id, r]));
    for (const r of theirs) out[!have.has(r.id) ? 'added' : newer(r, have.get(r.id)) ? 'newer' : 'kept']++;
  }
  return out;
}
export function trainingProgress(item, now = Date.now()) {
  const start=Date.parse(item.start_date), end=Date.parse(item.finish_date);
  return Number.isFinite(start) && end > start ? Math.max(0,Math.min(100,(now-start)/(end-start)*100)) : 0;
}
export function filterEntries(entries, {query='',pilot='',category=''}={}) {
  const needle=query.trim().toLocaleLowerCase();
  return entries.filter(e=>(!pilot || e.pilot===pilot) && (!category || e.category===category) &&
    (!needle || `${e.title} ${e.body}`.toLocaleLowerCase().includes(needle))).sort((a,b)=>b.date.localeCompare(a.date));
}
export function remaining(date, now=Date.now()) {
  const ms = new Date(date).getTime()-now;
  if (!Number.isFinite(ms)) return 'Not scheduled';
  if (ms<=0) return 'Finished';
  const hours=Math.ceil(ms/3600000);
  return hours<24 ? `${hours}h remaining` : `${Math.floor(hours/24)}d ${hours%24}h remaining`;
}
export function escapeHTML(value) {return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Training is the one thing a pilot must never let lapse, so classify the queue for alerts.
export function queueState(queue, now = Date.now()) {
  if (!Array.isArray(queue)) return null;
  const pending = queue.filter(q => !q.finish_date || Date.parse(q.finish_date) > now);
  if (!pending.length) return {kind:'empty', pending};
  const active = pending.find(q => Date.parse(q.start_date) <= now && Date.parse(q.finish_date) > now);
  const ends = pending.map(q => Date.parse(q.finish_date)).filter(Number.isFinite);
  const end = ends.length ? Math.max(...ends) : null;
  if (!active) return {kind:'paused', pending, end};
  return {kind: end - now < 86400000 ? 'ending' : 'ok', pending, active, end};
}

// Skill groups (ESI names) folded into the roles a pilot is known for.
// Active level of one skill type in an ESI skills payload; 0 when the skill or the payload is unknown.
export const levelOf = (skills, id) => skills?.skills?.find(s => s.skill_id === id)?.active_skill_level || 0;
export const ROLES = {
  combat:{noun:'Warrior', label:'Combat', groups:['Gunnery','Missiles','Drones','Targeting','Shields','Armor']},
  industry:{noun:'Industrialist', label:'Industry', groups:['Production','Resource Processing','Science','Planet Management','Structure Management']},
  commerce:{noun:'Trader', label:'Commerce', groups:['Trade','Social','Corporation Management']},
  exploration:{noun:'Explorer', label:'Exploration', groups:['Scanning']},
  leadership:{noun:'Commander', label:'Leadership', groups:['Leadership','Fleet Support']},
  flight:{noun:'Pilot', label:'Flight', groups:['Spaceship Command','Navigation','Engineering','Rigging','Subsystems','Electronic Systems']}
};
const RANKS = [[100e6,'Legendary'],[50e6,'Elite'],[20e6,'Veteran'],[5e6,'Seasoned'],[0,'Rookie']];
export function pilotRoles(skills, groupOf) {
  const totals = Object.fromEntries(Object.keys(ROLES).map(k => [k, 0]));
  let all = 0;
  for (const s of skills?.skills || []) {
    const sp = s.skillpoints_in_skill || 0, group = groupOf(s.skill_id);
    const role = Object.keys(ROLES).find(k => ROLES[k].groups.includes(group));
    all += sp; if (role) totals[role] += sp;
  }
  return Object.entries(totals).map(([role, sp]) => ({role, label:ROLES[role].label, sp, share:all ? sp / all : 0})).sort((a,b) => b.sp - a.sp);
}
// Flight skills are trained by everyone, so they only name a pilot who has nothing else.
export function pilotTitle(skills, groupOf) {
  if (!skills) return null;
  const rank = RANKS.find(([min]) => (skills.total_sp || 0) >= min)[1];
  const roles = pilotRoles(skills, groupOf).filter(r => r.sp > 0);
  const lead = roles.find(r => r.role !== 'flight') || roles[0];
  return `${rank} ${lead ? ROLES[lead.role].noun : 'Capsuleer'}`;
}
export function assetHoldings(summary, prices) {
  const rows = (summary?.types || []).map(([type, quantity]) => ({type, quantity, value:quantity * (prices.get(type) || 0)}));
  return {rows:rows.sort((a,b) => b.value - a.value), total:rows.reduce((t, r) => t + r.value, 0)};
}
export function compactNumber(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  for (const [n, unit] of [[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'k']]) if (abs >= n) return `${(value / n).toFixed(abs / n >= 100 ? 0 : 1)}${unit}`;
  return Math.round(value).toLocaleString('en-US');
}
