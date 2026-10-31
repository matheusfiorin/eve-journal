import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {aggregate,recipes,starters,universe,npcSellers,highsecRegions,surveyQueue,mergeRegion} from '../scripts/market-pipeline.mjs';
import {pipelineToken} from '../worker/index.js';
const order=(location_id,price,volume_remain,is_buy_order=false)=>({location_id,system_id:30000142,price,volume_remain,is_buy_order});
test('aggregate keeps the best price per station with volume near that price, and skips structures',()=>{
 const r=aggregate([order(60003760,10,5),order(60003760,10.1,7),order(60003760,20,100),order(60008494,12,3),order(1035466617946,1,999),order(60003760,8,50,true),order(60003760,2,50,true)],[{volume:10},{volume:20}]);
 assert.deepEqual(r.s,[[60003760,10,12],[60008494,12,3]]);assert.deepEqual(r.b,[[60003760,8,50]]);assert.equal(r.d,15);assert.equal(r.systems.has(1035466617946),false);
});
test('aggregate handles a cheaper order arriving after a pricier one',()=>{
 assert.deepEqual(aggregate([order(60003760,10.1,7),order(60003760,10,5)]).s,[[60003760,10,12]]);
});
test('recipes keep manufacturing materials for wanted products only',()=>{
 const blueprints=[
  {_key:691,blueprintTypeID:691,activities:{manufacturing:{materials:[{typeID:34,quantity:32000},{typeID:35,quantity:6000}],products:[{typeID:587,quantity:1}],time:6000},invention:{products:[{typeID:999,quantity:1}]}}},
  {_key:700,activities:{manufacturing:{materials:[{typeID:34,quantity:1}],products:[{typeID:111,quantity:1}]}}},
  {_key:701,activities:{copying:{time:1}}}
 ];
 assert.deepEqual(recipes(blueprints,new Set([587,999])),{587:{bp:691,q:1,m:[[34,32000],[35,6000]]}});
});
test('the pipeline signs uploads exactly the way the Worker verifies them',async()=>{
 assert.equal(createHmac('sha256','secret').update('market-pipeline').digest('base64url'),await pipelineToken('secret'));
});
test('starters keep cheap published T1 blueprints whose materials cost less than the product',()=>{
 const mf=(product,mats,time=300)=>({manufacturing:{materials:mats.map(([typeID,quantity])=>({typeID,quantity})),products:[{typeID:product,quantity:1}],time},research_material:{time:105}});
 const blueprints=[
  {_key:2456,maxProductionLimit:300,activities:{...mf(2454,[[34,1000]]),manufacturing:{...mf(2454,[[34,1000]]).manufacturing,skills:[{typeID:3436,level:1}]}}},          // Hobgoblin I: cheap, profitable drone
  {_key:9001,activities:mf(9000,[[34,1000]])},                                   // T2 item: excluded
  {_key:691,activities:{...mf(587,[[34,30000]],6000),research_material:{time:2100}}}, // Rifter: frigate, rank 20
  {_key:24699,activities:mf(24698,[[34,10]])},                                   // Drake: battlecruiser, excluded
  {_key:5000,activities:mf(5001,[[34,99999]])},                                  // loses money: excluded
  {_key:7000,activities:mf(7001,[[34,1]])}                                       // BPO too expensive
 ];
 const types=new Map([[2456,{published:true,basePrice:250000}],[2454,{published:true,groupID:100,name:{en:'Hobgoblin I'}}],[9001,{published:true,basePrice:1}],[9000,{published:true,groupID:100,metaGroupID:2}],
  [691,{published:true,basePrice:2800000}],[587,{published:true,groupID:25,name:{en:'Rifter'}}],[24699,{published:true,basePrice:1}],[24698,{published:true,groupID:419,name:{en:'Drake'}}],
  [5000,{published:true,basePrice:1}],[5001,{published:true,groupID:100}],[7000,{published:true,basePrice:5e7}],[7001,{published:true,groupID:100}]]);
 const groups=new Map([[100,{categoryID:18,name:{en:'Combat Drone'}}],[25,{categoryID:6,name:{en:'Frigate'}}],[419,{categoryID:6,name:{en:'Combat Battlecruiser'}}]]);
 const categories=new Map([[18,{name:{en:'Drone'}}],[6,{name:{en:'Ship'}}]]);
 const prices=new Map([[34,{adjusted:4}],[2454,{average:10000}],[9000,{average:1e6}],[587,{average:400000}],[24698,{average:5e7}],[5001,{average:10}],[7001,{average:1e6}]]);
 const list=starters(blueprints,types,groups,categories,prices);
 assert.deepEqual(list.map(s=>s.n),['Rifter','Hobgoblin I'],'ranked by screened profit per second of build time');
 assert.deepEqual(list[1],{type:2454,bp:2456,n:'Hobgoblin I',cat:'Drone',q:1,t:300,rank:1,limit:300,price:250000,m:[[34,1000]],sk:[[3436,1]]});
 assert.deepEqual(list[0].sk,[]);assert.equal(list[0].rank,20);assert.equal(list[0].cat,'Frigate');
});
test('universe keeps known-space gates, security and NPC factories and labs',()=>{
 const map=universe({
  mapSolarSystems:[{_key:30000142,name:{en:'Jita'},securityStatus:0.9459,regionID:10000002},{_key:30000144,name:{en:'Perimeter'},securityStatus:0.95,regionID:10000002},{_key:31000005,name:{en:'Thera'},securityStatus:-1,regionID:11000031}],
  mapStargates:[{_key:1,solarSystemID:30000142,destination:{solarSystemID:30000144}},{_key:2,solarSystemID:30000144,destination:{solarSystemID:30000142}},{_key:3,solarSystemID:30000142,destination:{solarSystemID:30000144}}],
  npcStations:[{_key:60003760,solarSystemID:30000142,operationID:10},{_key:60003761,solarSystemID:30000144,operationID:11},{_key:60003762,solarSystemID:30000144,operationID:12}],
  stationOperations:[{_key:10,services:[5,6]},{_key:11,services:[6]},{_key:12,services:[7]}],
  stationServices:[{_key:5,serviceName:{en:'Factory'}},{_key:6,serviceName:{en:'Laboratory'}},{_key:7,serviceName:{en:'Cloning'}}]
 });
 assert.deepEqual(map.systems,{30000142:['Jita',0.946,10000002,[30000144]],30000144:['Perimeter',0.95,10000002,[30000142]]});
 assert.deepEqual(map.stations,[[60003760,30000142,3],[60003761,30000144,2]]);
});
test('npc sellers are 365-day sell orders in NPC stations, cheapest per station',()=>{
 const o=(location_id,price,duration,extra={})=>({location_id,system_id:30000142,price,duration,is_buy_order:false,...extra});
 assert.deepEqual(npcSellers([o(60003760,250000,365),o(60003760,240000,365),o(60008494,250000,365),o(60008494,100000,90),o(1035466617946,1,365),o(60011866,5,365,{is_buy_order:true})]),
  [[60003760,30000142,240000],[60008494,30000142,250000]]);
});
test('high-sec regions come from systems at 0.45 or better, ignoring wormhole space',()=>{
 assert.deepEqual(highsecRegions({systems:{1:['A',0.9,10000002,[]],2:['B',0.2,10000014,[]],3:['C',0.46,10000043,[]],4:['D',0.9,11000001,[]],5:['E',0.5,10000002,[]]}}),[10000002,10000043]);
});
test('aggregate keeps the 7-day average price',()=>{
 assert.equal(aggregate([],[{volume:1,average:10},{volume:1,average:20}]).p,15);
});

test('the survey refreshes unseen and stale regions first, pilot regions ahead of the rest',()=>{
 const now=100*3600000;
 assert.deepEqual(surveyQueue({1:now-3600000,2:now-30*3600000,3:now-50*3600000},[1,2,3,4,5],[5],now),[5,4,3,2]);
});
test('merging a region replaces only its sellers and keeps a few stations per region',()=>{
 const sellers={7:[[60000001,1,100,9],[60000002,2,100,8]],8:[[60000003,3,50,9]]};
 mergeRegion(sellers,9,[7,8],{7:[[60000004,4,90],[60000005,5,95],[60000006,6,99]]});
 assert.deepEqual(sellers,{7:[[60000004,4,90,9],[60000005,5,95,9],[60000002,2,100,8]]});
});
