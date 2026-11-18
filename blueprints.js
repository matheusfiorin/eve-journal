// A pilot's own blueprints, from the rows the Worker keeps: [type, originals, copies, ME, TE, runs left on copies, location?].
// ME, TE and location are those of the blueprint they would build with: the best original, else the best copy.
export function owned(rows) {
  const by = new Map();
  for (const [type, originals, copies, me, te, runs, loc] of Array.isArray(rows) ? rows : [])
    by.set(type, {type, kind:originals > 0 ? 'bpo' : 'bpc', originals, copies, me, te, runs:originals > 0 ? Infinity : runs, copyRuns:runs, loc});
  return by;
}
export const ownedLabel = o => o.kind === 'bpo' ? `Owned (ME ${o.me}/TE ${o.te})` : `Copy, ${o.runs} ${o.runs === 1 ? 'run' : 'runs'}`;
/** The list for "My blueprints": one row per type, name and kind searchable, originals first, then by name. */
export function library(rows, nameOf, query = '') {
  const q = query.trim().toLowerCase();
  return [...owned(rows).values()].map(o => ({...o, name:nameOf(o.type) || `Type ${o.type}`, label:ownedLabel(o)}))
    .filter(o => !q || `${o.name} ${o.kind === 'bpo' ? 'original bpo' : 'copy bpc'} me ${o.me} te ${o.te}`.toLowerCase().includes(q))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'bpo' ? -1 : 1) || a.name.localeCompare(b.name));
}
