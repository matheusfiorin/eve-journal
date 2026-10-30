import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
test('training shows the active skill, timeline and paused entries',async({page},testInfo)=>{
 const {errors}=await mockApp(page,{connected:true});await openApp(page);await tab(page,'training');const card=page.locator('#training-content .card').first();
 await expect(card.locator('.alert')).toContainText('queue ends in');await expect(card.locator('.active')).toContainText('Gunnery V');await expect(card.locator('.timeline li')).toHaveCount(2);await expect(card.locator('.timeline li').first()).toContainText('Gunnery');await expect(card).toContainText('Paused / not scheduled');
 await page.screenshot({path:testInfo.outputPath('training.png'),fullPage:true});expect(errors).toEqual([]);
});
test('an empty queue raises a not-training alert everywhere',async({page})=>{
 await mockApp(page,{connected:true,queueEmpty:true});await openApp(page);await expect(page.locator('.me-banner')).toContainText('Not training');await tab(page,'training');await expect(page.locator('#training-content .card').first()).toContainText('Your training queue is empty');
});
test('a queue that runs out within a day warns the pilot',async({page})=>{
 await mockApp(page,{connected:true,queueEnding:true});await openApp(page);await expect(page.locator('.me-banner').locator('.alert.warn')).toContainText('Queue runs out');
});
test('skill sheet groups skills, shows levels and filters by search',async({page},testInfo)=>{
 await mockApp(page,{connected:true});await openApp(page);await tab(page,'skills');const card=page.locator('#skills-content .card').first();
 await expect(card.locator('.skill-group')).toHaveCount(2);await expect(card.locator('.skill-group').first()).toContainText('Gunnery');await expect(card).toContainText('90,510 SP');await expect(card).toContainText('Active 3 of 4');
 await card.getByRole('searchbox').fill('Spaceship');await expect(card.locator('.skill-group:visible')).toHaveCount(1);await expect(card.locator('.skill:visible')).toHaveCount(1);
 await page.screenshot({path:testInfo.outputPath('skills.png'),fullPage:true});
});
test('session expiry clears private data and keeps shared training',async({page})=>{
 await page.clock.install();await mockApp(page,{connected:true});await openApp(page);await expect(page.locator('.me-banner')).toContainText('125,000');await page.clock.fastForward(21*60*1000);await expect(page.locator('#notice')).toContainText('expired');await expect(page.locator('.me-banner')).toContainText('333,000');
});
