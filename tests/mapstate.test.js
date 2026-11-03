import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMapHash,serializeMapHash,loadPrefs,savePrefs,PREFS_KEY,addLayer,removeLayer,MAX_LAYERS,routeInRegion,neighbourByAngle,lod,sortRows} from '../ui/mapstate.js';
test('the map address round-trips and leaves defaults out',()=>{
 const state={region:10000002,selected:30000142,overlay:'shipKills',jump:'jf',view:'region3d'};
 const q=serializeMapHash(state);assert.equal(q,'r=10000002&s=30000142&o=shipKills&j=jf&v=3d');
 assert.deepEqual(parseMapHash(`#navigate/map?${q}`),state);assert.deepEqual(parseMapHash(`map?${q}`),state,'old #map links work too');
 assert.equal(serializeMapHash({region:10000002,selected:null,overlay:'security',jump:'',view:'region'}),'r=10000002');
 assert.equal(serializeMapHash({}),'');
 assert.deepEqual(parseMapHash('navigate/map?v=universe'),{view:'universe'});assert.deepEqual(parseMapHash('navigate/map?v=list'),{view:'list'});
 assert.deepEqual(parseMapHash('navigate/map?j='),{jump:''},'an empty jump clears the range');
});
test('a hand-edited map address cannot inject bad values',()=>{
 assert.deepEqual(parseMapHash('navigate/map?r=-4&s=abc&o=<script>&j=titan&v=4d'),{});
 assert.deepEqual(parseMapHash('navigate/map'),{});assert.deepEqual(parseMapHash(''),{});
 assert.deepEqual(parseMapHash('navigate/map?r=1.5&s=30000142'),{selected:30000142});
});
test('preferences survive in storage and a broken or blocked storage is ignored',()=>{
 const mem=new Map(),storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};
 assert.deepEqual(loadPrefs(storage),{});
 assert.equal(savePrefs(storage,{view:'universe',overlay:'sov',jump:'blops',selected:1}),true);
 assert.deepEqual(JSON.parse(mem.get(PREFS_KEY)),{view:'universe',overlay:'sov',jump:'blops'},'only view, overlay and jump are kept');
 assert.deepEqual(loadPrefs(storage),{view:'universe',overlay:'sov',jump:'blops'});
 mem.set(PREFS_KEY,'{broken');assert.deepEqual(loadPrefs(storage),{});
 mem.set(PREFS_KEY,JSON.stringify({view:'hyperspace',overlay:'sov'}));assert.deepEqual(loadPrefs(storage),{overlay:'sov'});
 const blocked={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
 assert.deepEqual(loadPrefs(blocked),{});assert.equal(savePrefs(blocked,{}),false);
});
test('layers stack up to a limit, each with its own colour, and repeats are not duplicated',()=>{
 let layers=addLayer([],{label:'Balanced route',ids:[1,2,3]});
 assert.equal(layers.length,1);assert.equal(layers[0].kind,'route');assert.ok(layers[0].color);
 assert.equal(addLayer(layers,{label:'Balanced route',ids:[1,2,3]}),layers,'same route twice is one layer');
 for(let i=0;i<6;i++)layers=addLayer(layers,{label:`R${i}`,ids:[i,i+1]});
 assert.equal(layers.length,MAX_LAYERS);assert.equal(layers.at(-1).label,'R5');assert.ok(!layers.some(l=>l.label==='Balanced route'),'oldest dropped');
 assert.equal(new Set(layers.map(l=>l.color)).size,layers.length,'distinct colours');
 const pins=addLayer([],{label:'Pins',kind:'pins',ids:['30000142',30000144]});assert.deepEqual(pins[0].ids,[30000142,30000144]);
 assert.deepEqual(removeLayer(layers,layers[0].id).map(l=>l.label),layers.slice(1).map(l=>l.label));
});
test('a route through a region splits into runs with where it enters, leaves and how far is left',()=>{
 const inside=id=>[2,3,6].includes(id);
 assert.deepEqual(routeInRegion([1,2,3,4,5,6],inside),[{ids:[2,3],from:1,to:4,remaining:3,before:1},{ids:[6],from:5,to:null,remaining:0,before:5}]);
 assert.deepEqual(routeInRegion([7,8],inside),[]);
 assert.deepEqual(routeInRegion([2,3],inside),[{ids:[2,3],from:null,to:null,remaining:0,before:0}]);
});
test('arrow keys pick the nearest system in that direction, preferring straight ahead',()=>{
 const c=[{id:'right',xy:[100,0]},{id:'farRight',xy:[300,10]},{id:'up',xy:[0,-80]},{id:'diag',xy:[60,60]},{id:'left',xy:[-50,0]}];
 assert.equal(neighbourByAngle([0,0],c,'ArrowRight').id,'right');assert.equal(neighbourByAngle([0,0],c,'ArrowUp').id,'up');
 assert.equal(neighbourByAngle([0,0],c,'ArrowLeft').id,'left');assert.equal(neighbourByAngle([0,0],c,'ArrowDown').id,'diag','within 60° of straight down');
 assert.equal(neighbourByAngle([0,0],[{id:'up',xy:[0,-80]}],'ArrowDown'),null,'nothing that way');
 assert.equal(neighbourByAngle([0,0],c,'Enter'),null);
 assert.equal(neighbourByAngle([0,0],[{id:'self',xy:[0,0]}],'ArrowRight'),null);
});
test('text level of detail and List view sorting',()=>{
 assert.equal(lod(1.3),'full');assert.equal(lod(0.8),'full');assert.equal(lod(0.79),'low');assert.equal(lod(0.4),'min');
 const rows=[{name:'Jita',kills:3},{name:'Amarr',kills:10},{name:'Tama'}];
 assert.deepEqual(sortRows(rows,'kills').map(r=>r.name),['Amarr','Jita','Tama'],'numbers: most first, blanks last');
 assert.deepEqual(sortRows(rows,'kills',1).map(r=>r.name),['Tama','Jita','Amarr']);
 assert.deepEqual(sortRows(rows,'name').map(r=>r.name),['Amarr','Jita','Tama'],'text: A to Z');
 assert.deepEqual(sortRows(rows,'name',-1).map(r=>r.name),['Tama','Jita','Amarr']);
});
