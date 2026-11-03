// Industry jobs for the wing: what each job is, how far along, and which slots sit idle. Pure functions.
import {slots} from './industry.js';

export const ACTIVITIES = {1:'Manufacturing', 3:'TE research', 4:'ME research', 5:'Copying', 7:'Reverse engineering', 8:'Invention', 9:'Reactions', 11:'Reactions'};
// Manufacturing and reactions use build slots; research, copying and invention use science slots.
const SCIENCE = new Set([3, 4, 5, 7, 8]);
export const slotKind = activity => SCIENCE.has(activity) ? 'science' : 'build';

// One job's state at `now`: ESI still says "active" for a few minutes after a job ends, so a past end date counts as ready.
export function jobState(job, now = Date.now()) {
  const start = Date.parse(job.start_date), end = Date.parse(job.end_date);
  const progress = Number.isFinite(start) && end > start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : job.status === 'ready' ? 1 : 0;
  const ready = job.status === 'ready' || (job.status === 'active' && end <= now);
  return {progress, remaining:Math.max(0, end - now), ready, paused:job.status === 'paused', active:job.status === 'active' && !ready};
}

// Every pilot's jobs in one list: ready first, then the soonest to finish. pilots: [{name, jobs, levels}].
export function wingJobs(pilots, now = Date.now()) {
  const list = pilots.flatMap(p => (p.jobs || []).filter(j => ['active', 'ready', 'paused'].includes(j.status))
    .map(job => ({pilot:p.name, job, activity:ACTIVITIES[job.activity_id] || 'Industry', kind:slotKind(job.activity_id), ...jobState(job, now)})));
  list.sort((a, b) => (b.ready - a.ready) || (a.paused - b.paused) || a.remaining - b.remaining);
  const running = list.filter(x => x.active);
  const usage = pilots.map(p => {
    const mine = list.filter(x => x.pilot === p.name && !x.ready), total = p.levels ? slots(p.levels) : null;
    return {pilot:p.name, build:mine.filter(x => x.kind === 'build').length, science:mine.filter(x => x.kind === 'science').length, total};
  });
  return {list, ready:list.filter(x => x.ready).length, running:running.length, next:running[0] || null, usage};
}
