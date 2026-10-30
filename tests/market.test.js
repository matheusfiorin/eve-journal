import test from 'node:test';
import assert from 'node:assert/strict';
import {fees,book,hauls,stationTrades,manufacturing,SCC_AND_FACILITY} from '../market.js';
const JITA=60003760,AMARR=60008494,DODIXIE=60011866;
const regions=[
 {data:{name:'The Forge',stations:{[JITA]:[30000142,'Jita 4-4']},types:{34:{d:1000,s:[[JITA,5,100000]],b:[[JITA,4.5,50000]]},587:{d:10,s:[[JITA,400000,5]],b:[[JITA,350000,3]]},35:{d:100,s:[[JITA,10,1e6]],b:[]}}}},
 {data:{name:'Domain',stations:{[AMARR]:[30002187,'Amarr VIII']},types:{34:{d:500,s:[[AMARR,6,1000]],b:[[AMARR,7,20000]]},587:{d:4,s:[],b:[[AMARR,380000,2]]}}}}
];
const market=book(regions);
test('fees fall with Accounting and Broker Relations',()=>{
 assert.deepEqual(fees(null),{salesTax:0.075,brokerFee:0.03});
 const f=fees({skills:[{skill_id:1,active_skill_level:5},{skill_id:2,active_skill_level:4}]},{accounting:1,brokerRelations:2});
 assert.ok(Math.abs(f.salesTax-0.03375)<1e-9);assert.ok(Math.abs(f.brokerFee-0.018)<1e-9);
});
test('book merges regions and sorts sells cheapest-first and buys richest-first',()=>{
 const t=market.items.get(34);assert.deepEqual(t.sells.map(s=>s.loc),[JITA,AMARR]);assert.deepEqual(t.buys.map(b=>b.loc),[AMARR,JITA]);assert.equal(t.daily,1500);assert.equal(market.stations.get(AMARR).region,'Domain');
});
test('hauls pick the best cross-station pair limited by cargo and order volume',()=>{
 const list=hauls(market,{salesTax:0.05,cargo:1000,volumeOf:id=>({34:0.01,587:2500})[id]});
 assert.equal(list.length,1);const h=list[0];assert.equal(h.type,34);assert.equal(h.from.loc,JITA);assert.equal(h.to.loc,AMARR);
 assert.equal(h.units,20000);assert.ok(Math.abs(h.unit-(7*0.95-5))<1e-9);assert.equal(h.invest,100000);
 assert.equal(hauls(market,{salesTax:0.05,cargo:50,volumeOf:()=>0.01})[0].units,5000,'cargo caps the units');
 assert.deepEqual(hauls(market,{salesTax:0.5,cargo:1000,volumeOf:()=>0.01}),[]);
});
test('station trades need both sides in one station and a margin after fees',()=>{
 const list=stationTrades(market,{salesTax:0.04,brokerFee:0.02});
 const rifter=list.find(t=>t.type===587);assert.equal(rifter.loc,JITA);assert.ok(Math.abs(rifter.unit-(400000*0.94-350000*1.02))<1e-6);
 assert.equal(list.filter(t=>t.type===34).length,1,'a crossed book (bid above ask) in Amarr is not a station trade');
 assert.equal(stationTrades(market,{salesTax:0.075,brokerFee:0.03}).find(t=>t.type===34),undefined,'thin spreads vanish at base fees');
});
test('manufacturing prices materials at the cheapest ask and adds job cost from adjusted prices',()=>{
 const list=manufacturing(market,{587:{q:1,m:[[34,30000],[35,6000]]},999:{q:1,m:[[34,1]]}},{salesTax:0.04,brokerFee:0.02,adjusted:new Map([[34,4],[35,9]]),costIndex:0.01});
 assert.equal(list.length,1);const r=list[0];assert.equal(r.materials,30000*5+6000*10);assert.ok(Math.abs(r.job-(30000*4+6000*9)*(0.01+SCC_AND_FACILITY))<1e-6);assert.ok(Math.abs(r.profit-(400000*0.94-r.materials-r.job))<1e-6);
});
