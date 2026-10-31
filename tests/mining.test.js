import test from 'node:test';
import assert from 'node:assert/strict';
import {faction,oresAt,yieldRate,holdOf,refineYield,oreValue,sites,ledger,canFly,SKILL} from '../mining.js';
import {graph} from '../route.js';
import {book} from '../market.js';
const lv=map=>id=>map[id]||0;
test('ore spawns follow security band and empire faction',()=>{
 assert.equal(faction(10000002),'caldari');assert.equal(faction(10000043),'amarr');assert.equal(faction(10000999),null);
 assert.deepEqual(oresAt(1.0,10000002),['Veldspar','Scordite']);
 assert.deepEqual(oresAt(0.8,10000002),['Veldspar','Scordite','Pyroxeres']);
 assert.deepEqual(oresAt(0.6,10000002),['Veldspar','Scordite','Pyroxeres','Plagioclase']);
 assert.deepEqual(oresAt(0.6,10000032),['Veldspar','Scordite','Plagioclase']);
 assert.deepEqual(oresAt(0.3,10000030),['Kernite','Omber']);assert.deepEqual(oresAt(0.1,10000043),['Pyroxeres','Kernite','Jaspet','Hemorphite']);
 assert.deepEqual(oresAt(-0.2,10000043),[]);
});
test('yield follows hull, Mining and Astrogeology skills',()=>{
 assert.ok(Math.abs(yieldRate(32880,lv({}))-2*10/15*2)<1e-9,'two Miner I on a Venture with the role bonus');
 const skilled=lv({[SKILL.mining]:4,[SKILL.astrogeology]:2,[SKILL.miningFrigate]:3});
 assert.ok(Math.abs(yieldRate(32880,skilled)-2*15/15*2*1.15*1.2*1.1)<1e-9,'Miner II at Mining IV');
 assert.ok(Math.abs(yieldRate(17478,lv({[SKILL.miningBarge]:1}))-2*150/45*1.1*1.03)<1e-9);
 assert.ok(yieldRate(17476,lv({}))>yieldRate(17478,lv({})),'Covetor out-mines the Retriever');
 assert.equal(holdOf(17478,lv({[SKILL.miningBarge]:2})),22000*1.1);
 assert.equal(canFly(32880,lv({})),false);assert.equal(canFly(32880,lv({[SKILL.miningFrigate]:1})),true);
 assert.ok(Math.abs(refineYield('Veldspar',lv({[SKILL.reprocessing]:5,[SKILL.reprocessingEfficiency]:5,[SKILL.simpleOre]:5}))-0.5*1.15*1.1*1.1)<1e-9);
});
const veld={n:'Veldspar',ore:1230,comp:62516,vol:0.1,portion:100,m:[[34,400]],grades:{1230:0,17470:0.05}};
const market=book([{data:{name:'The Forge',stations:{1:[30000142,'Jita']},types:{1230:{d:1,s:[],b:[[1,10,1e6]]},62516:{d:1,s:[],b:[[1,12,1e6]]},34:{d:1,s:[],b:[[1,4,1e9]]}}}}]);
test('ore is valued at the best of raw, compressed and reprocessed sales',()=>{
 const v=oreValue(veld,market,{salesTax:0.05});
 assert.equal(v.how,'compressed');assert.ok(Math.abs(v.perUnit-11.4)<1e-9);assert.ok(Math.abs(v.perM3-114)<1e-9);assert.equal(v.at,1);
 assert.ok(Math.abs(v.refined-Math.floor(400*0.5)*4*0.95/100)<1e-9);
});
const universe={systems:{1:['Home',0.9,10000002,[2,3],3],2:['Rich',0.6,10000002,[1,4],5],3:['Empty',0.9,10000002,[1],0],4:['Low',0.3,10000002,[2],8]}};
test('sites rank reachable belts by ISK per hour, recent kills and traffic',()=>{
 const values=new Map([['Veldspar',{n:'Veldspar',perM3:100}],['Scordite',{n:'Scordite',perM3:150}],['Plagioclase',{n:'Plagioclase',perM3:300}],['Kernite',{n:'Kernite',perM3:900}]]);
 const g=graph(universe);
 const list=sites(g,1,{values,rate:2,hold:5000});
 assert.deepEqual(list.map(s=>s.system.name),['Rich','Home'],'no belts, no site; low-sec only on request');
 assert.equal(list[0].ores[0].n,'Plagioclase');assert.equal(list[0].jumps,1);
 const fill=2500;assert.ok(Math.abs(list[1].iskHour-2*3600*fill/(fill+240)*150)<1e-6);
 const hot=sites(g,1,{values,rate:2,hold:5000,activity:{2:[9,0,0]}});assert.equal(hot[0].system.name,'Home','nine kills last hour sink a site');
 const low=sites(g,1,{values,rate:2,hold:5000,lowsec:true});assert.equal(low[0].system.name,'Low');assert.ok(low[0].lowsec);
});
test('the ledger sums 30 days per system at today’s prices, with grade bonuses',()=>{
 const values=new Map([['Veldspar',{perUnit:10}]]);
 const r=ledger([{date:'2026-10-01',solar_system_id:1,type_id:1230,quantity:1000},{date:'2026-10-02',solar_system_id:1,type_id:17470,quantity:100},{date:'2026-10-02',solar_system_id:2,type_id:99,quantity:5}],[veld],values,id=>`S${id}`);
 assert.equal(r.units,1100);assert.ok(Math.abs(r.m3-110)<1e-9);assert.ok(Math.abs(r.isk-(10000+1050))<1e-9);assert.equal(r.days,2);
 assert.deepEqual(r.systems.map(s=>[s.name,s.days]),[['S1',2]]);
});
