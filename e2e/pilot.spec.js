import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
test('a new browser picks its pilot in the hero, and the choice sticks',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{fresh:true});await page.goto('/');
 const hero=page.locator('#hero');await expect(hero).toBeVisible();await expect(hero.locator('.hero-pilot')).toHaveCount(2);await expect(hero).toContainText('Who’s flying today?');
 await expect(hero.locator('.hero-pilot img')).toHaveCount(2);
 await page.screenshot({path:testInfo.outputPath('hero.png')});
 await hero.getByRole('button',{name:/Decxus/}).click();await expect(hero).toBeHidden();
 await expect(page.locator('.me-banner h1')).toHaveText('Decxus');await expect(page.locator('#switch-pilot')).toContainText('Decxus');
 expect(await page.evaluate(()=>localStorage.getItem('eve-me:v1'))).toBe('Decxus');
 await page.reload();await expect(page.locator('#sync-status')).toContainText('Synced');await expect(hero).toBeHidden();await expect(page.locator('.me-banner h1')).toHaveText('Decxus');
 await page.locator('#switch-pilot').click();await expect(hero).toBeVisible();await page.keyboard.press('Escape');await expect(hero).toBeHidden();
 expect(errors).toEqual([]);
});
test('the bridge shows the pilot and the wing together, never as a contest',async({page},testInfo)=>{
 await mockApp(page,{connected:'first'});await openApp(page);
 const wing=page.locator('#bridge .wing-card');
 await expect(page.locator('.me-banner .role-badge')).toHaveText('Rookie Warrior');await expect(page.locator('.me-banner')).toContainText('33.5M ISK');
 // Fiofka 12.5M wallet + 21.005M assets; Decxus 40M + 6.5M. One wing figure, no verdicts between pilots.
 await expect(wing).toContainText('Decxus');await expect(wing).toContainText('Rookie Industrialist');
 await expect(wing).toContainText('80.0M ISK');await expect(wing).toContainText('2,125,000');
 await expect(page.locator('#bridge')).not.toContainText(/ leads| vs |Dead even/);
 await page.screenshot({path:testInfo.outputPath('overview.png'),fullPage:true});
});
test('a wingmate who does not share keeps their private figures hidden',async({page})=>{
 await mockApp(page,{connected:'first',wingPrivate:true});await openApp(page);
 const wing=page.locator('#bridge .wing-card');await expect(wing).toContainText('Decxus hasn’t shared their sheet yet');await expect(wing).toContainText('share with my wingmate');await expect(wing).toContainText('33.5M ISK');await expect(wing).not.toContainText('80.0M');
});
test('the crew map credits both pilots and never scores them against each other',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'empire');const crew=page.locator('#strengths');
 await expect(crew.locator('.cap-contrib li[data-pilot="fiofka"]').first()).toBeAttached();await expect(crew.locator('.cap-contrib li[data-pilot="decxus"]').first()).toBeAttached();
 await expect(crew).not.toContainText(/share of|leads|ahead|Dead even/i);
 await page.screenshot({path:testInfo.outputPath('empire.png'),fullPage:true});expect(errors).toEqual([]);
});
test('market ranks hauls, station trades and manufacturing from the pilot’s location',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'market');const market=page.locator('#market');
 await expect(page.locator('#market-status')).toContainText('2 regions');await expect(page.locator('#market-origin')).toContainText('Jita · Fiofka’s location');
 await expect(page.locator('#market-cargo')).toHaveValue('400');await expect(page.locator('#market-fees')).toContainText('from Fiofka’s skills');
 const haul=market.locator('.opp').filter({hasText:'Tritanium'}).first();await expect(haul).toContainText('Amarr VIII');await expect(haul).toContainText('+3 j');await expect(haul).toContainText('40,000 units');
 await expect(market.locator('article').nth(1)).toContainText('Rifter');
 await expect(market.locator('article').nth(2)).toContainText('Rifter');await expect(market.locator('article').nth(2)).toContainText('5.00% system index');
 await page.screenshot({path:testInfo.outputPath('market.png'),fullPage:true});
 await page.locator('#market-cargo').fill('100');await page.locator('#market-cargo').dispatchEvent('change');await expect(haul).toContainText('10,000 units');
 await expect(page.locator('#market-budget')).toHaveValue('12500000');await expect(page.locator('#market-fees')).toContainText('budget 12.5M ISK');
 await page.locator('#market-budget').fill('20000');await page.locator('#market-budget').dispatchEvent('change');
 await expect(haul).toContainText('4,000 units');await expect(haul).toContainText('your whole budget');
 await expect(market.locator('article').nth(1)).not.toContainText('Rifter','a Rifter buy order costs more than 20k');
 await expect(market.locator('article').nth(2)).toContainText('1 more profitable build needs more than 20.0k ISK');
 expect(errors).toEqual([]);
});
test('a cold start fetches the market snapshot and live prices once, and Refresh fetches them again',async({page})=>{
 const {calls}=await mockApp(page,{connected:'first'});const prices=[];page.on('request',r=>{if(r.url().includes('/markets/prices/'))prices.push(r.url());});
 const market=()=>calls.filter(c=>c.path==='/api/market'&&c.method==='GET').length;
 // A slow backend: the palette and the Market screen both ask for the snapshot before the first answer lands.
 await page.route('https://api.example/api/market',async route=>{await new Promise(r=>setTimeout(r,800));await route.fallback();});
 await page.route('https://esi.evetech.net/**/markets/prices/**',async route=>{await new Promise(r=>setTimeout(r,800));await route.fallback();});
 await openApp(page);
 await page.keyboard.press('Control+K');await expect(page.locator('#palette')).toBeVisible();await page.keyboard.press('Escape');
 await tab(page,'market');await expect(page.locator('#market-status')).toContainText('2 regions');
 await tab(page,'industry');await expect(page.locator('#industry .bpos .opp').first()).toBeVisible();
 expect(market()).toBe(1);expect(prices).toHaveLength(1);
 await page.locator('#refresh').click();await expect(page.locator('#sync-status')).toContainText('Synced');await expect(page.locator('#industry .bpos .opp').first()).toBeVisible();
 await expect.poll(market).toBe(2);expect(prices).toHaveLength(2);
});
test('market explains an empty pipeline',async({page})=>{
 await mockApp(page,{noMarket:true});await openApp(page);await tab(page,'market');await expect(page.locator('#market-status')).toContainText('has not stored any data yet');
});
