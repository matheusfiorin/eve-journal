import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {aggregate,parseCsv,recipes} from '../scripts/market-pipeline.mjs';
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
 const products=parseCsv('typeID,activityID,productTypeID,quantity\n691,1,587,1\n691,8,999,1\n700,1,111,1');
 const materials=parseCsv('typeID,activityID,materialTypeID,quantity\n691,1,34,32000\n691,1,35,6000\n691,8,1,1');
 assert.deepEqual(recipes(products,materials,new Set([587])),{587:{bp:691,q:1,m:[[34,32000],[35,6000]]}});
});
test('the pipeline signs uploads exactly the way the Worker verifies them',async()=>{
 assert.equal(createHmac('sha256','secret').update('market-pipeline').digest('base64url'),await pipelineToken('secret'));
});
