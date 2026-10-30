import {expect} from '@playwright/test';
export const IDS=[2124810474,2124815118];
export const names=['Fiofka','Decxus'];
export const KEY='eve-flight-journal:v1';
export const API='https://api.example';
export const opaque='b'.repeat(43);
const NAMES={3300:'Gunnery',3327:'Spaceship Command',605:'Heron',1234:'Heron Blueprint',34:'Tritanium',9899:'Ocular Filter - Basic',30000142:'Jita',60003760:'Jita IV - Moon 4 - Caldari Navy Assembly Plant'};
const iso=hours=>new Date(Date.now()+hours*3600000).toISOString();
export function sharedRecord(id){
 return {characterId:id,name:names[IDS.indexOf(id)],skills:{total_sp:333000},queue:[{skill_id:3300,finished_level:5,queue_position:0,start_date:iso(-1),finish_date:iso(30)}],fetchedAt:iso(0)};
}
function privateRecord(id,state){
 const queue=state.queueEmpty?[]:state.queueEnding?[{queue_position:0,skill_id:3300,finished_level:5,start_date:iso(-1),finish_date:iso(3)}]:[{queue_position:1,skill_id:3327,finished_level:3},{queue_position:0,skill_id:3300,finished_level:5,start_date:iso(-1),finish_date:iso(30)}];
 const ok=value=>({permission:true,value,fetched:iso(0)});
 let operations={
  wallet:state.walletFail?{permission:true,error:'EVE authorization expired or permission was declined.'}:ok(12500000.25),
  ship:ok({ship_type_id:605,ship_name:'Our first explorer'}),
  location:ok({solar_system_id:30000142,station_id:60003760}),
  jobs:ok(state.noJobs?[]:[{job_id:1,blueprint_type_id:1234,product_type_id:605,runs:2,status:'active',end_date:iso(24)}]),
  journal:ok([{id:2,date:iso(-1),ref_type:'bounty_prizes',amount:1500000,balance:12500000.25,description:'Bounty prizes in Jita'},{id:1,date:iso(-2),ref_type:'market_transaction',amount:-5500,balance:11000000.25}]),
  transactions:ok([{transaction_id:1,date:iso(-2),type_id:34,quantity:1000,unit_price:5.5,is_buy:true,location_id:60003760}]),
  attributes:ok({intelligence:20,memory:21,perception:22,willpower:23,charisma:19,bonus_remaps:2}),
  implants:ok([9899]),
  clones:ok({home_location:{location_id:60003760,location_type:'station'},jump_clones:[{jump_clone_id:1,location_id:1035466617946,location_type:'structure',implants:[9899],name:'Staging'}],last_clone_jump_date:iso(-2)})
 };
 if(state.trainingOnly)operations=Object.fromEntries(Object.keys(operations).map(k=>[k,{permission:false}]));
 if(state.oldSnapshot)for(const k of ['journal','transactions','attributes','implants','clones'])delete operations[k];
 return {characterId:id,name:names[IDS.indexOf(id)],expires:Date.now()+3600000,fetchedAt:iso(0),queue,operations,
  skills:{total_sp:125000,unallocated_sp:5000,skills:[{skill_id:3300,trained_skill_level:4,active_skill_level:3,skillpoints_in_skill:90510},{skill_id:3327,trained_skill_level:2,active_skill_level:2,skillpoints_in_skill:1415}]}};
}
// Every test runs against a mocked backend; the browser itself must never call private ESI endpoints.
export async function mockApp(page,options={}) {
 const state={fail:false,missing:false,...options};
 const errors=[],calls=[],privateEsi=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/config.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({title:'EVE Pilot Console',pilots:names,backendUrl:API})}));
 await page.route('https://images.evetech.net/**',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#284736"/></svg>'}));
 await page.route('https://esi.evetech.net/**',async route=>{
  if(state.fail)return route.fulfill({status:503,body:'{}'});
  const path=new URL(route.request().url()).pathname;
  let body;
  if(path.includes('/status/'))body={players:25432,server_version:'test',start_time:'2026-10-30T11:00:00Z'};
  else if(path.includes('/corporationhistory/'))body=[{corporation_id:1000044,start_date:'2026-01-01T00:00:00Z',record_id:1}];
  else if(path.includes('/universe/ids/'))body={characters:state.missing?[]:IDS.map((id,i)=>({id,name:names[i]}))};
  else if(path.includes('/universe/names/'))body=JSON.parse(route.request().postData()).map(id=>({id,name:NAMES[id]||`Type ${id}`}));
  else if(path.includes('/universe/categories/16/'))body={groups:[255,257]};
  else if(path.includes('/universe/groups/'))body=path.includes('/255/')?{name:'Gunnery',types:[3300],published:true}:{name:'Spaceship Command',types:[3327],published:true};
  else if(path.includes('/corporations/'))body={name:'Test Flight Academy',ticker:'TFA',member_count:120,tax_rate:0.1};
  else if(/\/characters\/\d+\/$/.test(path))body={name:path.includes(String(IDS[0]))?names[0]:names[1],corporation_id:1000044,birthday:'2026-01-01T00:00:00Z',security_status:0.5};
  else {privateEsi.push(path);return route.fulfill({status:404,body:'{}'});}
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.route(`${API}/**`,async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method(),authorization:req.headers().authorization});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization','access-control-allow-methods':'GET,POST,OPTIONS'}});
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  if(path==='/api/public/pilots')return json({pilots:state.unshared?[]:IDS.map(sharedRecord)});
  if(path==='/api/session'||path==='/api/sync'){
   if(state.expired)return json({error:'Backend session expired.'},401);
   const id=IDS.find(id=>req.headers().authorization===`Bearer ${opaque.slice(0,42)}${IDS.indexOf(id)}`);
   return json(privateRecord(id,state));
  }
  if(path==='/api/disconnect')return json({disconnected:true});
  if(path==='/auth/start')return route.fulfill({status:200,body:'EVE backend consent screen'});
  throw new Error(`Unexpected backend route ${path}`);
 });
 if(options.data||options.corrupt||options.connected)await page.addInitScript(({options,KEY,IDS,API,opaque})=>{
  if(options.corrupt)localStorage.setItem(KEY,'{broken');
  else if(options.data)localStorage.setItem(KEY,JSON.stringify(options.data));
  if(options.connected){const ids=options.connected==='first'?IDS.slice(0,1):IDS;sessionStorage.setItem(`eve-backend-sessions:${API}`,JSON.stringify(ids.map(id=>[id,{token:`${opaque.slice(0,42)}${IDS.indexOf(id)}`,expires:Date.now()+1200000}])));}
 },{options,KEY,IDS,API,opaque});
 return {state,errors,calls,privateEsi};
}
export async function openApp(page){await page.goto('/');await expect(page.locator('#sync-status')).toContainText('Last refresh');}
export async function tab(page,name){const id=['journal','goals'].includes(name)?'notes':name;await page.locator(`nav [data-tab="${id}"]`).click();await expect(page.locator(`#${id}`)).toBeVisible();}
export async function addEntry(page,{title='First expedition',body='We found a quiet wormhole.',pilot='Fiofka',category='Adventure',date='2026-10-30'}={}){
 await tab(page,'journal');const f=page.locator('#journal-form');await f.getByLabel('Entry title').fill(title);await f.getByLabel('Private notes').fill(body);await f.getByRole('combobox',{name:'Pilot',exact:true}).selectOption(pilot);await f.getByLabel('Date',{exact:true}).fill(date);await f.getByRole('combobox',{name:'Focus',exact:true}).selectOption(category);await f.getByRole('button',{name:'Save entry locally'}).click();await expect(page.locator('#entries')).toContainText(title);
}
export const data={version:1,goals:[{id:'goal-one',title:'Fly a cruiser',pilot:'Both pilots',done:false,due:'2026-12-01',category:'Ships'}],entries:[{id:'entry-one',title:'A first flight',body:'A careful journey home.',pilot:'Fiofka',date:'2026-10-29',category:'Milestone'},{id:'entry-two',title:'Wormhole discovery',body:'Decxus found a connection.',pilot:'Decxus',date:'2026-10-30',category:'Adventure'}]};
