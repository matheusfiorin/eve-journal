import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile} from './fixtures.js';
const hash=page=>new URL(page.url()).hash;
const box=async svg=>(await svg.getAttribute('viewBox')).split(' ').map(Number);
async function choose(page,select,value){
 const phone=isMobile(page);if(phone)await page.locator('#map-layers-open').click();
 await page.locator(select).selectOption(value);
 if(phone){await page.locator('#drawer [data-close]').click();await expect(page.locator('#drawer')).toBeHidden();}
}
async function mapReady(page){await expect(page.locator('#map-status')).toContainText('10 ship kills');return page.locator('#map svg.region-map');}
// Pointer events as a finger would send them: Playwright's touchscreen only taps, so pinches are dispatched.
async function fingers(el,steps){
 await el.evaluate((node,steps)=>{const r=node.getBoundingClientRect();
  for(const [type,points] of steps)for(const [id,x,y] of points)node.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',isPrimary:id===1,clientX:r.left+x,clientY:r.top+y,bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1}));
 },steps);
}

test('the map address names the region, system, overlay and view, and Back walks through selections',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first'});
 await page.goto('/#navigate/map?r=10000043&s=30003504&o=shipKills');await expect(page.locator('#sync-status')).toContainText('Synced');
 const svg=await mapReady(page);
 await expect(page.locator('#map-region')).toHaveValue('10000043');await expect(page.locator('#map-overlay')).toHaveValue('shipKills');
 await expect(page.locator('#map-panel h3')).toHaveText('Niarja');await expect(svg.locator('.sys[data-system="30003504"]')).toHaveClass(/selected/);
 await svg.locator('.sys[data-system="30002187"]').click();await expect(page.locator('#map-panel h3')).toHaveText('Amarr');
 await expect.poll(()=>hash(page)).toBe('#navigate/map?r=10000043&s=30002187&o=shipKills');
 // Selecting in place keeps the drawing (only the classes move).
 await svg.evaluate(n=>{n.dataset.probe='kept';});await svg.locator('.sys[data-system="30003504"]').click();await expect(svg).toHaveAttribute('data-probe','kept');
 await page.goBack();await expect(page.locator('#map-panel h3')).toHaveText('Amarr');await expect(svg.locator('.sys.selected')).toHaveAttribute('data-system','30002187');
 await choose(page,'#map-view','universe');await expect.poll(()=>hash(page)).toContain('v=universe');
 await page.goBack();await expect(page.locator('#map-view')).toHaveValue('region');await expect(page.locator('#map svg.region-map')).toBeVisible();
 // The view, overlay and jump range are remembered in this browser.
 await choose(page,'#map-jump','jf');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('eve-map:v1')))).toEqual({view:'region',overlay:'shipKills',jump:'jf'});
 await page.goto('/#bridge');await tab(page,'map');await expect(page.locator('#map-overlay')).toHaveValue('shipKills');await expect(page.locator('#map-jump')).toHaveValue('jf');
 expect(errors).toEqual([]);
});

test('legends name the security bands and scales, and say when a feed failed or an overlay is empty',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first'});
 await page.route('https://esi.evetech.net/**/universe/system_kills/**',r=>r.fulfill({status:503,body:'{}'}));
 await openApp(page);await tab(page,'map');
 await expect(page.locator('#map-status')).toContainText('1 live feed unavailable');
 const legend=page.locator('#map-legend');await expect(legend).toContainText('High 0.5+');await expect(legend).toContainText('Low 0.1–0.4');await expect(legend).toContainText('Null');
 await choose(page,'#map-overlay','shipKills');await expect(legend).toContainText('Kills feed unavailable');
 await choose(page,'#map-overlay','jumps');await expect(legend).toContainText('max 2,400');await expect(legend).toContainText('√ scale');await expect(legend).not.toContainText('unavailable');
 await choose(page,'#map-overlay','incursion');await expect(legend).toContainText('No incursions in The Forge right now');
 await choose(page,'#map-overlay','sov');await expect(legend).toContainText('Caldari State');
 const tama=page.locator('#map svg .sys[data-system="30002813"]');await expect(tama.locator('.halo')).toBeVisible();
 // Security numbers on the map are lifted to readable colours; gate lines use the tick colour.
 await expect(tama.locator('.sv')).not.toHaveAttribute('style',/#ce440f/);
 expect(errors).toEqual([]);
});

