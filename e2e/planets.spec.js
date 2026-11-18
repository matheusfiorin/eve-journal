import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile} from './fixtures.js';
test('Planets lists both pilots\' colonies with expiry, rate, storage and the last visit in game',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'planets');
 const view=page.locator('#planets');await expect(page.locator('#planets-status')).toContainText('3 colonies across 2 pilots');
 await expect(page).toHaveURL(/#earn\/planets/);
 const fiofka=view.locator('.colony-group[data-pilot="fiofka"]'),decxus=view.locator('.colony-group[data-pilot="decxus"]');
 await expect(fiofka.locator('[data-colony]')).toHaveCount(2);await expect(decxus.locator('[data-colony]')).toHaveCount(1);
 // The lava colony has an expired extractor, so it comes first.
 const lava=fiofka.locator('[data-colony]').first();
 await expect(lava).toContainText('Lava planet');await expect(lava).toContainText('Level 3');await expect(lava).toContainText('9 pins');await expect(lava).toContainText('Extractor expired');
 await expect(lava.locator('.colony__ext li').first()).toContainText('Expired 5h ago');await expect(lava.locator('.colony__ext li').first()).toContainText('1,200 an hour');
 await expect(lava.locator('.colony__ext li').nth(1)).toContainText('Expires in 10h');await expect(lava).toContainText('Expires in 10h');
 await expect(lava.locator('[role=img]')).toHaveAttribute('aria-label','Storage 1% full');
 await expect(lava).toContainText('Last updated in game 1d');
 await expect(fiofka.locator('[data-colony]').nth(1)).toContainText('Barren planet');await expect(fiofka.locator('[data-colony]').nth(1)).toContainText('Running');
 await expect(decxus.locator('[data-colony]')).toContainText('Storm planet');
 await expect(view.locator('.earn-sum')).toContainText('Last updated in game'.slice(0,0)+'EVE only refreshes a colony');
 await expect(view.locator('.earn-sum .readout')).toContainText('Extractors expired');
 await page.screenshot({path:testInfo.outputPath('planets.png'),fullPage:true});
 // The filter searches planet type, system and product.
 await page.locator('#planets-filter').fill('barren');await expect(view.locator('[data-colony]:visible')).toHaveCount(1);
 await page.locator('#planets-filter').fill('zzz');await expect(page.locator('#planets-none')).toBeVisible();await page.locator('#planets-filter').fill('');
 if(!isMobile(page)){await page.keyboard.press('Escape');await page.locator('#planets h2').first().click();await page.keyboard.press('/');await expect(page.locator('#planets-filter')).toBeFocused();}
 expect(errors).toEqual([]);
});
test('Planets: a wingmate who shares less is left out, and a pilot without the scope is asked to reconnect',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first',wingLevel:1,oldScopes:true});await openApp(page);await tab(page,'planets');
 const view=page.locator('#planets');
 await expect(view.locator('.colony-group[data-pilot="decxus"]')).toContainText('not shared with the wing');
 await expect(view.locator('.colony-group[data-pilot="fiofka"]')).toContainText(/permission|reconnect/i);
 await expect(view.locator('[data-colony]')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('Build uses the blueprints a pilot owns: no purchase leg, the owned ME, a wingmate\'s copy, and a filterable list',async({page},testInfo)=>{
 test.setTimeout(90000);
 const {errors}=await mockApp(page,{connected:'first',ownsStarters:true});await openApp(page);await tab(page,'industry');
 const industry=page.locator('#industry'),drawer=page.locator('#drawer'),picks=industry.locator('.rows__row');
 await expect(picks.first()).toContainText('Hobgoblin I');await expect(picks.first()).toContainText('Owned (ME 8/TE 12)');
 await picks.first().click();await expect(drawer).toContainText('Owned (ME 8/TE 12)');await expect(drawer).toContainText('nothing to buy');await expect(drawer).toContainText('ME 8 → 10');
 await expect(drawer).toContainText('TE 12: builds take 12% less time');
 await expect(drawer.locator('.legs')).not.toContainText('Buy the blueprint');await expect(drawer.locator('.legs')).toContainText('Research to ME 10');
 await page.keyboard.press('Escape');
 // Decxus shares his Rifter original at ME 6, so the wing plan keeps the Rifter with him.
 await expect(industry.locator('.wplan')).toContainText('Decxus builds Rifter (owns the blueprint)');
 const library=industry.locator('section:has(#bplib-title)');
 await expect(library).toContainText('Fiofka');await expect(library).toContainText('Decxus');
 await expect(library.locator('[data-lib]')).toHaveCount(4);
 await expect(library).toContainText('Hobgoblin I Blueprint');await expect(library).toContainText('Owned (ME 8/TE 12)');await expect(library).toContainText('Copy, 5 runs');
 await page.screenshot({path:testInfo.outputPath('blueprints.png'),fullPage:true});
 await page.locator('#industry-filter').fill('copy');await expect(library.locator('[data-lib]:visible')).toHaveCount(1);
 await page.locator('#industry-filter').fill('zzz');await expect(library.locator('[data-lib-none]')).toBeVisible();await page.locator('#industry-filter').fill('');
 expect(errors).toEqual([]);
});
test('Build with a copy: shows the runs left, and a wingmate sharing less is not counted',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first',ownsStarters:true,wingLevel:1});await openApp(page);await tab(page,'industry');
 const industry=page.locator('#industry'),picks=industry.locator('.rows__row'),drawer=page.locator('#drawer');
 await expect(industry.locator('section.panel:has(#bplib-title)')).toContainText('Decxus’s blueprints are not shared with the wing');
 await picks.filter({hasText:'Rifter'}).click();await expect(drawer).toContainText('Copy, 5 runs');await expect(drawer).toContainText('A copy can’t be researched');await expect(drawer).toContainText('capped at');
 await expect(drawer.locator('.legs')).not.toContainText('Buy the blueprint');await expect(drawer.locator('.legs')).not.toContainText('Research to');
 expect(errors).toEqual([]);
});
test('Trade shows the broker fee at each hub from the pilot\'s standings, and says when they are not applied',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'market');
 const panel=page.locator('#market .brokers');await expect(panel).toBeVisible();
 const jita=panel.locator('li',{hasText:'Jita'}),amarr=panel.locator('li',{hasText:'Amarr'});
 // Broker Relations 0: 3% less 0.03% x 5 (faction) and 0.02% x 4 (corporation).
 await expect(jita).toContainText('2.77%');await expect(jita).toContainText('standing 5.0 with the faction, 4.0 with the corporation');
 await expect(amarr).toContainText('3.00%');
 await expect(panel).toContainText('never below 1%');
 await page.screenshot({path:testInfo.outputPath('brokers.png'),fullPage:true});
 expect(errors).toEqual([]);
 const other=await page.context().newPage();
 const second=await mockApp(other,{connected:'first',oldScopes:true});await openApp(other);await tab(other,'market');
 await expect(other.locator('#market .brokers li',{hasText:'Jita'})).toContainText('standings not applied');await expect(other.locator('#market .brokers li',{hasText:'Jita'})).toContainText('3.00%');
 expect(second.errors).toEqual([]);
});
test('Trade falls back to the skill-only fee when a station owner is unknown',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first',noStationOwners:true});await openApp(page);await tab(page,'market');
 const jita=page.locator('#market .brokers li',{hasText:'Jita'});await expect(jita).toContainText('3.00%');await expect(jita).toContainText('standings not applied');
 expect(errors).toEqual([]);
});
