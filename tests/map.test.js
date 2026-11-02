import test from 'node:test';
import assert from 'node:assert/strict';
import {secColor,regionLayout,projector,frame,lightYears,inRange,strengths,sketch,JUMP_SHIPS} from '../map.js';
import {graph} from '../route.js';
const universe={systems:{
 1:['Jita',0.946,10,[2,4],0,[0,0,0],[0,0],100],
 2:['Perimeter',0.95,10,[1,3],2,[3,0,4],[4,0],100],
 3:['Niarja',0.5,10,[2],0,[6,0,8],[4,4],100],
 4:['Tama',0.3,20,[1],5,[0,0,7],[-4,0],200],
 5:['Nullish',-0.4,20,[],0,[0,0,9.5],null,200]},regions:{10:'The Forge',20:'Black Rise'},constellations:{100:['Kimotoro',10]}};
const g=graph(universe);
test('security colours follow the in-game palette',()=>{
 assert.equal(secColor(1),'#2c75e1');assert.equal(secColor(0.46),'#f3fd82');assert.equal(secColor(0.04),'#722020','0.04 shows as 0.1');assert.equal(secColor(-0.4),'#8d3264');
});
test('the region layout snaps CCP’s schematic to a grid with no overlapping boxes, and stubs gates that leave the region',()=>{
 const r=regionLayout(g,10,{cell:28,pad:10});
 assert.equal(r.nodes.length,3);assert.equal(r.edges.length,2);assert.equal(r.exits.length,1);assert.equal(r.exits[0].to.name,'Tama');
 const xy=name=>r.nodes.find(n=>n.system.name===name).xy;
 assert.deepEqual(xy('Jita'),[10,10+Math.round(4/2.05)*28]);assert.deepEqual(xy('Niarja'),[10+Math.round(4/2.05)*28,10]);
 assert.ok(xy('Niarja')[1]<xy('Jita')[1],'north is up');assert.equal(r.width,20+2*28);assert.equal(r.height,20+2*28);
 assert.ok(r.exits[0].xy[0]<xy('Jita')[0],'Tama lies west of Jita');
 assert.deepEqual(regionLayout(g,99).nodes,[]);
});
test('systems three grid cells apart on one row never overlap',()=>{
 const row={systems:{1:['A',1,7,[],0,null,[0,0]],2:['B',1,7,[],0,null,[6.15,0]],3:['C',1,7,[],0,null,[2.05,2.05]]},regions:{7:'R'}};
 const r=regionLayout(graph(row),7);const [a,b,c]=r.nodes.map(n=>n.xy);
 assert.ok(b[0]-a[0]>=80,'boxes on one row clear each other');assert.ok(Math.abs(c[1]-a[1])>=28,'next row clears the box height');
});
test('projection puts the centre mid-screen and shrinks with distance',()=>{
 const p=projector({center:[0,0,0],yaw:0,pitch:0,distance:100,width:800,height:600,fov:700});
 assert.deepEqual(p([0,0,0]).slice(0,2),[400,300]);assert.ok(p([10,0,0])[0]>400);assert.ok(p([0,10,0])[1]<300,'up is up');
 assert.ok(p([0,0,50])[3]<p([0,0,-50])[3],'farther is smaller');assert.equal(p([0,0,-200]),null,'behind the camera');
 const f=frame([g.systems.get(1),g.systems.get(3)]);assert.deepEqual(f.center,[3,0,4]);assert.equal(f.radius,5);
});
test('jump range uses 3D light-years and never lands in high-sec',()=>{
 assert.equal(lightYears(g.systems.get(1),g.systems.get(2)),5);
 assert.deepEqual(inRange(g,1,8).map(x=>x.system.name),['Tama'],'Perimeter and Niarja are high-sec');
 assert.deepEqual(inRange(g,1,JUMP_SHIPS.jf.ly).map(x=>x.system.name),['Tama','Nullish']);
});
test('overlay strengths use a square-root scale; sketches fit the route in a box',()=>{
 const s=strengths({1:100,2:25,3:0});assert.equal(s(1),1);assert.equal(s(2),0.5);assert.equal(s(3),0);assert.equal(s(9),0);
 assert.equal(strengths({})(1),0);
 const pts=sketch([g.systems.get(1),g.systems.get(2),g.systems.get(3)],{width:100,height:100,pad:10});
 assert.equal(pts.length,3);assert.ok(pts.every(p=>p.xy.every(v=>v>=10-1e-9&&v<=90+1e-9)));
});
test('two gates to the same outside system share one label',()=>{
 const u={systems:{1:['A',1,7,[3],0,null,[0,0]],2:['B',1,7,[3],0,null,[6.15,0]],3:['X',1,8,[1,2],0,null,[3.075,4.1]]},regions:{7:'R',8:'S'}};
 const r=regionLayout(graph(u),7);assert.equal(r.exits.length,2);assert.deepEqual(r.exits.map(e=>e.label),[true,false]);assert.deepEqual(r.exits[0].xy,r.exits[1].xy);
});
