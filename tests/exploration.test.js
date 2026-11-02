import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSystems,visitedMap,nextSkills,explorerFor,shortcuts,pirates} from '../exploration.js';
import {graph} from '../route.js';
// Home(1) — Busy(2) — Quiet(3) — Pocket(4, dead end); Busy — Low(5) — Null(6)
const g=graph({systems:{1:['Home',0.9,10000002,[2]],2:['Busy',0.8,10000002,[1,3,5]],3:['Quiet',0.7,10000002,[2,4]],4:['Pocket',0.6,10000002,[3]],5:['Low',0.3,10000002,[2,6]],6:['Null',-0.2,10000002,[5]]}});
const now=Date.UTC(2026,10,2);
test('quiet, close dead ends rank first; busy and recently visited systems sink',()=>{
 const traffic={1:3000,2:4000,3:100,4:20};
 const list=rankSystems(g,1,{traffic,now});
 assert.deepEqual(list.map(x=>x.system.name),['Pocket','Quiet','Home','Busy'],'high-sec only by default');
 assert.ok(list[0].deadEnd);assert.equal(list[0].jumps,3);assert.equal(list[0].pirates,'Guristas');
 const seen=rankSystems(g,1,{traffic,now,visited:new Map([[4,now-3600000]])});assert.equal(seen[0].system.name,'Quiet','visited an hour ago');
 const old=rankSystems(g,1,{traffic,now,visited:new Map([[4,now-5*86400000]])});assert.equal(old[0].system.name,'Pocket','a visit five days ago no longer counts');
 assert.equal(rankSystems(g,1,{traffic,now,maxJumps:2}).some(x=>x.system.name==='Pocket'),false);
});
test('kills sink a system, scaled by tolerance; low and null join only when asked',()=>{
 const traffic={1:3000,2:4000,3:100,4:100},kills={4:6};
 assert.equal(rankSystems(g,1,{traffic,kills,now})[0].system.name,'Quiet');
 const pocket=t=>rankSystems(g,1,{traffic,kills,now,tolerance:t}).find(x=>x.system.name==='Pocket').safe;
 assert.ok(pocket('bold')>pocket('normal')&&pocket('normal')>pocket('careful'),'bolder pilots mind kills less');
 const wide=rankSystems(g,1,{traffic,now,bands:new Set(['hi','low','null'])});assert.ok(wide.some(x=>x.system.name==='Null'));
 assert.ok(rankSystems(g,1,{traffic,now,bands:new Set(['low'])}).every(x=>x.system.name==='Low'));
 const hourOnly=rankSystems(g,1,{hour:{jumps:{3:200}},now});assert.equal(hourOnly.find(x=>x.system.name==='Quiet').traffic,4800,'one hour scaled to a day');
});
test('visits merge from trails and manual marks, newest first; skills and hull follow the pilot',()=>{
 const v=visitedMap([[3,10],[4,20]],[[3,30]],null);assert.equal(v.get(3),30);assert.equal(v.get(4),20);
 const lv=map=>k=>map[k]||0;
 assert.deepEqual(nextSkills(lv({}),3).map(s=>[s.key,s.level]),[['astrometrics',3],['hacking',3],['archaeology',3]]);
 assert.deepEqual(nextSkills(lv({astrometrics:3,hacking:3,archaeology:3}),1).map(s=>s.key),['frigate']);
 assert.equal(explorerFor(lv({gallenteFrigate:2,caldariFrigate:1})).ship,'Imicus');assert.equal(pirates(10000043),'Sansha / Blood Raiders');assert.equal(pirates(10000060),'Varies by region');
});
test('EVE-Scout shortcuts keep live wormholes into known space within reach',()=>{
 const sigs=[{signature_type:'wormhole',out_system_name:'Thera',in_system_id:4,max_ship_size:'large',remaining_hours:12,wh_type:'Q063',in_signature:'ABC-123'},
  {signature_type:'wormhole',out_system_name:'Turnur',in_system_id:31000537},{signature_type:'combat',in_system_id:3},{signature_type:'wormhole',out_system_name:'Thera',in_system_id:6,max_ship_size:'medium',remaining_hours:2}];
 const list=shortcuts(g,1,sigs);assert.deepEqual(list.map(s=>[s.hub,s.system.name,s.jumps]).sort(),[['Thera','Null',3],['Thera','Pocket',3]]);
 assert.equal(list.find(s=>s.system.name==='Null').lowsec,true);assert.equal(list.find(s=>s.system.name==='Pocket').size,'large');assert.equal(shortcuts(g,1,sigs,{maxJumps:2}).length,0);
});