test('keyboard: one tab stop, arrows follow gates and exits, Enter selects; the List view sorts and selects',async({page})=>{
 test.skip(isMobile(page),'hardware keyboard');
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'map');const svg=await mapReady(page);
 await expect(svg).toHaveAttribute('role','group');await expect(svg).toHaveAttribute('aria-roledescription','region map');
 await expect(page.locator('#map-status')).toHaveAttribute('role','status');
 await expect(svg.locator('[tabindex="0"]')).toHaveCount(1);await expect(svg.locator('.sys[data-system="30000142"]')).toHaveAttribute('tabindex','0');
 await expect(svg.locator('.sys[data-system="30002813"]')).toHaveAttribute('aria-label',/Tama, 0\.3 low-sec, ship kills 7/);
 await svg.locator('.sys[data-system="30000142"]').focus();await page.keyboard.press('ArrowRight');
 await expect(svg.locator('.sys[data-system="30000144"]')).toBeFocused();await expect(page.locator('#map-tip')).toContainText('Perimeter');
 await page.keyboard.press('Enter');await expect(page.locator('#map-panel h3')).toHaveText('Perimeter');await expect(svg.locator('.sys[data-system="30000144"]')).toBeFocused();
 await page.keyboard.press('ArrowDown');await expect(svg.locator('.sys[data-system="30002813"]')).toBeFocused();
 await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowRight');await expect(svg.locator('.exit[data-system="30003504"]')).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.locator('#map-region')).toHaveValue('10000043');await expect(page.locator('#map-panel h3')).toHaveText('Niarja');
 // 3D: the canvas takes focus, turns and zooms from the keyboard, and Enter picks the star in the middle.
 await choose(page,'#map-view','region3d');const canvas=page.locator('#map canvas.star-map');
 await expect(canvas).toHaveAttribute('role','img');await expect(canvas).toHaveAttribute('aria-label',/Domain in 3D, Niarja selected/);
 await canvas.focus();const frames=Number(await canvas.getAttribute('data-frames'));await page.keyboard.press('ArrowLeft');await page.keyboard.press('+');
 await expect.poll(async()=>Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(frames);
 await page.keyboard.press('Enter');await expect(page.locator('#map-panel h3')).toHaveText(/Niarja|Amarr/);
 // List view: a table of the region, sortable, rows select.
 await choose(page,'#map-region','10000002');await choose(page,'#map-view','list');const table=page.locator('#map .map-table');
 await expect(table.locator('tbody tr')).toHaveCount(3);await expect(table.locator('tbody tr').first()).toContainText('Tama');
 await table.getByRole('button',{name:/^System/}).click();await expect(table.locator('tbody tr').first()).toContainText('Jita');
 await expect(table.locator('th[aria-sort="ascending"]')).toContainText('System');
 await table.getByRole('button',{name:'Perimeter'}).click();await expect(page.locator('#map-panel h3')).toHaveText('Perimeter');await expect(table.locator('tr.selected')).toContainText('Perimeter');
 expect(errors).toEqual([]);
});

test('wheel and buttons zoom within shared limits, Fit shows the whole region, drags pan',async({page})=>{
 test.skip(isMobile(page),'mouse wheel');
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'map');const svg=await mapReady(page);
 const full=(await svg.getAttribute('data-full')).split(' ').map(Number),start=await box(svg);
 const r=await svg.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);
 for(let i=0;i<30;i++)await page.mouse.wheel(0,-400);
 await expect.poll(async()=>(await box(svg))[2]).toBe(120);
 await page.locator('#map [data-zoom="0"]').click();
 await expect.poll(async()=>(await box(svg))[2]).toBeGreaterThanOrEqual(full[0]-0.01);
 const fit=await box(svg);expect(fit[3]).toBeGreaterThanOrEqual(full[1]-0.01);expect(fit[0]).toBeLessThanOrEqual(0);expect(fit[2]).toBeCloseTo(start[2],1);
 await page.locator('#map [data-zoom="0.75"]').click();await expect.poll(async()=>(await box(svg))[2]).toBeCloseTo(fit[2]*0.75,1);
 // Drag on empty space pans and does not select anything.
 const before=await box(svg);await page.mouse.move(r.x+r.width-300,r.y+80);await page.mouse.down();await page.mouse.move(r.x+r.width-200,r.y+130,{steps:5});await page.mouse.up();
 await expect.poll(async()=>(await box(svg))[0]).toBeLessThan(before[0]);await expect(page.locator('#map-panel h3')).toHaveText('Jita');
 // A drag that starts on a system pans instead of selecting it.
 const tama=await svg.locator('.sys[data-system="30002813"] .box').boundingBox();
 await page.mouse.move(tama.x+20,tama.y+10);await page.mouse.down();await page.mouse.move(tama.x+90,tama.y+40,{steps:5});await page.mouse.up();
 await expect(page.locator('#map-panel h3')).toHaveText('Jita');
 expect(errors).toEqual([]);
});

