import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup,mergeBackups,remaining,escapeHTML,filterEntries,trainingProgress,localDate} from '../model.js';
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
