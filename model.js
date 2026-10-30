export const emptyData = () => ({version:1, goals:[], entries:[]});
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
export function validateBackup(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.goals) || !Array.isArray(value.entries)) throw new Error('This is not a Flight Journal v1 backup.');
  if (value.goals.length + value.entries.length > 10000) throw new Error('Backup is too large.');
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  for (const item of [...value.goals,...value.entries]) {
    if (!text(item.id,100) || !item.id || !text(item.title,160) || !item.title.trim() || !text(item.pilot,100)) throw new Error('Invalid record in backup.');
  }
  for (const g of value.goals) if (typeof g.done !== 'boolean') throw new Error('Invalid goal.');
  for (const g of value.goals) if ((g.due !== undefined && g.due !== '' && !validDate(g.due)) || (g.category !== undefined && !text(g.category,40))) throw new Error('Invalid goal details.');
  for (const e of value.entries) if (!text(e.body,20000) || !e.body.trim() || !validDate(e.date) || (e.category !== undefined && !text(e.category,40))) throw new Error('Invalid journal entry.');
  for (const list of [value.goals,value.entries]) if(new Set(list.map(x=>x.id)).size!==list.length) throw new Error('Duplicate record IDs in backup.');
  return {version:1, goals:value.goals.map(({id,title,pilot,done,due,category})=>({id,title,pilot,done,...(due?{due}:{}),...(category?{category}:{})})), entries:value.entries.map(({id,title,pilot,date,body,category})=>({id,title,pilot,date,body,...(category?{category}:{})}))};
}
export function mergeBackups(current, incoming) {
  const a=validateBackup(current), b=validateBackup(incoming);
  return validateBackup({version:1, goals:[...new Map([...a.goals,...b.goals].map(g=>[g.id,g])).values()], entries:[...new Map([...a.entries,...b.entries].map(e=>[e.id,e])).values()]});
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
export function shares(values) {
  const known = values.map(v => Number.isFinite(v) && v > 0 ? v : 0), total = known.reduce((a,b) => a + b, 0);
  return {total, shares:known.map(v => total ? v / total : 0)};
}
export function compactNumber(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  for (const [n, unit] of [[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'k']]) if (abs >= n) return `${(value / n).toFixed(abs / n >= 100 ? 0 : 1)}${unit}`;
  return Math.round(value).toLocaleString('en-US');
}
