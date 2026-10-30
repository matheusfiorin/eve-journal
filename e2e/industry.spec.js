import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
test('industry ranks starter blueprints with research plans, payback and pilot assignments',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:'first'});await openApp(page);await tab(page,'industry');const industry=page.locator('#industry');
 await expect(page.locator('#industry-status')).toContainText('2 cheap T1 blueprints');
 await expect(page.locator('#industry-system')).toContainText('Jita · Fiofka’s location');await expect(page.locator('#industry-budget')).toHaveValue('12500000');
 const setup=industry.locator('article').first();await expect(setup).toContainText('Alpha');await expect(setup).toContainText('Build slots');
 await expect(industry.locator('article').nth(1)).toContainText('Week 1');await expect(industry.locator('article').nth(1)).toContainText('Mass Production');
 const picks=industry.locator('.bpos .opp');await expect(picks).toHaveCount(2);
 await expect(picks.first()).toContainText('Hobgoblin I');await expect(picks.first()).toContainText('ME 0 → 10');await expect(picks.first()).toContainText('Suggested for Fiofka');await expect(picks.first()).toContainText('/day');
 await expect(picks.nth(1)).toContainText('Rifter');await expect(picks.nth(1)).toContainText('ME 0 → 6');await expect(picks.nth(1)).toContainText('Suggested for Decxus');
 await page.screenshot({path:testInfo.outputPath('industry.png'),fullPage:true});
 await page.locator('#industry-budget').fill('1000000');await page.locator('#industry-budget').dispatchEvent('change');
 await expect(picks.filter({hasText:'Rifter'})).toContainText('Over budget');await expect(picks.first()).toContainText('Hobgoblin I');
 expect(errors).toEqual([]);
});
test('industry works for a visitor without a session, using base fees',async({page})=>{
 await mockApp(page);await openApp(page);await tab(page,'industry');await expect(page.locator('#industry')).toContainText('Connect Fiofka to plan with real skills');await expect(page.locator('#industry .bpos .opp').first()).toContainText('Hobgoblin I');
});
