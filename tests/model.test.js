import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup,mergeBackups,remaining,escapeHTML} from '../model.js';
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
