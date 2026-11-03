import test from 'node:test';
import assert from 'node:assert/strict';
import {isTap,wheelFactor,pinch,midpoint,zoomBox,panBox,fitBox,svgScale,toMap,clampWidth,TAP_PX,TAP_MS} from '../ui/gestures.js';
import {easeStep} from '../map.js';
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} ≈ ${b}`);
test('a tap is a short, still press',()=>{
 assert.equal(isTap(0,50),true);assert.equal(isTap(TAP_PX-1,TAP_MS-1),true);
 assert.equal(isTap(TAP_PX,10),false,'moved too far');assert.equal(isTap(2,TAP_MS),false,'held too long');
});
test('the wheel zooms smoothly, out on scroll down, and a flick is capped',()=>{
 assert.equal(wheelFactor({deltaY:0}),1);assert.ok(wheelFactor({deltaY:100})>1);assert.ok(wheelFactor({deltaY:-100})<1);
 near(wheelFactor({deltaY:100})*wheelFactor({deltaY:-100}),1);
 assert.equal(wheelFactor({deltaY:3,deltaMode:1}),wheelFactor({deltaY:99}),'lines count as 33 px');
 assert.ok(wheelFactor({deltaY:10,ctrlKey:true})>wheelFactor({deltaY:10}),'trackpad pinch is more sensitive');
 near(wheelFactor({deltaY:1e6}),Math.exp(0.5));
});
test('two fingers: spread is the zoom, the midpoint moves the map',()=>{
 const g=pinch([[0,0],[100,0]],[[-50,10],[150,10]]);
 assert.equal(g.scale,2);assert.deepEqual(g.mid,[50,10]);assert.deepEqual(g.pan,[0,10]);
 assert.deepEqual(midpoint([[0,0],[10,20]]),[5,10]);
 assert.equal(pinch([[5,5],[5,5]],[[0,0],[10,0]]).scale,1,'no divide by zero');
});
test('zooming keeps the point under the cursor fixed and respects the limits shared with the buttons',()=>{
 const box=[0,0,1000,500],at=[250,100];
 const z=zoomBox(box,0.5,at);assert.deepEqual(z,[125,50,500,250]);
 // The point is the same fraction across the box before and after.
 near((at[0]-z[0])/z[2],(at[0]-box[0])/box[2]);near((at[1]-z[1])/z[3],(at[1]-box[1])/box[3]);
 assert.equal(zoomBox(box,0.01,at,{min:200,max:4000})[2],200,'no closer than the minimum');
 assert.equal(zoomBox(box,100,at,{min:200,max:4000})[2],4000,'no farther than the maximum');
 assert.equal(clampWidth(50),120);assert.deepEqual(zoomBox(box,2),[-500,-250,2000,1000],'buttons zoom about the centre');
});
test('panning moves the box against the drag, scaled to the screen',()=>{
 assert.deepEqual(panBox([0,0,100,100],20,-10,2),[-10,5,100,100]);
});
test('fit shows the whole extent at the stage aspect ratio, never zoomed in past the cap',()=>{
 const f=fitBox([0,0,200,100],{pad:0,aspect:2});assert.deepEqual(f,[0,0,200,100]);
 const tall=fitBox([0,0,100,100],{pad:0,aspect:2});assert.deepEqual(tall,[-50,0,200,100]);
 const small=fitBox([0,0,100,50],{pad:0,aspect:2,minWidth:500});assert.deepEqual(small,[-200,-100,500,250],'a tiny region is not blown up');
 assert.deepEqual(fitBox([10,10,30,30],{pad:5}),[5,5,30,30]);
});
test('screen points map into a meet-fitted viewBox',()=>{
 const box=[100,100,200,100],rect={width:400,height:400};
 assert.equal(svgScale(box,rect),2);
 assert.deepEqual(toMap(box,rect,200,200),[200,150],'centre of the element is the centre of the box');
 assert.deepEqual(toMap(box,rect,0,100),[100,100],'letterboxed: the box starts 100 px down');
});
test('3D camera easing is frame-rate independent',()=>{
 near(easeStep(1000/60),0.12);near(1-(1-easeStep(1000/30)),1-(1-0.12)**2,1e-9);
 assert.equal(easeStep(0),0);assert.ok(easeStep(1000)>0.99);
});
