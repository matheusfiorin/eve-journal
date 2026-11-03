import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile} from './fixtures.js';
// The map's selects sit in the toolbar on desktop and in the Layers sheet on phones.
async function choose(page,select,value){
 const phone=isMobile(page);if(phone)await page.locator('#map-layers-open').click();
 await page.locator(select).selectOption(value);
 if(phone){await page.locator('#drawer [data-close]').click();await expect(page.locator('#drawer')).toBeHidden();}
}
test('map draws the region with security lights, overlays, jump range, search and a system panel',async({page},testInfo)=>{
 const ctx=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'map');const map=page.locator('#map');
 await expect(page.locator('#map-status')).toContainText('5 systems · 2 regions · 10 ship kills');await expect(page.locator('#map-status')).toContainText('1 incursion');
 await expect(page.locator('#map-region')).toHaveValue('10000002');
 const svg=map.locator('svg.region-map');await expect(svg.locator('.sys')).toHaveCount(3);await expect(svg.locator('g.exit')).toHaveCount(1);await expect(svg.locator('g.exit')).toContainText('Niarja');
 await expect(svg.locator('.sys[data-system="30000142"]')).toHaveClass(/selected/);await expect(svg.locator('.sys[data-system="30000142"] .light')).toHaveAttribute('style',/#399aeb/);
 const panel=page.locator('#map-panel');await expect(panel.locator('h3')).toHaveText('Jita');await expect(panel).toContainText('Kimotoro · The Forge');await expect(panel).toContainText('Caldari State');
 await expect(panel).toContainText('Jita IV - Moon 4 - Caldari Navy Assembly Plant');await expect(panel.locator('.stations')).toContainText('Factory');
 await svg.locator('.sys[data-system="30002813"]').hover();await expect(page.locator('#map-tip')).toContainText('Tama');await expect(page.locator('#map-tip')).toContainText('0.3');
 await choose(page,'#map-overlay','shipKills');await expect(svg.locator('.sys[data-system="30002813"] .halo')).toBeVisible();await expect(svg.locator('.sys[data-system="30002813"]')).toHaveAttribute('data-value','7');
 await expect(page.locator('#map-legend')).toContainText('Ship kills (last hour)');
 await svg.locator('.sys[data-system="30002813"]').click();await expect(panel.locator('h3')).toHaveText('Tama');await expect(panel).toContainText('Faction warfare');await expect(panel).toContainText('contested 10%');
 await choose(page,'#map-jump','jf');await expect(page.locator('#map-legend')).toContainText('No low-sec or null-sec systems within 10 ly');
 await choose(page,'#map-overlay','security');
 await page.locator('#map-search').fill('Amarr');await page.locator('#map-find button').click();
 await expect(page.locator('#map-region')).toHaveValue('10000043');await expect(panel.locator('h3')).toHaveText('Amarr');await expect(panel).toContainText('Incursion');await expect(panel).toContainText('Route from Jita · 3 j');
 await expect(page.locator('#map-legend')).toContainText('1 system within 10 ly');await expect(panel).toContainText('In jump range (1)');await expect(panel).toContainText('9.70 ly');
 await panel.getByRole('button',{name:/Niarja/}).click();await expect(panel.locator('h3')).toHaveText('Niarja');
 await page.screenshot({path:testInfo.outputPath('map-region.png'),fullPage:true});
 await choose(page,'#map-view','universe');const canvas=map.locator('canvas.star-map');await expect(canvas).toBeVisible();
 await expect.poll(async()=>Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(5);
 const xy=(await canvas.getAttribute('data-focus-xy')).split(',').map(Number);
 await choose(page,'#map-view','region3d');await choose(page,'#map-jump','');
 // The camera keeps turning; hover-test a still frame with reduced motion.
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await expect(page.locator('#sync-status')).toContainText('Synced');
 await page.locator('#map-search').fill('Niarja');await page.locator('#map-find button').click();await choose(page,'#map-view','region3d');
 await expect.poll(async()=>await canvas.getAttribute('data-focus-xy')).not.toBeNull();
 const p=(await canvas.getAttribute('data-focus-xy')).split(',').map(Number);const box=await canvas.boundingBox();
 if(testInfo.project.name!=='mobile'){await page.mouse.move(box.x+p[0],box.y+p[1]);await expect(page.locator('#map-tip')).toContainText('Niarja');}
 // A click (or tap) on a star selects it.
 await page.mouse.click(box.x+p[0],box.y+p[1]);await expect(page.locator('#map-panel h3')).toHaveText('Niarja');
 await page.screenshot({path:testInfo.outputPath('map-3d.png')});
 expect(xy.length).toBe(2);expect(ctx.errors).toEqual([]);
});
test('routes across the app preview on hover and open in the 3D modal, then in the Map tab',async({page},testInfo)=>{
 const ctx=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'hauling');
 await page.locator('#haul-plan').click();await expect(page.locator('#haul-status')).toContainText('Live:');
 const touch=testInfo.project.name==='mobile',pop=page.locator('#route-pop');
 // Hover previews are for mice; touch screens use the ◎ 3D button.
 if(!touch){await page.locator('.hop-list').hover();await expect(pop).toBeVisible();await expect(pop.locator('circle')).toHaveCount(4);await expect(pop).toContainText('3 jumps');}
 await page.locator('#hauling .map-btn').click();const modal=page.locator('#map-modal');await expect(modal).toBeVisible();await expect(modal.locator('#map-modal-title')).toContainText('Balanced route');
 await expect(modal.locator('.hop-strip li')).toHaveCount(4);await expect(modal).toContainText('The Forge → Domain');
 const canvas=modal.locator('canvas');await expect.poll(async()=>Number(await canvas.getAttribute('data-frames'))).toBeGreaterThan(3);
 await page.screenshot({path:testInfo.outputPath('map-modal.png')});
 await modal.getByRole('button',{name:'Open in Star map'}).click();await expect(modal).toBeHidden();await expect(page.locator('#map')).toBeVisible();
 await expect(page.locator('#map-route')).toContainText('Balanced route · 3 jumps');await expect(page.locator('svg.region-map .route-line')).toHaveCount(1,'Jita–Perimeter is inside Domain? no: the Forge part');
 await page.locator('#map-route-clear').click();await expect(page.locator('#map-route')).toBeHidden();
 await tab(page,'industry');await page.locator('#industry .rows__row').filter({hasText:'Rifter'}).click();const trip=page.locator('#drawer');await expect(trip).toBeVisible();
 if(!touch){await trip.locator('.leg').first().hover();await expect(pop).toBeVisible();await expect(pop).toContainText('Buy the blueprint');}
 await trip.locator('.leg').first().locator('.map-btn').click();await expect(modal).toBeVisible();await expect(modal.locator('.hop-strip li')).toHaveCount(4);
 await modal.locator('.hop-strip').getByRole('button',{name:/Perimeter/}).click();await expect(modal.locator('#map-modal-title')).toHaveText('Perimeter');await expect(modal.locator('.sys-panel')).toContainText('Kimotoro');
 await page.locator('#map-modal-close').click();await expect(modal).toBeHidden();await page.keyboard.press('Escape');
 await tab(page,'mining');await page.locator('#mining .rows__row').first().locator('a[data-system]').click();await expect(modal).toBeVisible();await expect(modal.locator('#map-modal-title')).toHaveText('Perimeter');
 await modal.getByRole('button',{name:'Haul here'}).click();await expect(page.locator('#hauling')).toBeVisible();await expect(page.locator('#haul-stops input').last()).toHaveValue('Perimeter');
 expect(ctx.errors).toEqual([]);
});
