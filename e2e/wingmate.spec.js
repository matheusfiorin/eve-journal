import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab} from './fixtures.js';
// Decxus connected from his own device: Fiofka's browser holds no session for him, only what he shares with the wing.
test('a wingmate connected on another device shows what he shares, not a Connect prompt',async({page})=>{
 const {errors,privateEsi}=await mockApp(page,{connected:'first'});await openApp(page);
 await tab(page,'wallet');const ledger=page.locator('#ledger'),wallet=page.locator('#ledger-content');
 await ledger.locator('[data-show-pilot="Decxus"]').click();
 await expect(wallet).not.toContainText('wallet is private');
 await expect(wallet.locator('.readout')).toContainText('40,000,000');
 await expect(wallet.locator('.jobs-line')).toContainText('1 job running');
 await expect(wallet).toContainText('Shared with the wing.');await expect(wallet).toContainText('journal and trades stay on their own device');
 await expect(wallet.getByRole('button',{name:'Connect here too'})).toBeVisible();await expect(wallet.getByRole('button',{name:'Connect with EVE'})).toHaveCount(0);
 await tab(page,'clones');await page.locator('#clones [data-show-pilot="Decxus"]').click();
 await expect(page.locator('#clones-content')).toContainText('these stay on their own device');
 expect(privateEsi).toEqual([]);expect(errors).toEqual([]);
});
test('an older wing consent and a failing wingmate sync say why his data is thin',async({page})=>{
 const {errors}=await mockApp(page,{connected:'first',wingLevel:1});await openApp(page);
 await tab(page,'wallet');await page.locator('#ledger [data-show-pilot="Decxus"]').click();const wallet=page.locator('#ledger-content');
 await expect(wallet.locator('.readout')).toContainText('40,000,000');
 await expect(wallet).toContainText('Decxus shares skills, wallet and assets. To share ship, location, jobs and mining too, Decxus reconnects once with the wing box ticked.');
 await page.unrouteAll({behavior:'ignoreErrors'});await mockApp(page,{connected:'first',wingError:'EVE authorization expired or was revoked. Reconnect the pilot.'});await page.reload();
 await tab(page,'wallet');await page.locator('#ledger [data-show-pilot="Decxus"]').click();
 await expect(page.locator('#ledger-content .alert.warn')).toContainText('Decxus’s last sync failed: EVE authorization expired or was revoked.');
 expect(errors).toEqual([]);
});
