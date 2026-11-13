import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup,mergeBackups,mergeSummary,editedAt,EXTRA_MAX,remaining,escapeHTML,filterEntries,trainingProgress,localDate,queueState,pilotRoles,pilotTitle,assetHoldings,compactNumber} from '../model.js';
const goal={id:'goal-1',title:'Fly a cruiser',pilot:'Both pilots',done:false};
const entry={id:'entry-1',title:'First flight',pilot:'Pilot',date:'2026-10-30',body:'We made it home.'};
test('backup validation keeps fields a newer build added to records and drops unrelated top-level data',()=>{
  const g={...goal,shipFit:{hull:'Heron',slots:[1,2]},token:'kept as data',steps:[{text:'Train',done:false,doneAt:5}]};
  const out=validateBackup({version:1,goals:[g],entries:[{...entry,mood:3}],secret:'ignored'});
  assert.deepEqual(out,{version:1,goals:[g],entries:[{...entry,mood:3}]});
  assert.deepEqual(Object.keys(out.goals[0]),['id','title','pilot','done','steps','shipFit','token'],'known fields first, extras sorted, so fingerprints are stable');
  assert.notEqual(out.goals[0].shipFit,g.shipFit,'extras are copied');
});
test('extra fields must be plain, bounded JSON without prototype keys',()=>{
  const ok=extra=>validateBackup({version:1,goals:[],entries:[{...entry,...extra}]});
  assert.deepEqual(ok({gone:undefined}).entries[0],entry);
  for(const bad of ['{"__proto__":{"admin":true}}','{"x":{"constructor":1}}','{"x":[{"prototype":1}]}'])assert.throws(()=>ok(JSON.parse(bad)),/extra field/);
  for(const bad of [{x:()=>1},{x:new Date()},{x:NaN},{x:[[[[[[[1]]]]]]]}])assert.throws(()=>ok(bad),/extra field/);
  assert.throws(()=>ok({x:'a'.repeat(EXTRA_MAX)}),/too much extra data/);
  assert.equal(ok({x:'a'.repeat(EXTRA_MAX-20)}).entries[0].x.length,EXTRA_MAX-20);
  assert.throws(()=>validateBackup({version:1,goals:[{...goal,steps:Array.from({length:30},()=>({text:'s',done:false,note:'n'.repeat(300)}))}],entries:[]}),/too much extra data/,'steps share the record cap');
  assert.equal(Object.getPrototypeOf(ok({}).entries[0]),Object.prototype);
});
test('updatedAt is an edit time in ms: validated, kept, and optional so old backups still load',()=>{
  const at=1762000000000;
  assert.equal(validateBackup({version:1,goals:[{...goal,updatedAt:at}],entries:[{...entry,updatedAt:at}]}).entries[0].updatedAt,at);
  for(const updatedAt of ['2026-11-01T00:00:00Z',0,-1,1.5,1e16,null])assert.throws(()=>validateBackup({version:1,goals:[],entries:[{...entry,updatedAt}]}),/Invalid record/);
  assert.deepEqual(validateBackup({version:1,goals:[goal],entries:[entry]}),{version:1,goals:[goal],entries:[entry]});
  assert.equal(editedAt(undefined,at),at);assert.equal(editedAt({updatedAt:at+5000},at),at+5001,'a clock behind the last edit still moves it forward');
});
test('malformed backups cannot overwrite local records',()=>{
  for(const bad of [null,{}, {version:2,goals:[],entries:[]},{version:1,goals:[{...goal,done:'yes'}],entries:[]},{version:1,goals:[],entries:[{...entry,date:'invalid'}]}])assert.throws(()=>validateBackup(bad));
});
test('merge keeps existing entries and deduplicates stable IDs',()=>{
  const merged=mergeBackups({version:1,goals:[goal],entries:[entry]},{version:1,goals:[{...goal,done:true,updatedAt:5}],entries:[]});
  assert.equal(merged.goals.length,1);assert.equal(merged.goals[0].done,true);assert.deepEqual(merged.entries,[entry]);
});
test('merge keeps the newer copy of each record; unstamped counts as oldest and a tie keeps the current copy',()=>{
  const now={...entry,body:'Edited today.',updatedAt:2000},old={...entry,body:'From the backup.',updatedAt:1000};
  assert.equal(mergeBackups({version:1,goals:[],entries:[now]},{version:1,goals:[],entries:[old]}).entries[0].body,'Edited today.','an old backup does not revert a newer edit');
  assert.equal(mergeBackups({version:1,goals:[],entries:[old]},{version:1,goals:[],entries:[now]}).entries[0].body,'Edited today.');
  assert.equal(mergeBackups({version:1,goals:[],entries:[now]},{version:1,goals:[],entries:[entry]}).entries[0].body,'Edited today.','an unstamped backup copy loses');
  assert.equal(mergeBackups({version:1,goals:[],entries:[entry]},{version:1,goals:[],entries:[old]}).entries[0].body,'From the backup.','a stamped copy beats an unstamped one');
  assert.equal(mergeBackups({version:1,goals:[],entries:[entry]},{version:1,goals:[],entries:[{...entry,body:'Other'}]}).entries[0].body,entry.body,'tie: both unstamped');
  assert.equal(mergeBackups({version:1,goals:[],entries:[now]},{version:1,goals:[],entries:[{...now,body:'Other'}]}).entries[0].body,'Edited today.','tie: same stamp');
  const both={version:1,goals:[{...goal,updatedAt:3000,plan:'v2'}],entries:[now]},incoming={version:1,goals:[{...goal,title:'Older',updatedAt:10}],entries:[old,{...entry,id:'e9'}]};
  assert.deepEqual(mergeBackups(both,incoming),{version:1,goals:both.goals,entries:[now,{...entry,id:'e9'}]},'a newer field from this build survives too');
  assert.deepEqual(mergeSummary(both,incoming),{added:1,newer:0,kept:2});
  assert.deepEqual(mergeSummary({version:1,goals:[],entries:[old]},{version:1,goals:[],entries:[now]}),{added:0,newer:1,kept:0});
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
test('compact numbers for big ISK values',()=>{
  assert.equal(compactNumber(1234),'1.2k');assert.equal(compactNumber(12500000.25),'12.5M');assert.equal(compactNumber(250e9),'250B');assert.equal(compactNumber(-5500),'-5.5k');assert.equal(compactNumber(undefined),'—');assert.equal(compactNumber(999),'999');
});
test('goals keep optional notes, an ISK target, the result and checklist steps, and reject bad ones',async()=>{
 const {validateBackup}=await import('../model.js');
 const g={id:'g1',title:'Profit 1M',pilot:'Fiofka',done:false,notes:'ME 7 / TE 18',target:1e6,result:250000,steps:[{text:'Copy BPCs',done:true},{text:'Sell',done:false}]};
 assert.deepEqual(validateBackup({version:1,goals:[g],entries:[]}).goals[0],g);
 assert.deepEqual(validateBackup({version:1,goals:[{id:'g2',title:'Old',pilot:'A',done:true}],entries:[]}).goals[0],{id:'g2',title:'Old',pilot:'A',done:true},'old goals still load');
 for(const bad of [{target:'lots'},{result:Infinity},{steps:[{text:'',done:false}]},{steps:'x'},{notes:'x'.repeat(4001)}])assert.throws(()=>validateBackup({version:1,goals:[{...g,...bad}],entries:[]}),/Invalid goal/);
});
