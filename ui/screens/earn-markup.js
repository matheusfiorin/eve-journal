// Earn's static markup: the toolbars and empty views. It lives apart from the Earn code (ui/screens/earn.js) so the page
// can build every screen's DOM at boot and load the Earn code only when the first of its views opens.
import {skeleton} from '../shared.js';

// ── Shared building blocks ──
const tf = (label, control) => `<label class="tf">${label}${control}</label>`;
// Ids are passed as literal id="…" text so the markup block lists every control (tests/package.test.js checks it).
const filterBox = (id, what) => `<input ${id} class="tf-filter" type="search" data-filter placeholder="Filter ${what}" aria-label="Filter ${what}" aria-keyshortcuts="/" autocomplete="off">`;
const sortBox = (id, opts, cls = '') => `<label class="tf ${cls}">Sort<select ${id} data-sort-select>${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`;
const sw = (id, label, extra = '') => `<label class="sw"><input ${id} type="checkbox" ${extra}><span>${label}</span></label>`;
const bar = (label, html) => `<div class="toolbar earn-bar" role="toolbar" aria-label="${label}">${html}</div>`;
const wrap = (bar, status, content) => `<div class="earn">${bar}<p ${status} class="earn-status" role="status"></p><div ${content} class="earn-content">${skeleton('Loading…')}</div></div>`;

export const markup = {
  industry:wrap(bar('Build options', `
   ${tf('From', '<select id="industry-system"></select>')}
   ${tf('Budget', '<input id="industry-budget" type="text" data-isk placeholder="Your wallet" inputmode="decimal" autocomplete="off"><span class="isk-echo"></span>')}
   ${tf('Category', '<select id="industry-category"><option value="">All</option></select>')}
   ${sortBox('id="industry-sort"', [['', 'Best overall'], ['profit', 'Profit per day'], ['payback', 'Fastest payback'], ['margin', 'Highest margin'], ['invest', 'Lowest start cost'], ['cheap', 'Cheapest blueprint'], ['near', 'Closest seller']])}
   ${sw('id="industry-over"', 'Over budget')}
   ${filterBox('id="industry-filter"', 'blueprints')}`), 'id="industry-status"', 'id="industry-content"'),
  mining:wrap(bar('Mining options', `
   ${tf('From', '<select id="mining-system"></select>')}
   ${tf('Ship', '<select id="mining-ship"><option value="">Current or best</option><option value="32880">Venture</option><option value="17480">Procurer</option><option value="17478">Retriever</option><option value="17476">Covetor</option></select>')}
   ${tf('Within', '<select id="mining-jumps"><option value="3">3 jumps</option><option value="6" selected>6 jumps</option><option value="10">10 jumps</option></select>')}
   ${sw('id="mining-lowsec"', 'Low-sec')}
   ${sortBox('id="mining-sort"', [['', 'Best ISK/h'], ['jumps', 'Fewest jumps'], ['kills', 'Fewest kills'], ['traffic', 'Least traffic']], 'tf--m')}
   ${filterBox('id="mining-filter"', 'belts')}`), 'id="mining-status"', 'id="mining-content"'),
  exploration:wrap(bar('Exploration options', `
   ${tf('From', '<select id="explore-system"></select>')}
   ${tf('Within', '<select id="explore-jumps"><option value="5">5 jumps</option><option value="10" selected>10 jumps</option><option value="15">15 jumps</option><option value="20">20 jumps</option></select>')}
   ${tf('Risk', '<select id="explore-tolerance"><option value="careful">Careful</option><option value="normal" selected>Normal</option><option value="bold">Bold</option></select>')}
   ${tf('Loop', '<select id="explore-loop"><option value="4">4 systems</option><option value="6" selected>6 systems</option><option value="8">8 systems</option><option value="10">10 systems</option></select>')}
   <span class="bands" role="group" aria-label="Security">${sw('id="band-hi"', 'High', 'data-band="hi" checked')}${sw('id="band-low"', 'Low', 'data-band="low"')}${sw('id="band-null"', 'Null', 'data-band="null"')}</span>
   ${sortBox('id="explore-sort"', [['', 'Best score'], ['jumps', 'Fewest jumps'], ['traffic', 'Quietest'], ['kills', 'Fewest kills']], 'tf--m')}
   ${filterBox('id="explore-filter"', 'systems')}`), 'id="explore-status"', 'id="explore-content"'),
  market:wrap(bar('Trade options', `
   ${tf('From', '<select id="market-origin"></select>')}
   ${tf('Buy within', '<select id="market-jumps"><option value="5">5 jumps</option><option value="10" selected>10 jumps</option><option value="20">20 jumps</option><option value="99">Any distance</option></select>')}
   ${tf('Cargo m³', '<input id="market-cargo" type="number" min="1" step="100" value="5000" inputmode="numeric">')}
   ${tf('Budget', '<input id="market-budget" type="text" data-isk placeholder="Your wallet" inputmode="decimal" autocomplete="off"><span class="isk-echo"></span>')}
   ${sortBox('id="market-sort"', [['', 'Best first']], 'tf--m')}
   ${filterBox('id="market-filter"', 'items')}`), 'id="market-status"', 'id="market-content"'),
  planets:`<div class="earn">${bar('Planet options', filterBox('id="planets-filter"', 'colonies'))}<p id="planets-status" class="earn-status" role="status"></p><p id="planets-none" class="hint" hidden>No colonies match this filter.</p><div id="planets-content" class="earn-content">${skeleton('Loading…')}</div></div>`
};
