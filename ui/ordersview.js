// A pilot's market orders: the live ones with an outbid check against the market snapshot, and the last 30 days of history.
// Earn → Trade shows the whole section; the Ledger shows a one-line summary (ordersLine).
import {checkOrder, daysLeft, outcome, historySummary} from '../orders.js';
import {S} from './state.js';
import {name, place} from './esi.js';
import {esc, isk, format, plural, permissionBanner, connectButtons, day} from './shared.js';

const side = o => o.is_buy_order ? 'Buy' : 'Sell';
function status(o) {
  const c = checkOrder(o, S.marketData?.regions);
  if (c.state === 'outbid') return `<span class="chip chip--danger">Outbid by ${esc(isk(c.by))}</span>${c.scope === 'region' ? '<small>Better price at another station in the region.</small>' : ''}`;
  return c.state === 'best' ? '<span class="chip chip--ok">Best price</span>' : '<span class="chip">Not checked</span>';
}
const row = o => `<li class="orow" data-order="${o.order_id}" data-side="${o.is_buy_order ? 'buy' : 'sell'}">
  <div class="orow__main"><b>${esc(name(o.type_id))}</b><small>${side(o)} · ${esc(place(o.location_id))} · ${(() => { const d = daysLeft(o); return d ? `${plural(d, 'day')} left` : 'expires today'; })()}</small></div>
  <div class="orow__fig"><span class="num">${esc(isk(o.price))}</span><small>${Number(o.volume_remain).toLocaleString()} of ${Number(o.volume_total).toLocaleString()} left</small></div>
  <div class="orow__status">${status(o)}</div></li>`;
const past = o => `<li class="orow"><div class="orow__main"><b>${esc(name(o.type_id))}</b><small>${side(o)} · ${esc(day(o.issued))}</small></div>
  <div class="orow__fig"><span class="num">${esc(isk(o.price))}</span><small>${(o.volume_total - o.volume_remain).toLocaleString()} of ${Number(o.volume_total).toLocaleString()} traded</small></div>
  <div class="orow__status"><span class="chip">${{filled: 'Filled', expired: 'Expired', cancelled: 'Cancelled'}[outcome(o)]}</span></div></li>`;
export function historyLine(list) {
  const s = historySummary(list);
  const parts = [s.filled && `${s.filled} filled`, s.expired && `${s.expired} expired`, s.cancelled && `${s.cancelled} cancelled`].filter(Boolean);
  const money = [s.sold && `${format(s.sold, 'isk')} sold`, s.bought && `${format(s.bought, 'isk')} bought`].filter(Boolean);
  return parts.length ? `${parts.join(', ')}${money.length ? ` · ${money.join(', ')}` : ''}` : 'Nothing filled or expired';
}
export function ordersSection(p) {
  const head = '<div class="panel__head"><div><h2 id="orders-title">My orders</h2><p class="panel__sub">Your open market orders, checked against the last market scan.</p></div></div>';
  const wrap = body => `<section class="panel orders" aria-labelledby="orders-title">${head}${body}</section>`;
  if (!p) return '';
  if (!p.private) return wrap(`<div class="state"><p><b>${esc(p.name)}’s orders are private.</b> Connect ${esc(p.name)} in this browser to see them.</p>${connectButtons(p, S.pilots.indexOf(p))}</div>`);
  const orders = p.ops?.orders, history = p.ops?.orderHistory;
  if (!orders) return wrap('<p class="hint">Not synced yet. Press Refresh.</p>');
  if (!orders.permission) return wrap(permissionBanner(p, ['market orders']));
  const live = orders.value || [];
  const body = !Array.isArray(orders.value) ? `<p class="hint">${esc(orders.error || 'Not synced yet. Press Refresh.')}</p>`
    : live.length ? `<ul class="olist" aria-label="Open orders">${live.map(row).join('')}</ul>${orders.error ? `<p class="error">${esc(orders.error)} Showing the previous orders.</p>` : ''}` : '<div class="state"><p><b>No open market orders.</b> Orders you place in game show up here after the next sync.</p></div>';
  const past30 = history?.permission && Array.isArray(history.value) ? `<details class="orders__history"><summary>Last 30 days: ${esc(historyLine(history.value))}</summary>${history.value.length ? `<ul class="olist" aria-label="Order history">${history.value.slice(0, 20).map(past).join('')}</ul>` : ''}</details>` : '';
  return wrap(body + past30);
}
/** The Ledger's line: how many orders are open, what they list, how many are outbid, and how the last 30 days went. */
export function ordersLine(p) {
  const orders = p.ops?.orders, history = p.ops?.orderHistory;
  if (!orders) return 'Not synced yet';
  if (!orders.permission) return 'Needs permission';
  if (!Array.isArray(orders.value)) return 'Not synced yet';
  const live = orders.value, sells = live.filter(o => !o.is_buy_order), outbid = live.filter(o => checkOrder(o, S.marketData?.regions).state === 'outbid').length;
  const listed = sells.reduce((t, o) => t + o.price * o.volume_remain, 0);
  const now = live.length ? `${plural(live.length, 'open order')} (${sells.length} sell, ${live.length - sells.length} buy)${listed ? `, ${format(listed, 'isk')} listed` : ''}${S.marketData ? ` · ${outbid ? `${outbid} outbid` : 'none outbid'}` : ''}` : 'No open orders';
  return `${now}${history?.permission && Array.isArray(history.value) ? ` · last 30 days: ${historyLine(history.value)}` : ''}`;
}
