// Bridge (home): your pilot, where you are, and your wingmate in plain sentences.
import {S, mine, wingmate, summary} from '../state.js';
import {name} from '../esi.js';
import {$, esc, isk, when, count, fact, portrait, corpLine, connectButtons, trainingAlert} from '../shared.js';

export const markup = {bridge:'<div id="pilots"></div>'};

function wingCard(p, s, o) {
  if (!o) return '<article class="card"><h3>Your wing</h3><p class="hint">No wingmate configured.</p></article>';
  const t = summary(o), sharing = o.private || S.wing.get(o.id)?.sharing;
  return `<article class="card wing-card"><h3>Your wing</h3>
    <div class="pilot-head" data-pilot="${esc(o.name.toLowerCase())}">${portrait(o, 40, 'portrait--sm')}<div><h2>${esc(o.name)}</h2><p class="hint">${corpLine(o)}</p></div>${t.title ? `<span class="role-badge">${esc(t.title)}</span>` : ''}</div>
    ${trainingAlert(o)}
    <dl class="readout">${fact('Net worth', count('wing-worth', t.worth, 'isk'))}${fact('Skill points', count('wing-sp', t.sp))}</dl>
    ${sharing ? '' : `<p class="hint">${esc(o.name)} hasn’t shared their sheet yet. Once they reconnect and tick “share with my wingmate”, their plans show up here.</p>`}
  </article>`;
}
export function render() {
  const p = mine(), o = wingmate();
  if (!p) { $('#pilots').innerHTML = '<div class="empty">Choose your pilot to begin.</div>'; return; }
  const i = S.pilots.indexOf(p), s = summary(p), ops = p.ops || {};
  const birthday = p.profile?.birthday, age = birthday ? Math.floor((Date.now() - Date.parse(birthday)) / 86400000) : null;
  const loc = ops.location?.value, ship = ops.ship?.value;
  $('#pilots').innerHTML = `
  <section class="me-banner panel panel--primary" data-pilot="${esc(p.name.toLowerCase())}">
    <div class="me-portrait">${portrait(p, 128, 'xl')}</div>
    <div class="me-info"><span class="role-badge title-chip">${esc(s.title || 'Unranked capsuleer')}</span><h1 class="screen-title">${esc(p.name)}</h1><p class="hint">${corpLine(p)}${age === null ? '' : ` · capsuleer for ${age.toLocaleString()} days`}</p>${trainingAlert(p)}${p.error ? `<p class="error">${esc(p.error)}</p>` : ''}${connectButtons(p, i)}</div>
    <dl class="me-stats readout">${fact('Skill points', count('me-sp', s.sp))}${fact('Net worth', count('me-worth', s.worth, 'isk'))}</dl>
  </section>
  <div class="grid">
    ${wingCard(p, s, o)}
    <article class="card"><h3>Ship &amp; position</h3><dl class="facts">
      ${fact('Location', loc ? `${esc(name(loc.solar_system_id))}<small>${loc.station_id ? esc(name(loc.station_id)) : loc.structure_id ? 'Docked in a structure' : 'In space'}</small>` : '—')}
      ${fact('Ship', ship ? `${esc(name(ship.ship_type_id))}<small>${esc(ship.ship_name || '')}</small>` : '—')}
      ${fact('Wallet', s.wallet !== undefined ? esc(isk(s.wallet)) : '—')}
      ${fact('Security status', Number.isFinite(p.profile?.security_status) ? p.profile.security_status.toFixed(2) : '—')}
    </dl>
    <details><summary>Corporation history</summary>${p.corp ? `<p class="hint">${Number(p.corp.member_count).toLocaleString()} members · ${(p.corp.tax_rate * 100).toFixed(1)}% tax</p>` : ''}${p.careerError ? `<p class="error">History unavailable: ${esc(p.careerError)}</p>` : ''}<ol class="career">${(p.career || []).map(item => `<li><b>${esc(item.name)}</b><span>Joined ${esc(new Date(item.start_date).toLocaleDateString())}</span></li>`).join('')}</ol></details>
    <p class="hint">${p.synced ? `EVE data from ${esc(when(p.synced))}` : S.backend ? 'Connect to share training and see private data.' : ''}</p></article>
  </div>`;
}