test('phone: fingers pan and pinch the map, taps select, and the details sheet peeks, expands and drags',async({page})=>{
 test.skip(!isMobile(page),'touch layout');
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'map');const svg=await mapReady(page);
 const vp=page.viewportSize(),stage=await page.locator('#map-stage').boundingBox(),tabbar=await page.locator('#tabbar').boundingBox(),sheet=page.locator('#map-panel');
 // Map first: the stage reaches down to the peeking sheet, the sheet sits on the tab bar, nothing scrolls sideways.
 const peek=await sheet.boundingBox();expect(peek.height).toBeCloseTo(112,0);expect(peek.y+peek.height).toBeCloseTo(tabbar.y,0);expect(stage.y+stage.height).toBeLessThanOrEqual(peek.y+1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(sheet.locator('h3')).toHaveText('Jita');
 // Touch targets: zoom buttons and the Layers button are at least 44 px.
 for(const b of await page.locator('#map .map-zoom button, #map-layers-open').all()){const bb=await b.boundingBox();expect(bb.height).toBeGreaterThanOrEqual(44);}
 expect(await svg.getAttribute('data-lod')).toBe('full');
 // A finger tap selects a system (the hit area is bigger than the box).
 const tama=await svg.locator('.sys[data-system="30002813"] .box').boundingBox();await page.touchscreen.tap(tama.x+tama.width/2,tama.y+tama.height+8);
 await expect(sheet.locator('h3')).toHaveText('Tama');
 // One finger pans.
 const b0=await box(svg);await fingers(svg,[['pointerdown',[[1,40,200]]],['pointermove',[[1,60,200]]],['pointermove',[[1,120,240]]],['pointerup',[[1,120,240]]]]);
 await expect.poll(async()=>(await box(svg))[0]).toBeLessThan(b0[0]);expect((await box(svg))[2]).toBeCloseTo(b0[2],5);
 // Two fingers spreading zoom in around their midpoint; pinching zooms out; a cancelled pointer ends the gesture.
 const b1=await box(svg);
 await fingers(svg,[['pointerdown',[[1,150,200],[2,250,200]]],['pointermove',[[1,120,200],[2,280,200]]],['pointermove',[[1,90,200],[2,310,200]]],['pointercancel',[[1,90,200],[2,310,200]]]]);
 await expect.poll(async()=>(await box(svg))[2]).toBeLessThan(b1[2]*0.7);
 const b2=await box(svg);
 await fingers(svg,[['pointerdown',[[3,100,200],[4,300,200]]],['pointermove',[[3,150,200],[4,250,200]]],['pointerup',[[3,150,200],[4,250,200]]]]);
 await expect.poll(async()=>(await box(svg))[2]).toBeGreaterThan(b2[2]*1.5);
 await expect(svg).not.toHaveAttribute('data-gesture','on');await expect(sheet.locator('h3')).toHaveText('Tama');
 // The handle cycles peek → half → full → peek; dragging it snaps to the nearest stop.
 const handle=page.locator('#map-sheet-handle');
 await handle.click();await expect(sheet).toHaveAttribute('data-snap','half');await expect.poll(async()=>(await sheet.boundingBox()).height).toBeCloseTo(vp.height*0.5,-1);
 await handle.click();await expect(sheet).toHaveAttribute('data-snap','full');await expect(handle).toHaveAttribute('aria-expanded','true');
 await handle.click();await expect(sheet).toHaveAttribute('data-snap','peek');await expect.poll(async()=>(await sheet.boundingBox()).height).toBeCloseTo(112,0);
 const h=await handle.boundingBox();await page.mouse.move(h.x+h.width/2,h.y+10);await page.mouse.down();await page.mouse.move(h.x+h.width/2,h.y-vp.height*0.4,{steps:6});await page.mouse.up();
 await expect(sheet).toHaveAttribute('data-snap','half');
 // Layers: the toolbar opens as a sheet and goes home when it closes.
 await page.locator('#map-layers-open').click();await expect(page.locator('#drawer #map-overlay')).toBeVisible();await expect(page.locator('#drawer')).toContainText('New Eden');
 await page.locator('#drawer [data-close]').click();await expect(page.locator('#map-controls-home #map-overlay')).toHaveCount(1);
 expect(errors).toEqual([]);
});

