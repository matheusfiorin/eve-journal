import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,token,IDS,SETTINGS} from './fixtures.js';
test('connected pilots show skill points, active training, paused queue and searchable skills',async({page})=>{
 const {errors}=await mockApp(page,{connected:true});await openApp(page);await expect(page.locator('.pilot-card').first()).toContainText('125,000');await tab(page,'training');await expect(page.locator('#training-content')).toContainText('Gunnery');await expect(page.locator('.active-training')).toHaveCount(2);await expect(page.locator('#training-content')).toContainText('Paused / not scheduled');await page.locator('[data-skills]').first().click();const list=page.locator(`#skills-${IDS[0]}`);await expect(list).toContainText('Active 3');await list.getByRole('searchbox').fill('Spaceship');await expect(list.locator('.queue-row:visible')).toHaveCount(1);expect(errors).toEqual([]);
});
test('disconnect removes skills and queues from the visible app and tab storage',async({page})=>{
 await mockApp(page,{connected:true});await openApp(page);await page.locator('[data-disconnect]').first().click();await expect(page.locator('.pilot-card').first()).not.toContainText('125,000');await tab(page,'training');await expect(page.locator('#training-content .panel').first()).toContainText('Connect this pilot');const ids=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('eve-sessions')).map(s=>s[0]));expect(ids).not.toContain(IDS[0]);expect(ids).toContain(IDS[1]);
});
test('empty training queues have a useful state',async({page})=>{
 await mockApp(page,{connected:true,queueEmpty:true});await openApp(page);await tab(page,'training');await expect(page.locator('#training-content .panel').first()).toContainText('Your training queue is empty');
});
test('training authorization errors are surfaced without crashing',async({page})=>{
 const {errors}=await mockApp(page,{connected:true,trainingFail:true});await openApp(page);await tab(page,'training');await expect(page.locator('#training-content .panel').first()).toContainText('access expired');expect(errors).toEqual([]);
});
test('missing client ID opens setup rather than a broken login',async({page})=>{
 await mockApp(page);await openApp(page);await page.locator('[data-connect]').first().click();await expect(page.locator('#settings')).toBeVisible();await expect(page.getByLabel('EVE application client ID')).toBeVisible();await expect(page.locator('#callback-url')).toHaveText('http://127.0.0.1:8000/');
});
test('connect produces a PKCE authorization request with correct scope and callback',async({page})=>{
 await mockApp(page,{settings:{pilots:['Fiofka','Decxus'],eveClientId:'test-client'}});
 let authorization;
 await page.route('https://login.eveonline.com/v2/oauth/authorize/**',async route=>{authorization=new URL(route.request().url());await route.fulfill({status:200,body:'EVE test login screen'});});
 await openApp(page);await page.locator('[data-connect]').first().click();await expect.poll(()=>authorization?.searchParams.get('code_challenge_method')).toBe('S256');expect(authorization.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8000/');expect(authorization.searchParams.get('scope')).toContain('esi-skills.read_skills.v1');expect(authorization.searchParams.get('client_id')).toBe('test-client');expect(authorization.searchParams.get('code_challenge')).toHaveLength(43);expect(authorization.searchParams.get('state')).toBeTruthy();
});
async function callbackSetup(page,{wrongCharacter=false,wrongState=false,cancel=false}={}){
 const result=await mockApp(page,{settings:{pilots:['Fiofka','Decxus'],eveClientId:'test-client'}});
 await page.addInitScript(({id})=>sessionStorage.setItem('eve-oauth',JSON.stringify({state:'one-use-state',created:Date.now(),expectedId:id,clientId:'test-client',verifier:'test-verifier'})),{id:IDS[0]});
 let exchanges=0;
 await page.route('https://login.eveonline.com/v2/oauth/token',async route=>{
   exchanges++;const fields=new URLSearchParams(route.request().postData());expect(fields.get('client_id')).toBe('test-client');expect(fields.get('code_verifier')).toBe('test-verifier');expect(fields.get('grant_type')).toBe('authorization_code');
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:token(wrongCharacter?IDS[1]:IDS[0]),expires_in:1200,token_type:'Bearer',refresh_token:'must-not-be-stored'})});
 });
 await page.goto(`/?${cancel?'error=access_denied':'code=test-code'}&state=${wrongState?'wrong':'one-use-state'}`);
 await expect(page.locator('#sync-status')).toContainText('Last refresh');return {...result,exchanges:()=>exchanges};
}
test('authorization callback exchanges code, validates signature, loads training and scrubs the URL',async({page})=>{
 const result=await callbackSetup(page);await expect(page.locator('.pilot-card').first()).toContainText('125,000');expect(result.exchanges()).toBe(1);expect(page.url()).not.toContain('code=');expect(await page.evaluate(()=>sessionStorage.getItem('eve-oauth'))).toBeNull();expect(await page.evaluate(()=>JSON.stringify(sessionStorage))).not.toContain('must-not-be-stored');expect(result.errors).toEqual([]);
});
test('wrong login state cannot exchange the code',async({page})=>{
 const result=await callbackSetup(page,{wrongState:true});expect(result.exchanges()).toBe(0);await expect(page.locator('#notice')).toContainText('did not match');
});
test('wrong character authorization is rejected',async({page})=>{
 await callbackSetup(page,{wrongCharacter:true});await expect(page.locator('#notice')).toContainText('different EVE character');await expect(page.locator('.pilot-card').first()).not.toContainText('125,000');
});
test('cancelled authorization leaves public profiles usable',async({page})=>{
 const result=await callbackSetup(page,{cancel:true});expect(result.exchanges()).toBe(0);await expect(page.locator('#notice')).toContainText('cancelled');await expect(page.locator('.pilot-card').first()).toContainText('Fiofka');
});
test('expiry clears private data when the tab becomes visible',async({page})=>{
 await mockApp(page,{connected:true});await openApp(page);await page.clock.install();await page.clock.fastForward(21*60*1000);await expect(page.locator('.pilot-card').first()).not.toContainText('125,000');await expect(page.locator('#notice')).toContainText('expired');
});
