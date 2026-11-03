import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilities, groupPlan, crewLayout, wrap, word, ACTIVITIES} from '../capabilities.js';
import {SKILL} from '../mining.js';

const VIEWS = ['bridge','strengths','goals','training','skills','clones','industry','mining','exploration','market','map','hauling','ledger','logbook'];
const lv = map => id => map[id] || 0;
const pilot = (key, levels, extra = {}) => ({key, name:key[0].toUpperCase() + key.slice(1), known:true, level:lv(levels), ships:[], holdings:[], wallet:0, queue:[], ...extra});
const miner = pilot('decxus', {[SKILL.mining]:4, [SKILL.astrogeology]:3, [SKILL.miningFrigate]:1, [SKILL.miningBarge]:1, [SKILL.reprocessing]:3}, {ships:[17480], wallet:10e6});
const builder = pilot('fiofka', {3380:4, 3387:3, 3402:3, 3388:3, 3327:3}, {wallet:20e6, holdings:[{type:34, name:'Tritanium', qty:500000, value:2.5e6, cat:'Material'}]});
const by = (caps, act) => caps.find(c => c.activity === act);

test('a barge pilot with a Procurer is ready to mine, with credited leaves', () => {
  const caps = capabilities({pilots:[builder, miner], opportunities:{mining:{iskHour:2.5e6, label:'2.5M ISK/h at Niarja, 2 jumps', plan:'Pyroxeres at Niarja'}}});
  const m = by(caps, 'mining');
  assert.ok(m.score >= 50, `mining ${m.score}`);
  assert.equal(m.word, word(m.score));
  assert.ok(m.contributors.some(c => c.pilot === 'decxus' && c.kind === 'ship' && c.label === 'Decxus owns a Procurer'));
  assert.ok(m.contributors.some(c => c.pilot === 'decxus' && c.label === 'Decxus: Mining IV'));
  assert.ok(m.contributors.some(c => c.pilot === 'wing' && c.kind === 'opportunity'));
  assert.ok(Math.abs(m.contributors.reduce((t, c) => t + c.weight, 0) - 1) < 1e-9, 'weights are shares of the branch');
  assert.deepEqual(caps.map(c => c.score), [...caps.map(c => c.score)].sort((a, b) => b - a), 'sorted best first');
  assert.deepEqual(caps.map(c => c.activity).sort(), [...ACTIVITIES].sort());
});

test('a missing opportunity drops out and the other parts renormalise', () => {
  const p = pilot('fiofka', {3380:4, 3387:3, 3402:3, 3388:3}, {wallet:20e6, holdings:[]});
  const without = by(capabilities({pilots:[p]}), 'industry');
  assert.equal(without.parts.opportunity, null);
  // skills 1 × .35 + ships .5 × .25 + materials 0 + wallet 1 × .10, over .80
  assert.equal(without.score, Math.round(100 * (0.35 + 0.125 + 0.1) / 0.8));
  const withOpp = by(capabilities({pilots:[p], opportunities:{industry:{profitDay:1e6}}}), 'industry');
  assert.equal(withOpp.score, Math.round(100 * (0.35 + 0.125 + 0.1 + 0.2)));
});

test('a private wingmate makes the readiness partial', () => {
  const hidden = pilot('decxus', {}, {known:false, holdings:null, wallet:null});
  const caps = capabilities({pilots:[builder, hidden], opportunities:{industry:{profitDay:1e5}}});
  assert.equal(by(caps, 'industry').confidence, 'partial');
  assert.equal(by(capabilities({pilots:[builder, miner], opportunities:{industry:{profitDay:1e5}}}), 'industry').confidence, 'full');
});

test('both pilots contributing adds the synergy bonus but stays within 100', () => {
  const full = pilot('fiofka', {3380:5, 3387:5, 3402:5, 3388:5}, {wallet:1e9, holdings:[{type:34, name:'Tritanium', qty:1e9, value:1e9, cat:'Material'}], ships:[648]});
  const half = pilot('decxus', {3380:2}, {ships:[648]});
  const one = by(capabilities({pilots:[pilot('fiofka', {3380:2})]}), 'industry').parts.skills;
  const two = by(capabilities({pilots:[pilot('fiofka', {3380:2}), pilot('decxus', {3387:1})]}), 'industry').parts.skills;
  assert.ok(Math.abs(two - one - 0.1) < 0.1 && two > one, 'synergy adds up to 0.1');
  const capped = by(capabilities({pilots:[full, half], opportunities:{industry:{profitDay:9e9}}}), 'industry');
  assert.equal(capped.score, 100);
  assert.ok(capped.contributors.some(c => c.pilot === 'decxus'));
});

test('next steps name a pilot, a reason and a real view', () => {
  const caps = capabilities({pilots:[builder, pilot('decxus', {[SKILL.mining]:2})]});
  for (const c of caps) assert.ok(VIEWS.includes(c.next.go.tab), `${c.activity} → ${c.next.go.tab}`);
  const mining = by(caps, 'mining');
  assert.equal(mining.next.kind, 'skill');
  assert.equal(mining.next.label, 'Decxus: train Mining Frigate I', 'an entry skill, for the pilot already mining');
  const training = capabilities({pilots:[pilot('fiofka', {3300:3}, {queue:[{skill_id:3301, finished_level:2, finish_date:'2030-01-01'}]})]});
  assert.ok(by(training, 'combat').contributors.some(c => c.kind === 'training' && c.label === 'Fiofka is training Small Hybrid Turret II'));
});

test('the group plan assigns complementary jobs from the top three', () => {
  const caps = capabilities({pilots:[builder, miner], opportunities:{mining:{iskHour:2.5e6, plan:'Pyroxeres at Niarja'}, industry:{profitDay:3e5, plan:'a Hobgoblin I run'}}});
  const plan = groupPlan(caps, [builder, miner], {mining:{plan:'Pyroxeres at Niarja'}, industry:{plan:'a Hobgoblin I run'}});
  assert.equal(plan.assign.decxus, 'mining');
  assert.equal(plan.assign.fiofka, 'industry');
  assert.match(plan.sentence, /Decxus mines Pyroxeres at Niarja, while Fiofka builds from the ore/);
  assert.deepEqual(plan.roles, {fiofka:['Builder'], decxus:['Miner']});
  assert.doesNotMatch(plan.sentence, /lead|ahead|vs/i);
});

test('the crew layout is deterministic and keeps the fixed ring order', () => {
  const caps = capabilities({pilots:[builder, miner]});
  const a = crewLayout(caps), b = crewLayout([...caps].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a.branches.map(x => x.activity), ACTIVITIES);
  assert.equal(a.branches[0].angle, -60);
  for (const x of a.branches) {
    assert.equal(x.r, Math.round((16 + 0.26 * x.cap.score) * 10) / 10);
    assert.ok(Math.abs(Math.hypot(x.x - 500, x.y - 320) - 192) < 0.2);
    assert.ok(x.leaves.length <= 4);
    for (const l of x.leaves) assert.ok(Math.abs(Math.hypot(l.x - 500, l.y - 320) - 294.4) < 0.2);
  }
  const ind = a.branches.find(x => x.activity === 'industry');
  assert.equal(ind.leaves[0].anchor, 'start', 'right-hand leaves read outward');
  assert.ok(ind.links.some(l => l.pilot === 'fiofka'));
  assert.deepEqual(wrap('Fiofka is training Astrogeology III soon', 28), ['Fiofka is training', 'Astrogeology III soon']);
});
