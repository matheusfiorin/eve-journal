import {expect} from '@playwright/test';
import {REQUESTED_SCOPES} from '../auth.js';
import {generateKeyPairSync,sign} from 'node:crypto';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
export const jwk={...pair.publicKey.export({format:'jwk'}),kid:'e2e-key',alg:'RS256',use:'sig'};
export const IDS=[2124810474,2124815118];
export const names=['Fiofka','Decxus'];
export const KEY='eve-flight-journal:v1';
export const SETTINGS='eve-flight-settings:v1';
export function token(id=IDS[0],overrides={}) {
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:'https://login.eveonline.com',aud:['test-client','EVE Online'],azp:'test-client',sub:`CHARACTER:EVE:${id}`,name:names[IDS.indexOf(id)],exp:Math.floor(Date.now()/1000)+1200,scp:['esi-skills.read_skills.v1','esi-skills.read_skillqueue.v1'],...overrides})).toString('base64url');
  const body=`${header}.${payload}`;
  return `${body}.${sign('RSA-SHA256',Buffer.from(body),pair.privateKey).toString('base64url')}`;
}
export async function mockApp(page,options={}) {
  const state={fail:false,missing:false,trainingFail:false,queueEmpty:false,...options};
  if(options.backend)await page.route('**/config.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({title:'EVE Pilot Console',pilots:names,eveClientId:'test-client',backendUrl:'https://api.example'})}));
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://images.evetech.net/**',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#284736"/></svg>'}));
  await page.route('https://esi.evetech.net/**',async route=>{
    if(state.fail)return route.fulfill({status:503,body:'{}'});
    const url=new URL(route.request().url()),path=url.pathname;
    let body;
    if(path.includes('/status/'))body={players:25432,server_version:'test',start_time:'2026-10-30T11:00:00Z',vip:false};
    else if(path.includes('/corporationhistory/'))body=[{corporation_id:1000044,start_date:'2026-01-01T00:00:00Z',record_id:1}];
    else if(path.includes('/wallet/')){if(state.walletFail)return route.fulfill({status:403,body:'{}'});body=12500000.25;}
    else if(path.includes('/location/'))body={solar_system_id:30000142,station_id:60003760};
    else if(path.includes('/ship/'))body={ship_type_id:605,ship_name:'Our first explorer',ship_item_id:123};
    else if(path.includes('/industry/jobs/'))body=state.noJobs?[]:[{job_id:1,blueprint_type_id:1234,product_type_id:605,runs:2,status:'active',end_date:new Date(Date.now()+86400000).toISOString()}];
    else if(path.includes('/universe/stations/'))body={name:'Jita IV - Moon 4 - Caldari Navy Assembly Plant'};
    else if(path.includes('/universe/ids/'))body={characters:state.missing?[]:IDS.map((id,i)=>({id,name:names[i]}))};
    else if(path.includes('/corporations/'))body={name:'Test Flight Academy',ticker:'TFA',member_count:120,tax_rate:0.1};
    else if(path.includes('/universe/names/'))body=JSON.parse(route.request().postData()).map(id=>({id,name:({3300:'Gunnery',3327:'Spaceship Command',605:'Heron',30000142:'Jita'})[id]||`Type ${id}`}));
    else if(path.includes('/skills/')){if(state.trainingFail)return route.fulfill({status:401,body:'{}'});body={total_sp:125000,unallocated_sp:5000,skills:[{skill_id:3300,trained_skill_level:4,active_skill_level:3},{skill_id:3327,trained_skill_level:2,active_skill_level:2}]};}
    else if(path.includes('/skillqueue/')){if(state.trainingFail)return route.fulfill({status:401,body:'{}'});const now=Date.now();body=state.queueEmpty?[]:[{queue_position:0,skill_id:3300,finished_level:5,start_date:new Date(now-3600000).toISOString(),finish_date:new Date(now+3600000).toISOString()},{queue_position:1,skill_id:3327,finished_level:3}];}
    else if(/\/characters\/\d+\//.test(path))body={name:path.includes(String(IDS[0]))?names[0]:names[1],corporation_id:1000044,birthday:'2026-01-01T00:00:00Z',security_status:0};
    else throw new Error(`Unmapped ESI request ${path}`);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('https://login.eveonline.com/oauth/jwks',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({keys:[jwk]})}));
  if(options.data||options.connected||options.corrupt||options.settings)await page.addInitScript(({options,KEY,SETTINGS,IDS,tokens})=>{
    if(options.corrupt)localStorage.setItem(KEY,'{broken');
    else if(options.data)localStorage.setItem(KEY,JSON.stringify(options.data));
    if(options.connected||options.settings)localStorage.setItem(SETTINGS,JSON.stringify(options.settings||{pilots:['Fiofka','Decxus'],eveClientId:'test-client'}));
    if(options.connected)sessionStorage.setItem('eve-sessions',JSON.stringify(IDS.map((id,i)=>[id,{token:tokens[i],expires:Date.now()+1200000}])));
  },{options,KEY,SETTINGS,IDS,tokens:IDS.map(id=>token(id,options.operations?{scp:REQUESTED_SCOPES}:{}))});
  return {state,errors};
}
export async function openApp(page){await page.goto('/');await expect(page.locator('#sync-status')).toContainText('Last refresh');}
export async function tab(page,name){if(['journal','goals'].includes(name))await page.locator('nav details').evaluate(node=>node.open=true);await page.locator(`nav [data-tab="${name}"]`).click();await expect(page.locator(`#${name}`)).toBeVisible();}
export async function addEntry(page,{title='First expedition',body='We found a quiet wormhole.',pilot='Fiofka',category='Adventure',date='2026-10-30'}={}){
  await tab(page,'journal');const f=page.locator('#journal-form');await f.getByLabel('Entry title').fill(title);await f.getByLabel('Private notes').fill(body);await f.getByRole('combobox',{name:'Pilot',exact:true}).selectOption(pilot);await f.getByLabel('Date',{exact:true}).fill(date);await f.getByRole('combobox',{name:'Focus',exact:true}).selectOption(category);await f.getByRole('button',{name:'Save entry locally'}).click();await expect(page.locator('#entries')).toContainText(title);
}
export const data={version:1,goals:[{id:'goal-one',title:'Fly a cruiser',pilot:'Both pilots',done:false,due:'2026-12-01',category:'Ships'}],entries:[{id:'entry-one',title:'A first flight',body:'A careful journey home.',pilot:'Fiofka',date:'2026-10-29',category:'Milestone'},{id:'entry-two',title:'Wormhole discovery',body:'Decxus found a connection.',pilot:'Decxus',date:'2026-10-30',category:'Adventure'}]};
