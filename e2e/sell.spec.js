import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,isMobile,IDS,JITA} from './fixtures.js';

// Both pilots fly Coercers docked at Jita; the mocked ESI has buy orders for Tritanium (Jita, a ranged order in Perimeter, Amarr)
// and Pyerite (a thin book in Jita, a deep one in Amarr).
const open=async(page,options={})=>{const app=await mockApp(page,{connected:true,coercer:true,...options});await openApp(page);await tab(page,'sell');await expect(page).toHaveURL(/#earn\/sell/);return app;};
// The settings fold away after the first plan on a phone; open them to change something.
const settings=async page=>{if(isMobile(page)){await expect(page.locator('#sell-content [data-sell-plan]').first()).toBeVisible();await expect(page.locator('#sell-setup')).not.toHaveAttribute('open','');}if(isMobile(page)&&!await page.locator('#sell-setup').evaluate(d=>d.open))await page.locator('#sell-setup>summary').click();};
const best=page=>page.locator('#sell-content [data-sell-plan="best"]');
const anyPlan=page=>page.locator('#sell-content [data-sell-plan]').first();
const noOverflow=async page=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);

test('Sell lists the ships and the items from cargo and the hangar, with sizes',async({page})=>{
 const {errors}=await open(page);
 const ships=page.locator('#sell-ships .sell-ship');await expect(ships).toHaveCount(2);
 await expect(ships.first()).toContainText('Hauler one');await expect(ships.first()).toContainText('Coercer');await expect(ships.first()).toContainText('Docked at Jita IV');
 await expect(page.getByLabel('Cargo m³ for Hauler one')).toHaveValue('375');
 await expect(page.getByLabel('Include Hauler two (Decxus)')).toBeChecked();
 await expect(page.locator('#sell-pickup')).toContainText('Item hangar at Jita IV - Moon 4');
 const lots=page.locator('#sell-items .sell-lot');
 // Fiofka: 1,000 Tritanium in the hold and 50,000 in the hangar; Decxus: 100 Pyerite in the hold.
 await expect(lots.filter({hasText:'Tritanium'}).filter({hasText:'Hauler one’s hold'})).toHaveCount(1);
 await expect(page.getByLabel('Quantity of Tritanium from Hauler one’s hold')).toHaveValue('1000');
 await expect(page.getByLabel('Quantity of Tritanium from Hangar at Jita IV - Moon 4 - Caldari Navy Assembly Plant')).toHaveValue('58000');
 await expect(page.getByLabel('Quantity of Pyerite from Hauler two’s hold')).toHaveValue('100');
 await expect(lots.filter({hasText:'Pyerite'}).filter({hasText:'Hangar at Jita'})).toContainText('120 m³');
 expect(errors).toEqual([]);
});

test('Sell shows plan cards with Sell here at 0 jumps, the quotes behind it, and the age of the prices',async({page},testInfo)=>{
 const {errors,state}=await open(page);
 const cards=page.locator('#sell-content [data-sell-plan]');
 await expect(cards.first()).toContainText('Sell here');await expect(cards.first()).toContainText('0 jumps');
 await expect(cards.first()).toContainText('net');await expect(cards.first()).toContainText('Score');
 // When the best plan is to sell where the ships stand, one card says so rather than showing the same plan twice.
 await expect(cards.first()).toContainText('Also Best');
 await expect(page.locator('#sell-status')).toContainText('Buy orders as of just now');
 // Quotes are asked per region and type, buy side only; the type calls are for the items on offer.
 expect(state.orderCalls.length).toBeGreaterThan(0);
 expect(state.orderCalls.every(c=>c.endsWith(':buy:1'))).toBe(true);
 expect(state.orderCalls).toContain('10000002:34:buy:1');expect(state.orderCalls).toContain('10000043:35:buy:1');
 // Selling here: Jita's own 4.6 order and the ranged 4.8 order in Perimeter, which a ship docked in Jita can fill.
 await cards.first().click();
 const plan=page.locator('#sell-content .sell-plan');
 await expect(plan).toContainText('Sell here');
 await expect(plan.locator('.sell-ship-plan').first()).toContainText('Jita IV');
 await expect(plan).toContainText('buy order in Perimeter II - Moon 1 - Lab, range 1 jump');
 await expect(plan).toContainText('Sell');
 // The thin Pyerite book in Jita is called out.
 await expect(plan).toContainText('Thin book for Pyerite');
 await page.screenshot({path:testInfo.outputPath('plan.png'),fullPage:true});
 await noOverflow(page);
 expect(errors).toEqual([]);
});

test('Changing ISK per jump changes the Best plan',async({page})=>{
 const {errors}=await open(page);
 await expect(best(page)).toHaveCount(0);
 const before=await page.locator('#sell-content [data-sell-plan]').first().innerText();expect(before).toContain('Also Best');
 await settings(page);
 await page.locator('#sell-perjump').fill('100');await page.locator('#sell-perjump').press('Tab');
 await expect(best(page)).toContainText('6 jumps');
 expect(await best(page).innerText()).not.toBe(before);
 // The setting is kept for the next visit.
 await page.reload();await expect(page.locator('#sell-status')).toBeVisible();
 await tab(page,'sell');await expect(page.locator('#sell-perjump')).toHaveValue('100');
 expect(errors).toEqual([]);
});

test('Choosing a pickup station saves it and says when its hangar arrives; Use docked station resets it',async({page})=>{
 const {errors,state}=await open(page);
 await settings(page);
 await page.locator('#sell-pickup [data-sell-change]').click();
 await page.locator('#sell-pickup-input').fill('Nowhere');await page.locator('#sell-pickup [data-sell-save]').click();
 await expect(page.locator('#sell-pickup')).toContainText('Pick a station from the list');expect(state.sellStationPosts||[]).toEqual([]);
 await page.locator('#sell-pickup-input').fill('Niarja III');
 await expect(page.locator('#stations option[value="Niarja III - Factory"]')).toHaveCount(1);
 await page.locator('#sell-pickup-input').fill('Niarja III - Factory');await page.locator('#sell-pickup [data-sell-save]').click();
 await expect(page.locator('#sell-pickup')).toContainText('Hangar contents for Niarja III - Factory arrive with the next sync (up to 10 minutes)');
 expect(state.sellStationPosts).toEqual([60000002]);
 await expect(page.locator('#sell-pickup')).toContainText('Item hangar at Niarja III - Factory');await expect(page.locator('#sell-pickup')).toContainText('Nothing is known there yet');
 await page.locator('#sell-pickup [data-sell-docked]').click();
 await expect(page.locator('#sell-pickup')).toContainText('Item hangar at Jita IV');
 expect(state.sellStationPosts).toEqual([60000002,null]);
 expect(errors).toEqual([]);
});

test('Paste a list adds items by name from EVE\'s copy formats',async({page})=>{
 const {errors}=await open(page);
 await settings(page);
 await page.locator('#sell-paste>summary').click();
 await page.locator('#sell-paste-text').fill('Hobgoblin I\t12\tDrone\n3 x Nanite Repair Paste\nNo Such Thing x4');
 await page.locator('#sell-paste-add').click();
 await expect(page.locator('#sell-paste-out')).toContainText('Added 2 items');await expect(page.locator('#sell-paste-out')).toContainText('Not found: No Such Thing');
 await expect(page.getByLabel('Quantity of Hobgoblin I from Hangar at Jita IV - Moon 4 - Caldari Navy Assembly Plant')).toHaveValue('12');
 await expect(page.locator('#sell-items .sell-lot',{hasText:'Nanite Repair Paste'})).toContainText('pasted');
 expect(errors).toEqual([]);
});

test('Send to autopilot posts waypoints for that pilot only, and is off for a pilot who is not connected here',async({page})=>{
 const {errors,state}=await open(page);
 await settings(page);await page.locator('#sell-perjump').fill('100');await page.locator('#sell-perjump').press('Tab');
 await expect(best(page)).toContainText('6 jumps');
 const send=page.locator('#sell-content [data-sell-send]');await expect(send).toHaveCount(2);
 const posts=[];page.on('request',r=>{if(r.url().endsWith('/api/waypoints'))posts.push(r.headers().authorization);});
 await send.nth(1).click();
 await expect(page.locator(`[data-sell-out="${IDS[1]}"]`)).toContainText('Autopilot set');
 expect(posts.length).toBe(1);expect(posts[0]).toMatch(/c?b+1$/);expect(state.waypoints.length).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});

test('Send to autopilot is disabled with a reason when the pilot is not connected in this browser',async({page})=>{
 const {errors}=await open(page,{connected:'first'});
 await settings(page);await page.locator('#sell-perjump').fill('100');await page.locator('#sell-perjump').press('Tab');
 await expect(best(page)).toContainText('6 jumps');
 const sends=page.locator('#sell-content [data-sell-send]');
 await expect(sends).toHaveCount(2);
 await expect(sends.first()).toBeEnabled();await expect(sends.nth(1)).toBeDisabled();
 await expect(page.locator('#sell-content .sell-ship-plan').nth(1)).toContainText('Connect Decxus in this browser');
 expect(errors).toEqual([]);
});

test('Open in Star map adds both ships\' routes as layers',async({page})=>{
 const {errors}=await open(page);
 await settings(page);await page.locator('#sell-perjump').fill('100');await page.locator('#sell-perjump').press('Tab');
 await expect(best(page)).toContainText('6 jumps');
 await page.locator('#sell-content [data-sell-map]').first().click();
 await expect(page).toHaveURL(/#navigate\/map/);
 await expect(page.locator('#map-route .layer-row')).toHaveCount(2);
 await expect(page.locator('#map-route')).toContainText('Sell: Hauler one');await expect(page.locator('#map-route')).toContainText('Sell: Hauler two');
 expect(errors).toEqual([]);
});

test('Sell leaves a ship out when unticked, and says what no plan can sell',async({page})=>{
 const {errors}=await open(page);
 await settings(page);
 await page.getByLabel('Include Hauler two (Decxus)').uncheck();
 await expect(page.locator('#sell-content .sell-ship-plan')).toHaveCount(1);
 await expect(page.locator('#sell-content .sell-unsold')).toContainText('No buy orders found');await expect(page.locator('#sell-content .sell-unsold')).toContainText('No room left in the hold');
 await page.getByLabel('Include Hauler one (Fiofka)').uncheck();
 await expect(page.locator('#sell-status')).toContainText('Tick at least one ship');
 expect(errors).toEqual([]);
});

test('Sell on a phone or desktop never scrolls sideways, with plan, settings and lists drawn',async({page})=>{
 const {errors}=await open(page);
 await expect(anyPlan(page)).toBeVisible();await noOverflow(page);
 await settings(page);await noOverflow(page);
 if(isMobile(page)){
  // After the first plan the settings fold away, and the plans come before them.
  await page.reload();await tab(page,'sell');await expect(anyPlan(page)).toBeVisible();
  await expect(page.locator('#sell-setup')).not.toHaveAttribute('open','');
  const y=async s=>(await page.locator(s).boundingBox()).y;
  expect(await y('#sell-content')).toBeLessThan(await y('#sell-form'));
 }
 expect(errors).toEqual([]);
});

test('Sell without any buy orders says so, and a pilot who is not docked is told so',async({page})=>{
 const {errors}=await open(page,{noOrderBooks:true,undocked:true});
 await expect(page.locator('#sell-content')).toContainText('No buy orders found for Tritanium');
 await expect(page.locator('#sell-content .sell-unsold')).toContainText('No buy orders found');
 await expect(page.locator('#sell-ships .sell-ship').nth(1)).toContainText('Not docked, in Perimeter');
 await expect(page.locator('#sell-ships .sell-ship').first()).toContainText('Docked at Jita IV');
 expect(errors).toEqual([]);
});
