import test from 'node:test';
import assert from 'node:assert/strict';
import {JournalStore} from '../storage.js';
const value={version:1,goals:[{id:'1',title:'Explore',pilot:'Both pilots',done:false}],entries:[]};
function storage(initial=null){let raw=initial;return {getItem(){return raw;},setItem(k,v){raw=v;}};}
test('new journals persist and reload without changing records',()=>{
  const s=storage(),a=new JournalStore(s,'journal');assert.equal(a.load().entries.length,0);a.save(value);
  assert.deepEqual(new JournalStore(s,'journal').load(),value);
});
test('corrupt journals lock all writes and preserve the recovery bytes',()=>{
  const raw='{"entries": BROKEN',s=storage(raw),a=new JournalStore(s,'journal');
  assert.throws(()=>a.load(),/blocked/);assert.throws(()=>a.save(value),/blocked/);assert.equal(s.getItem(),raw);
});
test('a second tab cannot silently overwrite a newly saved goal',()=>{
  const s=storage(),a=new JournalStore(s,'journal'),b=new JournalStore(s,'journal');a.load();b.load();a.save(value);
  assert.throws(()=>b.save({version:1,goals:[],entries:[]}),/Another tab/);assert.deepEqual(JSON.parse(s.getItem()),value);
});
test('quota errors do not advance saved state or mutate the stored journal',()=>{
  const s=storage(JSON.stringify(value)),a=new JournalStore(s,'journal');a.load();
  const prior=a.raw;s.setItem=()=>{throw new Error('quota exceeded');};
  assert.throws(()=>a.save({...value,goals:[]}),/quota/);assert.equal(a.raw,prior);assert.equal(s.getItem(),prior);
});
test('invalid imports are rejected before storage writes',()=>{
  const s=storage(),a=new JournalStore(s,'journal');a.load();assert.throws(()=>a.save({version:1,goals:[{}],entries:[]}));assert.equal(s.getItem(),null);
});
