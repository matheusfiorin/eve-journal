export const emptyData = () => ({version:1, goals:[], entries:[]});
export function validateBackup(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.goals) || !Array.isArray(value.entries)) throw new Error('This is not a Flight Journal v1 backup.');
  if (value.goals.length + value.entries.length > 10000) throw new Error('Backup is too large.');
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  for (const item of [...value.goals,...value.entries]) {
    if (!text(item.id,100) || !item.id || !text(item.title,160) || !item.title.trim() || !text(item.pilot,100)) throw new Error('Invalid record in backup.');
  }
  for (const g of value.goals) if (typeof g.done !== 'boolean') throw new Error('Invalid goal.');
  for (const e of value.entries) if (!text(e.body,20000) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date))) throw new Error('Invalid journal entry.');
  return {version:1, goals:value.goals.map(({id,title,pilot,done})=>({id,title,pilot,done})), entries:value.entries.map(({id,title,pilot,date,body})=>({id,title,pilot,date,body}))};
}
export function mergeBackups(current, incoming) {
  const a=validateBackup(current), b=validateBackup(incoming);
  return {version:1, goals:[...new Map([...a.goals,...b.goals].map(g=>[g.id,g])).values()], entries:[...new Map([...a.entries,...b.entries].map(e=>[e.id,e])).values()]};
}
export function remaining(date, now=Date.now()) {
  const ms = new Date(date).getTime()-now;
  if (!Number.isFinite(ms)) return 'Not scheduled';
  if (ms<=0) return 'Finished';
  const hours=Math.ceil(ms/3600000);
  return hours<24 ? `${hours}h remaining` : `${Math.floor(hours/24)}d ${hours%24}h remaining`;
}
export function escapeHTML(value) {return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
