import test from 'node:test';
import assert from 'node:assert/strict';
import {graph,paths,leg,facilities,nearest,secShown,secClass,dotlanSystem,dotlanRoute} from '../route.js';
// A-B-C is high-sec; A-L-C is a shortcut through low-sec L; D hangs off C and is low-sec.
const g=graph({systems:{1:['Alpha',0.9,1,[2,9]],2:['Beta',0.5,1,[1,3]],3:['Gamma',0.7,1,[2,9,4]],9:['Lowtown',0.3,1,[1,3]],4:['Delta',0.2,1,[3]]},
 stations:[[101,1,1,'Alpha Factory'],[102,3,3,'Gamma Works'],[103,2,2,'Beta Lab'],[104,4,1,'Delta Yard']]});
test('security display follows the in-game rounding',()=>{
 assert.equal(secShown(0.45),0.5);assert.equal(secShown(0.44),0.4);assert.equal(secShown(0.01),0.1);assert.equal(secShown(-0.3),-0.3);
 assert.equal(secClass(0.46),'hi');assert.equal(secClass(0.3),'low');assert.equal(secClass(0),'null');
});
test('safe routes go around low-sec even when longer',()=>{
 assert.deepEqual(paths(g,1).path(3),[1,2,3]);assert.deepEqual(paths(g,1,{safe:false}).path(3).length,3);
 const r=leg(g,1,4);assert.deepEqual(r.systems.map(s=>s.name),['Alpha','Beta','Gamma','Delta']);assert.equal(r.jumps,3);assert.equal(r.risky,1);
 assert.equal(leg(g,1,77),null);assert.equal(leg(g,1,1).jumps,0);
});
test('facilities are high-sec only, cheapest index first, one per system',()=>{
 const index=new Map([[1,0.05],[2,0.01],[3,0.02],[4,0.001]]);
 const factories=facilities(g,1,1,id=>index.get(id));assert.deepEqual(factories.map(f=>f.station.name),['Gamma Works','Alpha Factory']);assert.equal(factories[0].jumps,2);
 const labs=facilities(g,1,2,id=>index.get(id));assert.deepEqual(labs.map(f=>f.station.name),['Beta Lab','Gamma Works']);
 assert.deepEqual(facilities(g,1,1,id=>index.get(id),{maxJumps:1}).map(f=>f.station.name),['Alpha Factory']);
});
test('nearest picks the closest safe place',()=>{
 const best=nearest(g,1,[{system:3,name:'far'},{system:2,name:'near'},{system:77}]);assert.equal(best.place.name,'near');assert.equal(best.route.jumps,1);
 assert.equal(nearest(g,1,[]),null);
});
test('dotlan links use underscores and colons',()=>{
 assert.equal(dotlanSystem('New Caldari'),'https://evemaps.dotlan.net/system/New_Caldari');assert.equal(dotlanRoute(['Jita','New Caldari']),'https://evemaps.dotlan.net/route/Jita:New_Caldari');
});
