import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {aggregate,recipes} from '../scripts/market-pipeline.mjs';
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
