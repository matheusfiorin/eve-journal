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
 await page.reload();await expect(page.locator('#sync-status')).toContainText('Last refresh');await expect(hero).toBeHidden();await expect(page.locator('.me-banner h1')).toHaveText('Decxus');
 await page.locator('#switch-pilot').click();await expect(hero).toBeVisible();await page.keyboard.press('Escape');await expect(hero).toBeHidden();
 expect(errors).toEqual([]);
});
test('overview compares the pilot with the wingmate',async({page},testInfo)=>{
 await mockApp(page,{connected:'first'});await openApp(page);
 const vs=page.locator('#overview .vs');
 await expect(page.locator('.me-banner .title-chip')).toHaveText('Rookie Warrior');
 await expect(vs.filter({hasText:'Skill points'})).toContainText('Decxus leads by 1500%');
 await expect(vs.filter({hasText:'Wallet'})).toContainText('Decxus leads');await expect(vs.filter({hasText:'Wallet'})).toContainText('40.0M ISK');
 await expect(vs.filter({hasText:'Net worth'})).toContainText('33.5M ISK');
 await expect(page.locator('#overview')).toContainText('Rookie Industrialist');
 await page.screenshot({path:testInfo.outputPath('overview.png'),fullPage:true});
});
test('a wingmate who does not share keeps their private figures hidden',async({page})=>{
 await mockApp(page,{connected:'first',wingPrivate:true});await openApp(page);
 await expect(page.locator('#overview .vs').filter({hasText:'Wallet'})).toContainText('Decxus’s figure is private');await expect(page.locator('#overview')).toContainText('share with my wingmate');
});
test('empire shows the combined worth, each pilot’s share, titles and holdings',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'empire');const empire=page.locator('#empire-content');
 // Fiofka 12.5M wallet + 21.005M assets; Decxus 40M + 6.5M.
 await expect(empire.locator('.empire-total')).toHaveText('80.0M ISK');await expect(empire.locator('.donut')).toContainText('42%');
 await expect(empire).toContainText('Rookie Warrior');await expect(empire).toContainText('Rookie Industrialist');
 await expect(empire).toContainText('Ship');await expect(empire).toContainText('Implant');
 const top=empire.locator('.holdings li');await expect(top.first()).toContainText('Heron');await expect(top.first()).toContainText('Fiofka');await expect(top.nth(1)).toContainText('Rifter');await expect(top.nth(1)).toContainText('Decxus');
 await page.screenshot({path:testInfo.outputPath('empire.png'),fullPage:true});expect(errors).toEqual([]);
});
test('market ranks hauls, station trades and manufacturing from the pilot’s location',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'market');const market=page.locator('#market');
 await expect(page.locator('#market-status')).toContainText('2 regions');await expect(page.locator('#market-origin')).toContainText('Jita · Fiofka’s location');
 await expect(page.locator('#market-cargo')).toHaveValue('400');await expect(page.locator('#market-fees')).toContainText('from Fiofka’s skills');
 const haul=market.locator('.opp').filter({hasText:'Tritanium'}).first();await expect(haul).toContainText('Amarr VIII');await expect(haul).toContainText('+9 j');await expect(haul).toContainText('40,000 units');
 await expect(market.locator('article').nth(1)).toContainText('Rifter');
 await expect(market.locator('article').nth(2)).toContainText('Rifter');await expect(market.locator('article').nth(2)).toContainText('5.00% system index');
 await page.screenshot({path:testInfo.outputPath('market.png'),fullPage:true});
 await page.locator('#market-cargo').fill('100');await page.locator('#market-cargo').dispatchEvent('change');await expect(haul).toContainText('10,000 units');
 expect(errors).toEqual([]);
});
test('market explains an empty pipeline',async({page})=>{
 await mockApp(page,{noMarket:true});await openApp(page);await tab(page,'market');await expect(page.locator('#market-status')).toContainText('has not stored any data yet');
});
