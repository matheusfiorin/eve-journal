import {test,expect} from '@playwright/test';
import {mockApp,openApp,tab,IDS} from './fixtures.js';
const opaque='b'.repeat(43);
const shared={characterId:IDS[0],name:'Fiofka',skills:{total_sp:333000},queue:[{skill_id:3300,finished_level:5,queue_position:0,start_date:new Date(Date.now()-1000).toISOString(),finish_date:new Date(Date.now()+3600000).toISOString()}],fetchedAt:new Date().toISOString()};
async function setup(page,{privateSession=false,expired=false}={}){
 const result=await mockApp(page,{backend:true});const calls=[];
 await page.route('https://api.example/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method(),authorization:req.headers().authorization});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization','access-control-allow-methods':'GET,POST,OPTIONS'}});
  let body;
  if(path==='/api/public/pilots')body={pilots:[shared]};
  else if(path==='/api/session'||path==='/api/sync'){
   if(expired)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Backend session expired.'})});
   expect(req.headers().authorization).toBe(`Bearer ${opaque}`);
   body={...shared,expires:Date.now()+3600000,skills:{total_sp:333000,unallocated_sp:5000,skills:[{skill_id:3300,trained_skill_level:4,active_skill_level:4}]},operations:{wallet:{permission:true,value:987654.25,fetched:new Date().toISOString()},ship:{permission:true,value:{ship_type_id:605,ship_name:'Server-side ship'}},location:{permission:true,value:{solar_system_id:30000142,station_id:60003760}},jobs:{permission:true,value:[]}}};
  }else if(path==='/api/disconnect')body={disconnected:true};
  else if(path==='/auth/start')return route.fulfill({status:200,body:'EVE backend consent screen'});
  else throw new Error(`Unexpected backend route ${path}`);
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 if(privateSession)await page.addInitScript(({id,opaque})=>sessionStorage.setItem('eve-backend-sessions:https://api.example',JSON.stringify([[id,{token:opaque,expires:Date.now()+3600000}]])),{id:IDS[0],opaque});
 return {...result,calls};
}
test('public visitors see shared training snapshots without any private grant',async({page})=>{
 const {calls,errors}=await setup(page);await openApp(page);await expect(page.locator('.pilot-card').first()).toContainText('333,000');await tab(page,'training');await expect(page.locator('#training-content')).toContainText('Gunnery');await expect(page.locator('[data-skills]')).toHaveCount(0);await tab(page,'operations');await expect(page.locator('#operations-content')).toContainText('Connect this pilot');expect(calls.some(c=>c.path==='/api/session')).toBe(false);expect(errors).toEqual([]);
});
test('private backend sessions show operations without EVE access tokens in the browser',async({page})=>{
 const {errors}=await setup(page,{privateSession:true});await openApp(page);await tab(page,'operations');await expect(page.locator('#operations-content>.panel').first()).toContainText('987,654.25');await expect(page.locator('#operations-content>.panel').first()).toContainText('Server-side ship');await expect(page.locator('#operations-content>.panel').first()).toContainText('Jita IV');expect(await page.evaluate(()=>sessionStorage.getItem('eve-sessions'))).toBeNull();expect(errors).toEqual([]);
});
test('manual refresh requests backend synchronization rather than private ESI calls',async({page})=>{
 const {calls}=await setup(page,{privateSession:true});const privateEsi=[];page.on('request',r=>{if(r.url().includes('esi.evetech.net')&&/\/(skills|skillqueue|wallet|location|ship)\//.test(r.url()))privateEsi.push(r.url());});await openApp(page);await page.locator('#refresh').click();await expect.poll(()=>calls.some(c=>c.path==='/api/sync'&&c.method==='POST')).toBe(true);expect(privateEsi).toEqual([]);
});
test('connect navigates to backend consent rather than browser OAuth exchange',async({page})=>{
 await setup(page);await openApp(page);await page.locator('[data-connect]').first().click();await expect(page).toHaveURL(`https://api.example/auth/start?pilot=${IDS[0]}`);
});
test('expired backend session leaves public snapshots usable and removes private operations',async({page})=>{
 const {errors}=await setup(page,{privateSession:true,expired:true});await openApp(page);await expect(page.locator('.pilot-card').first()).toContainText('333,000');await tab(page,'operations');await expect(page.locator('#operations-content>.panel').first()).not.toContainText('987,654.25');expect(errors).toEqual([]);
});
test('opaque callback fragment is consumed, scrubbed and followed by a private session request',async({page})=>{
 await setup(page);await page.goto(`/#backend_session=${opaque}&pilot=${IDS[0]}&expires=${Date.now()+3600000}`);await expect(page.locator('#sync-status')).toContainText('Last refresh');expect(page.url()).not.toContain('backend_session');await tab(page,'operations');await expect(page.locator('#operations-content>.panel').first()).toContainText('987,654.25');
});
