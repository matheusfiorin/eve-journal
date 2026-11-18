// Market orders and contracts, as plain functions. Is a pilot's market order still the best at its station or in its region? Pure: the browser feeds it the market
// snapshot's regions ({region, data:{types:{id:{s:[[loc,price,volume]],b:[...]}}}}), the Worker a slice of the same rows.
const EPS = 0.005;
/** {state:'best'|'outbid'|'unchecked', by?, scope?:'station'|'region'}. Unchecked: that region or item is not in the snapshot. */
export function checkOrder(order, regions) {
  const t = regions?.find(r => r.region === order.region_id)?.data?.types?.[order.type_id];
  if (!t) return {state:'unchecked'};
  const list = order.is_buy_order ? t.b : t.s;
  if (!Array.isArray(list)) return {state:'unchecked'};
  // A buy order loses to a higher bid, a sell order to a lower ask.
  const gap = price => order.is_buy_order ? price - order.price : order.price - price;
  const here = list.find(row => row[0] === order.location_id);
  if (here) return gap(here[1]) > EPS ? {state:'outbid', by:gap(here[1]), scope:'station'} : {state:'best'};
  const top = list.reduce((best, row) => best === null || gap(row[1]) > gap(best) ? row[1] : best, null);
  return top !== null && gap(top) > EPS ? {state:'outbid', by:gap(top), scope:'region'} : {state:'best'};
}
const DAY = 86400000;
/** Days left on a live order (never below 0). */
export const daysLeft = (order, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(order.issued) + order.duration * DAY - now) / DAY));
/** How an order in the history ended: filled, expired or cancelled. */
export const outcome = order => order.state === 'cancelled' ? 'cancelled' : order.volume_remain === 0 ? 'filled' : 'expired';
/** Counts and ISK of the orders that ended in the last `days` days (an order counts once it was issued or ran out inside that window). */
export function historySummary(list, now = Date.now(), days = 30) {
  const since = now - days * DAY, out = {filled:0, expired:0, cancelled:0, sold:0, bought:0};
  for (const o of list || []) {
    const issued = Date.parse(o.issued), end = issued + o.duration * DAY;
    if (!(issued >= since || (end >= since && end <= now))) continue;
    out[outcome(o)]++;
    const value = (o.volume_total - o.volume_remain) * o.price;
    if (value > 0) out[o.is_buy_order ? 'bought' : 'sold'] += value;
  }
  return out;
}
/** When an open contract runs out, in ms: its expiry while outstanding, the courier deadline once accepted; null when it has none (or is over). */
export function contractDue(c) {
  if (c.status === 'outstanding') { const end = Date.parse(c.date_expired); return Number.isFinite(end) ? end : null; }
  if (c.status === 'in_progress' && c.type === 'courier') { const end = Date.parse(c.date_accepted) + c.days_to_complete * DAY; return Number.isFinite(end) ? end : null; }
  return null;
}
