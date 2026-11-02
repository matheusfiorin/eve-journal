import test from 'node:test';
import assert from 'node:assert/strict';
import {HULLS,suggestHull,campIntel,systemRisk,bestOrder,plan} from '../hauling.js';
import {graph} from '../route.js';
const now=Date.UTC(2026,10,2,12);
const km=(id,sys,{loc=40000001,mins=5,npc=false,attackers=[{ship_type_id:587,weapon_type_id:3001}],victim=648,value=1e7}={})=>({killmail_id:id,killmail_time:new Date(now-mins*60000).toISOString(),solar_system_id:sys,victim:{ship_type_id:victim},attackers,zkb:{locationID:loc,npc,totalValue:value}});
test('hull suggestion follows cargo volume and value',()=>{
 assert.equal(suggestHull(8000,5e9),'br');assert.equal(suggestHull(30000,1e8),'t1');assert.equal(suggestHull(30000,1e9),'dst');assert.equal(suggestHull(500000,1e9),'freighter');
});
test('camp intel counts recent non-NPC kills per gate, smartbombs, interdictors and attackers',()=>{
 const intel=campIntel([km(1,7,{loc:50000001}),km(2,7,{loc:50000001,mins:30,victim:670,attackers:[{ship_type_id:22456,weapon_type_id:3001}]}),km(3,7,{loc:40000001,attackers:[{ship_type_id:587,weapon_type_id:15000}]}),km(4,7,{npc:true}),km(5,7,{mins:90}),km(6,8,{loc:50000002})],
  {combat:{sb:[15000],dictor:[22456]},gateTo:new Map([[50000001,9]]),now});
 const s=intel.get(7);
 assert.equal(s.kills,3);assert.equal(s.pods,1);assert.equal(s.gateKills,2);assert.deepEqual(Object.keys(s.gates),['9']);assert.equal(s.gates[9].n,2);
 assert.equal(s.sb,1);assert.equal(s.dictor,1);assert.equal(s.ships[587],2);assert.equal(intel.get(8).gates['?'].n,1,'unknown gate');
});
const sys=(id,sec)=>({id,sec});
test('risk grows with recent kills per passing ship, cargo value in high-sec, and live gate camps',()=>{
 const quiet=systemRisk(sys(1,0.9),{value:1e8});assert.ok(Math.abs(quiet.p-0.0002)<1e-12,'floor at 100M');
 const hist={2:[24,168]},traffic={2:100};
 const busy=systemRisk(sys(2,0.9),{history:hist,traffic,value:1e8});assert.ok(Math.abs(busy.background-0.01)<1e-12,'one kill an hour among 100 ships');
 assert.ok(systemRisk(sys(2,0.9),{history:hist,traffic,value:1e10}).p>busy.p*5,'gankers chase fat cargo');
 assert.ok(systemRisk(sys(2,0.9),{history:hist,traffic,value:1e8,hull:'br'}).p<busy.p);
 const live=new Map([[3,{gates:{4:{n:3,last:now-60000},5:{n:2,last:now}},sb:1,dictor:0}]]);
 const via4=systemRisk(sys(3,0.3),{live,via:[4],now}),via6=systemRisk(sys(3,0.3),{live,via:[6],now});
 assert.ok(via4.camp>0.7);assert.equal(via6.camp,0,'kills on gates you never use do not count');
 const bubbles=new Map([[3,{gates:{4:{n:1,last:now}},sb:0,dictor:1}]]);
 assert.ok(systemRisk(sys(3,0.3),{live:bubbles,via:[4],now,hull:'br'}).camp>systemRisk(sys(3,0.3),{live:new Map([[3,{gates:{4:{n:1,last:now}},sb:0,dictor:0}]]),via:[4],now,hull:'br'}).camp*3,'bubbles catch blockade runners');
});
test('best order keeps the start, then tries every order of the stops',()=>{
 const c=[[0,5,1,9],[5,0,4,1],[1,4,0,8],[9,1,8,0]];
 assert.deepEqual(bestOrder(c,{end:'free'}),[0,2,1,3]);assert.deepEqual(bestOrder(c,{end:'fixed'}),[0,2,1,3]);
 assert.deepEqual(bestOrder([[0,1,9],[1,0,1],[9,1,0]],{end:'fixed'}),[0,1,2]);
 const n=12,big=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>Math.abs(i-j)));const o=bestOrder(big,{end:'free'});
 assert.deepEqual(o,[...Array(n).keys()],'2-opt straightens a line');
});
// A--B--C--D is the short way, with B camped low-sec; A--E--F--G--D is a long, quiet high-sec detour.
const universe={systems:{1:['A',0.9,10000002,[2,5]],2:['B',0.4,10000002,[1,3]],3:['C',0.9,10000002,[2,4]],4:['D',0.9,10000002,[3,7]],5:['E',0.9,10000002,[1,6]],6:['F',0.9,10000002,[5,7]],7:['G',0.9,10000002,[6,4]]}};
test('plans trade jumps for safety by mode and honour low-sec and avoid lists',()=>{
 const g=graph(universe),live=new Map([[2,{gates:{1:{n:4,last:now},3:{n:2,last:now}},sb:0,dictor:0}]]);
 const ctx={value:5e8,hull:'t1',live,now};
 assert.equal(plan(g,[1,4],ctx).unreachable?.join(),undefined);
 assert.deepEqual(plan(g,[1,4],ctx,{mode:'balanced'}).route,[1,5,6,7,4],'high-sec only by default');
 const short=plan(g,[1,4],ctx,{mode:'shortest',lowsec:true});assert.deepEqual(short.route,[1,2,3,4]);assert.ok(short.lowsec);
 const safe=plan(g,[1,4],ctx,{mode:'safest',lowsec:true});assert.deepEqual(safe.route,[1,5,6,7,4]);assert.ok(safe.survival>short.survival);
 assert.ok(short.expectedLoss>safe.expectedLoss*10);assert.equal(short.minutes,3*HULLS.t1.jump/60);
 assert.deepEqual(plan(g,[1,4],ctx,{mode:'balanced',avoid:new Set([6])}).unreachable,[1,4],'avoiding F leaves only low-sec');
 assert.deepEqual(plan(g,[1,2,4],ctx,{mode:'balanced'}).route,[1,2,3,4],'a low-sec stop you chose is allowed');
 assert.deepEqual(plan(g,[1,7,5],ctx,{optimize:true,end:'free'}).stops,[1,5,7]);
 const tour=plan(g,[1,7,5],ctx,{optimize:true,end:'return'});assert.equal(tour.stops.length,4);assert.equal(tour.stops.at(-1),1);
 assert.ok(tour.steps.every(s=>s.p>0&&s.p<1));
});
