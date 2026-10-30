import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup,mergeBackups,remaining,escapeHTML,filterEntries,trainingProgress,localDate,queueState,pilotRoles,pilotTitle,assetHoldings,shares,compactNumber} from '../model.js';
const goal={id:'goal-1',title:'Fly a cruiser',pilot:'Both pilots',done:false};
const entry={id:'entry-1',title:'First flight',pilot:'Pilot',date:'2026-10-30',body:'We made it home.'};
test('backup validation preserves journal records and strips unrelated data',()=>{
  assert.deepEqual(validateBackup({version:1,goals:[{...goal,token:'must not import'}],entries:[entry],secret:'ignored'}),{version:1,goals:[goal],entries:[entry]});
});
test('malformed backups cannot overwrite local records',()=>{
  for(const bad of [null,{}, {version:2,goals:[],entries:[]},{version:1,goals:[{...goal,done:'yes'}],entries:[]},{version:1,goals:[],entries:[{...entry,date:'invalid'}]}])assert.throws(()=>validateBackup(bad));
});
test('merge keeps existing entries and deduplicates stable IDs',()=>{
  const merged=mergeBackups({version:1,goals:[goal],entries:[entry]},{version:1,goals:[{...goal,done:true}],entries:[]});
  assert.equal(merged.goals.length,1);assert.equal(merged.goals[0].done,true);assert.deepEqual(merged.entries,[entry]);
});
test('queue timing handles future, finished, and paused dates',()=>{
  assert.equal(remaining('2026-10-31T02:00:00Z',Date.parse('2026-10-30T00:00:00Z')),'1d 2h remaining');
  assert.equal(remaining('2026-10-29',Date.parse('2026-10-30')),'Finished');assert.equal(remaining(undefined),'Not scheduled');
});
test('untrusted character names and notes render as text',()=>{assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');});

test('calendar validation rejects impossible dates and duplicate IDs',()=>{
  for(const date of ['2026-02-30','2026-13-01','2026-00-00'])assert.throws(()=>validateBackup({version:1,goals:[],entries:[{...entry,date}]}));
  assert.throws(()=>validateBackup({version:1,goals:[goal,goal],entries:[]}));
});
test('extended goal and entry fields survive backup restoration',()=>{
  const value={version:1,goals:[{...goal,category:'Ships',due:'2026-12-01'}],entries:[{...entry,category:'Milestone'}]};
  assert.deepEqual(validateBackup(value),value);
});

test('journal filters combine text, pilot and focus and sort newest first',()=>{
  const entries=[entry,{...entry,id:'2',title:'Wormhole',pilot:'Decxus',category:'Fleet',date:'2026-10-31'}];
  assert.deepEqual(filterEntries(entries,{query:'worm',pilot:'Decxus',category:'Fleet'}).map(e=>e.id),['2']);
  assert.deepEqual(filterEntries(entries).map(e=>e.id),['2','entry-1']);
  assert.equal(filterEntries(entries,{pilot:'Fiofka'}).length,0);
});
test('training progress handles future, active, complete, and paused skills',()=>{
  const skill={start_date:'2026-10-30T00:00:00Z',finish_date:'2026-10-31T00:00:00Z'};
  assert.equal(trainingProgress(skill,Date.parse('2026-10-30T12:00:00Z')),50);
  assert.equal(trainingProgress(skill,Date.parse('2026-10-29')),0);
  assert.equal(trainingProgress(skill,Date.parse('2026-11-01')),100);
  assert.equal(trainingProgress({}),0);
});
test('editor defaults use the local calendar date',()=>{assert.equal(localDate(new Date(2026,0,3,23,59)),'2026-01-03');});
test('queue state flags empty, paused, ending-soon and healthy training queues',()=>{
  const now=Date.parse('2026-10-30T12:00:00Z'),at=h=>new Date(now+h*3600000).toISOString();
  assert.equal(queueState(undefined,now),null);
  assert.equal(queueState([],now).kind,'empty');
  assert.equal(queueState([{skill_id:1,start_date:at(-5),finish_date:at(-1)}],now).kind,'empty');
  assert.equal(queueState([{skill_id:1,finished_level:3}],now).kind,'paused');
  const ending=queueState([{skill_id:1,start_date:at(-1),finish_date:at(2)},{skill_id:2,start_date:at(2),finish_date:at(10)}],now);
  assert.equal(ending.kind,'ending');assert.equal(ending.active.skill_id,1);assert.equal(ending.end,now+10*3600000);
  assert.equal(queueState([{skill_id:1,start_date:at(-1),finish_date:at(30)}],now).kind,'ok');
});
const groups={3300:'Gunnery',3327:'Spaceship Command',3380:'Production',3402:'Science'};
const groupOf=id=>groups[id];
test('pilot titles combine an SP rank with the strongest non-flight role',()=>{
  assert.equal(pilotTitle(null,groupOf),null);
  assert.equal(pilotTitle({total_sp:125000,skills:[{skill_id:3300,skillpoints_in_skill:90000},{skill_id:3327,skillpoints_in_skill:200000}]},groupOf),'Rookie Warrior');
  assert.equal(pilotTitle({total_sp:30e6,skills:[{skill_id:3380,skillpoints_in_skill:5e6},{skill_id:3402,skillpoints_in_skill:4e6},{skill_id:3300,skillpoints_in_skill:6e6}]},groupOf),'Veteran Industrialist');
  assert.equal(pilotTitle({total_sp:6e6,skills:[{skill_id:3327,skillpoints_in_skill:6e6}]},groupOf),'Seasoned Pilot');
  assert.equal(pilotTitle({total_sp:0,skills:[]},groupOf),'Rookie Capsuleer');
});
test('roles sum skill points per role and give shares of all trained SP',()=>{
  const roles=pilotRoles({skills:[{skill_id:3300,skillpoints_in_skill:75},{skill_id:999,skillpoints_in_skill:25}]},groupOf);
  assert.deepEqual(roles[0],{role:'combat',label:'Combat',sp:75,share:0.75});assert.equal(roles.reduce((t,r)=>t+r.share,0),0.75);
});
test('asset holdings value each type with known prices and sort by value',()=>{
  const h=assetHoldings({types:[[34,1000],[605,2],[1,5]]},new Map([[34,5],[605,1e6]]));
  assert.equal(h.total,2005000);assert.deepEqual(h.rows.map(r=>r.type),[605,34,1]);assert.equal(h.rows[2].value,0);
  assert.deepEqual(assetHoldings(null,new Map()),{rows:[],total:0});
});
test('shares ignore missing values and never divide by zero',()=>{
  assert.deepEqual(shares([30,10]),{total:40,shares:[0.75,0.25]});assert.deepEqual(shares([null,0]),{total:0,shares:[0,0]});assert.deepEqual(shares([NaN,5]).shares,[0,1]);
});
test('compact numbers for big ISK values',()=>{
  assert.equal(compactNumber(1234),'1.2k');assert.equal(compactNumber(12500000.25),'12.5M');assert.equal(compactNumber(250e9),'250B');assert.equal(compactNumber(-5500),'-5.5k');assert.equal(compactNumber(undefined),'—');assert.equal(compactNumber(999),'999');
});