test('routes become layers with A/B badges, exit notes and their own bar; systems feed the Haul plan',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'hauling');
 await page.locator('#haul-plan').click();await expect(page.locator('#haul-status')).toContainText('Live:');
 await page.locator('#hauling .map-btn').click();const modal=page.locator('#map-modal');await expect(modal).toBeVisible();
 if(isMobile(page)){const vp=page.viewportSize();await expect.poll(async()=>(await modal.boundingBox()).width).toBeCloseTo(vp.width,0);expect((await modal.boundingBox()).height).toBeCloseTo(vp.height,0);await expect(modal.locator('[data-zoom3d]')).toHaveCount(2);}
 await modal.getByRole('button',{name:'Open in Star map'}).click();await expect(page.locator('#map')).toBeVisible();
 const svg=page.locator('#map svg.region-map'),bar=page.locator('#map-route');
 await expect(bar).toContainText('Balanced route · 3 jumps');await expect(bar.getByRole('button',{name:'Fit route'})).toBeVisible();await expect(bar.getByRole('button',{name:/autopilot/})).toBeVisible();
 // The map opens on the destination's region: B marks Amarr, a stub shows where the route comes in.
 await expect(page.locator('#map-region')).toHaveValue('10000043');await expect(svg.locator('.marks .badge')).toHaveCount(1);await expect(svg.locator('.marks .badge')).toContainText('B');
 await expect(svg.locator('.route-exit')).toHaveCount(1);await expect(svg.locator('.hop-n')).toHaveText('2');
 // In The Forge: A marks Jita and the stub out to Niarja says how far is left.
 await choose(page,'#map-region','10000002');await expect(svg.locator('.marks .badge')).toContainText('A');
 await expect(svg.locator('.exit-note')).toHaveText('→ Domain (+2 jumps)');await expect(svg.locator('.route-exit')).toHaveCount(1);
 // A second route stacks as another layer in another colour.
 await svg.locator('.sys[data-system="30002813"]').click();await page.locator('#map-panel').getByRole('button',{name:/Route from Jita/}).click();
 await modal.getByRole('button',{name:'Open in Star map'}).click();await expect(bar.locator('.layer-row')).toHaveCount(2);
 await expect(svg.locator('.route-line')).toHaveCount(3);
 const colours=await svg.locator('.route-line').evaluateAll(ls=>[...new Set(ls.map(l=>l.getAttribute('style')))]);expect(colours.length).toBe(2);
 await bar.getByRole('button',{name:/Remove Jita → Tama/}).click();await expect(bar.locator('.layer-row')).toHaveCount(1);
 await page.locator('#map-route-clear').click();await expect(bar).toBeHidden();
 // Haul from, Add as stop and Haul here build a plan without losing the old destination.
 const panel=page.locator('#map-panel');
 await svg.locator('.sys[data-system="30002813"]').click();await panel.getByRole('button',{name:'Haul from'}).click();
 await expect(page.locator('#hauling')).toBeVisible();await expect(page.locator('#haul-stops input').first()).toHaveValue('Tama');
 await tab(page,'map');await svg.locator('.sys[data-system="30000144"]').click();await panel.getByRole('button',{name:'Add as stop'}).click();
 await expect(page.locator('#haul-stops input')).toHaveCount(3);await expect(page.locator('#haul-stops input').nth(1)).toHaveValue('Perimeter');
 await tab(page,'map');await svg.locator('.sys[data-system="30000142"]').click();await panel.getByRole('button',{name:'Haul here'}).click();
 expect(await page.locator('#haul-stops input').evaluateAll(i=>i.map(x=>x.value))).toEqual(['Tama','Perimeter','Amarr','Jita']);
 expect(errors).toEqual([]);
});
