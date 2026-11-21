import {expect} from '@playwright/test';
export const IDS=[2124810474,2124815118];
export const names=['Fiofka','Decxus'];
export const KEY='eve-flight-journal:v1';
export const API='https://api.example';
export const opaque='b'.repeat(43);
const NAMES={2268:'Aqueous Liquids',2456:'Hobgoblin I Blueprint',691:'Rifter Blueprint',60008494:'Amarr VIII (Oris) - Emperor Family Academy',500001:'Caldari State',3300:'Gunnery',3327:'Spaceship Command',3380:'Industry',605:'Heron',1234:'Heron Blueprint',34:'Tritanium',35:'Pyerite',587:'Rifter',9899:'Ocular Filter - Basic',30000142:'Jita',30002187:'Amarr',60003760:'Jita IV - Moon 4 - Caldari Navy Assembly Plant',30002813:'Tama',1000044:'Test Flight Academy',2124810474:'Fiofka',2124815118:'Decxus',
 5001:'Overdrive Injector System II',5002:'5MN Quad LiF Restrained Microwarpdrive',5003:'Medium Shield Extender I',5004:'Gas Cloud Scoop I',5005:'Core Probe Launcher I',5006:'Small Polycarbon Engine Housing II',5007:'Hobgoblin I',5008:'Nanite Repair Paste',16236:'Coercer',60008494:'Amarr VIII (Oris) - Emperor Family Academy'};
export const JITA=60003760,AMARR=60008494;
// type -> [group, category]; groups 255/257/268 are skill groups.
const TYPES={34:[18,4],35:[18,4],605:[25,6],587:[25,6],16236:[25,6],9899:[300,20],5001:[700,7],5002:[700,7],5003:[700,7],5004:[700,7],5005:[700,7],5006:[700,7],5007:[702,18],5008:[701,8]};
const GROUPS={700:{name:'Module',category_id:7},701:{name:'Hybrid Charge',category_id:8},702:{name:'Combat Drone',category_id:18},18:{name:'Mineral',category_id:4},25:{name:'Frigate',category_id:6},300:{name:'Cyber Learning',category_id:20},255:{name:'Gunnery',types:[3300],published:true},257:{name:'Spaceship Command',types:[3327],published:true},268:{name:'Production',types:[3380],published:true}};
const CATEGORIES={4:'Material',6:'Ship',7:'Module',8:'Charge',18:'Drone',20:'Implant'};
// Packaged volumes (m3 per unit) of the sell planner's stacks; every other type has none and falls back to volume.
const PACKAGED={34:0.01,35:0.01,587:2500,9899:0.1,1230:0.1,16236:5000};
// Buy orders per "region:type" for the sell planner. Tritanium: Jita 4.6 at the station, a ranged 4.8 order in Perimeter that
// a ship docked in Jita can fill, and Amarr 7 three jumps away. Pyerite is thin in Jita (150 units) and 11 in Amarr.
const buy=(order_id,type_id,location_id,system_id,price,volume_remain,range='station',min_volume=1)=>({order_id,type_id,location_id,system_id,price,volume_remain,volume_total:volume_remain,min_volume,range,is_buy_order:true,issued:new Date().toISOString(),duration:90});
const BUY_ORDERS={'10000002:34':[buy(9001,34,JITA,30000142,4.6,1e6),buy(9002,34,60000001,30000144,4.8,2e5,'1')],'10000002:35':[buy(9003,35,JITA,30000142,9,150)],'10000002:587':[buy(9004,587,JITA,30000142,300000,20)],
 '10000043:34':[buy(9005,34,AMARR,30002187,7,1e5)],'10000043:35':[buy(9006,35,AMARR,30002187,11,1e6)]};
const PRICES=[[34,5,4],[35,10,9],[605,20000000,18000000],[587,400000,380000],[9899,1000000,900000]];
// Jita - Perimeter - Niarja - Amarr in high-sec, with low-sec Tama hanging off Perimeter.
const UNIVERSE={systems:{30000142:['Jita',0.946,10000002,[30000144],0,[0,0,0],[0,0],20000020],30000144:['Perimeter',0.95,10000002,[30000142,30003504,30002813],4,[1,0,1],[4,0],20000020],30003504:['Niarja',0.5,10000043,[30000144,30002187],3,[3,1,4],[8,4],20000322],30002187:['Amarr',1,10000043,[30003504],0,[5,1,7],[12,6],20000322],30002813:['Tama',0.3,10000002,[30000144],5,[2,-1,-2],[4,-5],20000021]},regions:{10000002:'The Forge',10000043:'Domain'},constellations:{20000020:['Kimotoro',10000002],20000021:['Okkamon',10000002],20000322:['Throne Worlds',10000043]},
 stations:[[60003760,30000142,3,'Jita IV - Moon 4 - Caldari Navy Assembly Plant'],[60000001,30000144,2,'Perimeter II - Moon 1 - Lab'],[60000002,30003504,1,'Niarja III - Factory'],[60000003,30002813,3,'Tama VII - Cheap Factory']]};
export const MARKET={universe:UNIVERSE,meta:{region:0,updatedAt:Date.now()-600000,data:{generatedAt:new Date().toISOString(),skills:{accounting:16622,brokerRelations:3446,industry:3380,massProduction:3387,science:3402,labOperation:3406,metallurgy:3409,advancedIndustry:3388,astrometrics:3412,hacking:21718,archaeology:13278,gallenteFrigate:3328,caldariFrigate:3330},traffic:{at:Date.now(),since:Date.now()-2*86400000,s:{30000142:50000,30000144:20000,30003504:300,30002187:40000,30002813:900}},skillNames:{3327:'Spaceship Command'},combat:{sb:[15000],dictor:[]},risk:{at:Date.now(),since:Date.now()-3*86400000,s:{30003504:[12,40]}},ores:[{n:'Veldspar',ore:1230,comp:62516,vol:0.1,portion:100,m:[[34,400]],grades:{1230:0,17470:0.05}},{n:'Pyroxeres',ore:1224,comp:62524,vol:0.3,portion:100,m:[[35,90],[36,30]],grades:{1224:0}},{n:'Kernite',ore:20,comp:62536,vol:1.2,portion:100,m:[[36,60],[37,120]],grades:{20:0}}],activity:{30003504:[3,10,120],30000144:[0,0,1500]},bpoSurvey:{regions:3,of:4,names:{[JITA]:'Jita IV - Moon 4 - Caldari Navy Assembly Plant',[AMARR]:'Amarr VIII (Oris) - Emperor Family Academy'}},starters:[{type:2454,bp:2456,n:'Hobgoblin I',cat:'Drone',q:1,t:300,rank:1,limit:300,price:250000,m:[[34,1000]],sellers:[[JITA,30000142,250000]]},{type:587,bp:691,n:'Rifter',cat:'Frigate',q:1,t:6000,rank:20,limit:30,price:2800000,m:[[34,30000],[35,6000]],sk:[[3327,3]],sellers:[[AMARR,30002187,2800000]]}],types:{34:{n:'Tritanium',v:0.01},35:{n:'Pyerite',v:0.01},587:{n:'Rifter',v:2500}},recipes:{587:{bp:691,q:1,m:[[34,30000],[35,6000]]}},regions:{10000002:'The Forge',10000043:'Domain'}}},
 regions:[{region:10000002,updatedAt:Date.now()-600000,data:{name:'The Forge',stations:{[JITA]:[30000142,'Jita IV - Moon 4 - Caldari Navy Assembly Plant']},types:{34:{d:5e6,s:[[JITA,5,1e6]],b:[[JITA,4.6,1e6]]},35:{d:1e6,s:[[JITA,10,1e6]],b:[]},587:{d:40,s:[[JITA,400000,30]],b:[[JITA,300000,20]]},2454:{d:2000,p:8000,s:[[JITA,10000,500]],b:[[JITA,8000,100]]},2456:{d:3,s:[[JITA,250000,10]],b:[]},1230:{d:1e6,s:[[JITA,22,1e6]],b:[[JITA,20,1e6]]},62516:{d:1e6,s:[[JITA,24,1e6]],b:[[JITA,21,1e6]]},1224:{d:1e5,s:[[JITA,90,1e5]],b:[[JITA,80,1e5]]},20:{d:1e4,s:[[JITA,600,1e4]],b:[[JITA,500,1e4]]},36:{d:1e6,s:[[JITA,60,1e6]],b:[[JITA,55,1e6]]},37:{d:1e6,s:[[JITA,30,1e6]],b:[[JITA,28,1e6]]}}}},
  {region:10000043,updatedAt:Date.now()-600000,data:{name:'Domain',stations:{[AMARR]:[30002187,'Amarr VIII (Oris) - Emperor Family Academy']},types:{34:{d:2e6,s:[[AMARR,6,1e5]],b:[[AMARR,7,1e5]]},691:{d:1,s:[[AMARR,2800000,5]],b:[]}}}}]};
// A ?v=2 client gets the market without the static universe document, which the response names by version; an older
// Worker (state.legacyMarket) ignores v=2 and sends everything inline, as MARKET.
const STATIC_KEYS=['ores','combat','skills'];
export const universeDoc=version=>({version,universe:UNIVERSE,meta:Object.fromEntries(STATIC_KEYS.map(k=>[k,MARKET.meta.data[k]]))});
const splitMarket=version=>({...MARKET,universe:null,universeVersion:version,meta:{...MARKET.meta,data:Object.fromEntries(Object.entries(MARKET.meta.data).filter(([k])=>!STATIC_KEYS.includes(k)))}});
const iso=hours=>new Date(Date.now()+hours*3600000).toISOString();
export function sharedRecord(id){
 return {characterId:id,name:names[IDS.indexOf(id)],skills:{total_sp:333000},queue:[{skill_id:3300,finished_level:5,queue_position:0,start_date:iso(-1),finish_date:iso(30)}],fetchedAt:iso(0)};
}
function privateRecord(id,state){
 const queue=state.queueEmpty?[]:state.queueEnding?[{queue_position:0,skill_id:3300,finished_level:5,start_date:iso(-1),finish_date:iso(3)}]:[{queue_position:1,skill_id:3327,finished_level:3},{queue_position:0,skill_id:3300,finished_level:5,start_date:iso(-1),finish_date:iso(30)}];
 const ok=value=>({permission:true,value,fetched:iso(0)});
 let operations={
  wallet:state.walletFail?{permission:true,error:'EVE authorization expired or permission was declined.'}:ok(12500000.25),
  // state.coercer: both pilots fly an Amarr destroyer, the sell planner's typical case (375 m3 of cargo).
  ship:ok(state.coercer?{ship_type_id:16236,ship_name:id===IDS[0]?'Hauler one':'Hauler two',ship_item_id:id===IDS[0]?1001:2002}:{ship_type_id:605,ship_name:'Our first explorer',ship_item_id:1001}),
  trail:ok([[30000144,Date.now()-2*3600000],[30000142,Date.now()-600000]]),
  mining:ok([{date:iso(-48).slice(0,10),solar_system_id:30000144,type_id:1230,quantity:20000},{date:iso(-24).slice(0,10),solar_system_id:30000144,type_id:17470,quantity:5000}]),
  location:ok(state.undocked&&id===IDS[1]?{solar_system_id:30000144}:{solar_system_id:30000142,station_id:60003760}),
  jobs:ok(state.noJobs?[]:[{job_id:1,activity_id:1,blueprint_type_id:1234,product_type_id:605,runs:2,status:'active',start_date:iso(-24),end_date:iso(24),station_id:60003760,cost:125000},{job_id:2,activity_id:5,blueprint_type_id:1234,product_type_id:1234,runs:4,licensed_runs:300,status:'active',start_date:iso(-48),end_date:iso(-0.1),station_id:60003760}]),
  journal:ok([{id:2,date:iso(-1),ref_type:'bounty_prizes',amount:1500000,balance:12500000.25,description:'Bounty prizes in Jita'},{id:1,date:iso(-2),ref_type:'market_transaction',amount:-5500,balance:11000000.25}]),
  transactions:ok([{transaction_id:1,date:iso(-2),type_id:34,quantity:1000,unit_price:5.5,is_buy:true,location_id:60003760}]),
  attributes:ok({intelligence:20,memory:21,perception:22,willpower:23,charisma:19,bonus_remaps:2}),
  assets:ok({items:3,locations:1,truncated:false,types:[[34,1000],[605,1],[9899,1]]}),
  implants:ok([9899]),
  // Packaged stacks in the hangar of the station the pilot is docked at (location above), and at state.sellStation when one is chosen.
  stacks:ok({[JITA]:id===IDS[0]?[[34,50000],[35,12000],[587,3],[9899,2]]:[[34,8000],[1230,30000]],...(state.sellStation?{[state.sellStation]:[[35,400]]}:{})}),
  // The current fit of the Heron above: item 1001's own items by slot flag (a charge shares its launcher's flag).
  fit:ok({ship:state.staleFit?999:state.coercer&&id===IDS[1]?2002:1001,items:[...(state.coercer?[id===IDS[0]?[34,'Cargo',1000]:[35,'Cargo',100]]:[]),[5004,'HiSlot0',1],[5004,'HiSlot1',1],[5005,'HiSlot2',1],[5008,'HiSlot2',30],[5002,'MedSlot0',1],[5003,'MedSlot1',1],[5001,'LoSlot0',1],[5006,'RigSlot0',1],[5006,'RigSlot1',1],[5007,'DroneBay',2]]}),
  orders:ok(state.noOrders?[]:[
   {order_id:1,type_id:34,location_id:60003760,region_id:10000002,is_buy_order:false,price:6,volume_remain:400,volume_total:1000,issued:iso(-48),duration:90},
   {order_id:2,type_id:35,location_id:60003760,region_id:10000002,is_buy_order:false,price:10,volume_remain:50,volume_total:50,issued:iso(-24),duration:30},
   {order_id:3,type_id:587,location_id:60003760,region_id:10000002,is_buy_order:true,price:300000,volume_remain:5,volume_total:5,issued:iso(-72),duration:90,escrow:1500000},
   {order_id:4,type_id:34,location_id:60008494,region_id:10000043,is_buy_order:true,price:6,volume_remain:1000,volume_total:1000,issued:iso(-10),duration:14},
   {order_id:5,type_id:34,location_id:60005686,region_id:10000030,is_buy_order:false,price:7,volume_remain:10,volume_total:10,issued:iso(-5),duration:90}]),
  orderHistory:ok([{order_id:11,type_id:35,location_id:60003760,region_id:10000002,is_buy_order:false,price:9,volume_remain:0,volume_total:10,issued:iso(-120),duration:30},{order_id:12,type_id:587,location_id:60003760,region_id:10000002,is_buy_order:true,price:250000,volume_remain:3,volume_total:5,issued:iso(-240),duration:7,state:'expired'}]),
  contracts:ok([
   {contract_id:7001,type:'courier',status:'outstanding',availability:'public',issuer_id:IDS[0],assignee_id:0,date_issued:iso(-30),date_expired:iso(10),title:'Haul to Amarr',reward:2000000,collateral:50000000,volume:5000,days_to_complete:3,start_location_id:JITA,end_location_id:AMARR},
   {contract_id:7002,type:'item_exchange',status:'outstanding',availability:'personal',issuer_id:IDS[0],assignee_id:IDS[1],date_issued:iso(-24),date_expired:iso(120),price:25000000},
   {contract_id:7003,type:'courier',status:'in_progress',availability:'public',issuer_id:IDS[1],assignee_id:IDS[0],acceptor_id:IDS[0],date_issued:iso(-48),date_accepted:iso(-24),date_expired:iso(200),reward:900000,collateral:10000000,volume:900,days_to_complete:3,start_location_id:AMARR,end_location_id:JITA},
   {contract_id:7004,type:'item_exchange',status:'finished',availability:'public',issuer_id:IDS[1],acceptor_id:IDS[0],date_issued:iso(-96),date_expired:iso(-24),date_completed:iso(-48),price:1000000}]),
  killmails:ok({losses:!state.losses?[]:[{id:555,hash:'abc555',time:iso(-30),ship:587,system:30002813,attackers:3,corp:1000044,damage:1200},{id:554,hash:'abc554',time:iso(-24*9),ship:605,system:30000142,attackers:1,damage:300}],seen:[1],wait:[]}),
  // Blueprints as the Worker keeps them: [type, originals, copies, ME, TE, runs on copies, location]. ownsStarters adds a Hobgoblin original and a Rifter copy.
  blueprints:ok({count:3,types:[[1234,1,0,2,4,0,JITA],...(state.ownsStarters?[[2456,1,0,8,12,0,JITA],[691,0,2,4,6,5,AMARR]]:[])]}),
  planets:ok({pending:false,planets:[
   {id:40000001,type:'lava',system:30000142,level:3,num:9,updated:iso(-30),pins:{ext:[[2268,iso(-5),2,600,1800],[2268,iso(10),1,300,1800]],fac:[121],store:[[2268,300]],links:4,cap:12000,vault:[[2268,300]]}},
   {id:40000002,type:'barren',system:30000144,level:5,num:14,updated:iso(-2),pins:{ext:[[2268,iso(72),3,900,3600]],fac:[],store:[],links:6}}]}),
  standings:ok([[500001,'faction',5],[1000035,'npc_corp',4],[3009,'agent',2]]),
  clones:ok({home_location:{location_id:60003760,location_type:'station'},jump_clones:[{jump_clone_id:1,location_id:1035466617946,location_type:'structure',implants:[9899],name:'Staging'}],last_clone_jump_date:iso(-2)})
 };
 // A pilot who has not reconnected since the order, contract and loss scopes were added.
 if(state.oldScopes)for(const k of ['orders','orderHistory','contracts','killmails','blueprints','planets','standings'])operations[k]={permission:false};
 if(state.trainingOnly)operations=Object.fromEntries(Object.keys(operations).map(k=>[k,{permission:false}]));
 if(state.oldSnapshot)for(const k of ['journal','transactions','attributes','implants','clones'])delete operations[k];
 return {characterId:id,name:names[IDS.indexOf(id)],expires:Date.now()+600000,fetchedAt:iso(0),queue,operations,...(state.sellStation?{sellStation:state.sellStation}:{}),
  skills:{total_sp:125000,unallocated_sp:5000,skills:[{skill_id:3300,trained_skill_level:4,active_skill_level:3,skillpoints_in_skill:90510},{skill_id:3327,trained_skill_level:2,active_skill_level:2,skillpoints_in_skill:1415}]}};
}
// What the wingmate endpoint returns: Decxus is an industrialist with more ISK.
function wingRecord(id,state){
 if(id===IDS[0]){const r=privateRecord(id,state);return {characterId:id,name:'Fiofka',sharing:true,fetchedAt:r.fetchedAt,skills:r.skills,wallet:r.operations.wallet?.value??null,assets:r.operations.assets?.value||null};}
 // wingLevel 1 is the oldest consent: skills, wallet and assets only. Level 2 adds ship, jobs and mining; level 3 (the default here) the fit, blueprints and planets.
 const level=state?.wingLevel??3,r={characterId:id,name:'Decxus',sharing:true,shareLevel:level,lastError:state?.wingError||null,fetchedAt:iso(0),wallet:40000000,jobs:[{job_id:7,activity_id:4,blueprint_type_id:1234,runs:3,status:'active',start_date:iso(-2),end_date:iso(6),station_id:60003760}],assets:{items:2,locations:1,types:[[587,10],[34,500000]]},ship:state?.coercer?{ship_type_id:16236,ship_name:'Hauler two',ship_item_id:2002}:{ship_type_id:587,ship_name:'Rifter rush',ship_item_id:2002},...(state?.coercer?{location:{solar_system_id:30000142,station_id:JITA}}:{}),stacks:{[JITA]:[[34,8000],[1230,30000]]},fit:{ship:2002,items:[[5001,'LoSlot0',1],[5007,'DroneBay',5],...(state?.coercer?[[35,'Cargo',100]]:[])]},skills:{total_sp:2000000,unallocated_sp:0,skills:[{skill_id:3380,trained_skill_level:5,active_skill_level:5,skillpoints_in_skill:1500000},{skill_id:3327,trained_skill_level:5,active_skill_level:5,skillpoints_in_skill:500000}]}}
 r.blueprints={count:1,types:state?.ownsStarters?[[691,1,0,6,10,0,AMARR]]:[[1234,1,0,6,10,0,AMARR]]};
 r.planets={pending:false,planets:[{id:40000003,type:'storm',system:30002187,level:4,num:7,updated:iso(-6),pins:{ext:[[2268,iso(20),2,450,1800]],fac:[],store:[],links:2}}]};
 if(level<3){delete r.fit;delete r.stacks;delete r.blueprints;delete r.planets;}
 if(level<2){delete r.jobs;delete r.ship;delete r.location;}
 return r;
}
// The mocked sessions: `opaque` with the pilot's index as its last character, or `reconnected` after a Reconnect.
export const reconnected='c'.repeat(43);
const pilotOf=auth=>IDS.find((id,i)=>[opaque,reconnected].some(t=>auth===`Bearer ${t.slice(0,42)}${i}`));
// Every test runs against a mocked backend; the browser itself must never call private ESI endpoints.
export async function mockApp(page,options={}) {
 const state={fail:false,missing:false,...options};
 const errors=[],calls=[],privateEsi=[];page.on('pageerror',e=>errors.push(e.message));
 // The page's CSP allows the deployed Worker (*.workers.dev); let it reach the mocked backend too, and fail on any other violation.
 await page.route(url=>url.hostname==='127.0.0.1'&&/^\/(index\.html)?$/.test(url.pathname),async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text()).replace('https://*.workers.dev','https://*.workers.dev '+API)});
 });
 await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>setTimeout(()=>{throw new Error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`);})));
 await page.route('**/config.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({title:'EVE Pilot Console',pilots:names,backendUrl:API})}));
 await page.route('https://images.evetech.net/**',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#284736"/></svg>'}));
 await page.route('https://esi.evetech.net/**',async route=>{
  if(state.fail)return route.fulfill({status:503,body:'{}'});
  const path=new URL(route.request().url()).pathname;
  let body;
  if(path.includes('/status/'))body={players:25432,server_version:'test',start_time:'2026-10-30T11:00:00Z'};
  else if(path.includes('/corporationhistory/'))body=[{corporation_id:1000044,start_date:'2026-01-01T00:00:00Z',record_id:1}];
  else if(path.includes('/universe/ids/')){const asked=JSON.parse(route.request().postData()||'[]'),types=asked.map(n=>Object.entries(NAMES).find(([,v])=>v.toLowerCase()===String(n).toLowerCase())).filter(Boolean).map(([id,name])=>({id:Number(id),name}));body={characters:state.missing?[]:IDS.map((id,i)=>({id,name:names[i]})),...(types.length?{inventory_types:types}:{})};}
  else if(/\/markets\/\d+\/orders\//.test(path)){const q=new URL(route.request().url()).searchParams,region=path.match(/markets\/(\d+)/)[1];(state.orderCalls||=[]).push(`${region}:${q.get('type_id')}:${q.get('order_type')}:${q.get('page')}`);return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-expose-headers':'x-pages,expires','x-pages':'1',expires:new Date(Date.now()+300000).toUTCString()},body:JSON.stringify(state.noOrderBooks?[]:BUY_ORDERS[`${region}:${q.get('type_id')}`]||[])});}
  else if(path.includes('/universe/names/'))body=JSON.parse(route.request().postData()).map(id=>({id,name:NAMES[id]||`Type ${id}`}));
  else if(/\/universe\/categories\/16\/$/.test(path))body={groups:[255,257,268]};
  else if(path.includes('/universe/categories/'))body={name:CATEGORIES[path.match(/(\d+)\/$/)[1]]};
  else if(path.includes('/universe/groups/'))body=GROUPS[path.match(/(\d+)\/$/)[1]];
  else if(path.includes('/universe/types/')){const id=Number(path.match(/(\d+)\/$/)[1]);body={type_id:id,name:NAMES[id],group_id:(TYPES[id]||[1])[0],capacity:id===605?400:id===16236?375:0,volume:id===2268?0.5:1,...(PACKAGED[id]?{packaged_volume:PACKAGED[id]}:{})};}
  else if(path.includes('/markets/prices/'))body=PRICES.map(([type_id,average_price,adjusted_price])=>({type_id,average_price,adjusted_price}));
  else if(path.includes('/industry/systems/'))body=[[30000142,0.05,0.04],[30000144,0.02,0.01],[30003504,0.01,0.03],[30002813,0.001,0.001],[30002187,0.03,0.03]].map(([solar_system_id,m,r])=>({solar_system_id,cost_indices:[{activity:'manufacturing',cost_index:m},{activity:'researching_material_efficiency',cost_index:r}]}));
  else if(path.includes('/route/')){const [a,b]=path.match(/route\/(\d+)\/(\d+)/).slice(1);body=a===b?[Number(a)]:Array.from({length:10},(_,i)=>i);}
  else if(path.includes('/universe/system_kills/'))body=[{system_id:30003504,ship_kills:3,pod_kills:1,npc_kills:0},{system_id:30002813,ship_kills:7,pod_kills:2,npc_kills:40}];
  else if(path.includes('/universe/system_jumps/'))body=[{system_id:30000142,ship_jumps:2400},{system_id:30000144,ship_jumps:1500}];
  else if(path.includes('/sovereignty/map/'))body=[{system_id:30000142,faction_id:500001},{system_id:30002813,faction_id:500001}];
  else if(path.includes('/fw/systems/'))body=[{solar_system_id:30002813,occupier_faction_id:500001,owner_faction_id:500001,contested:'contested',victory_points:300,victory_points_threshold:3000}];
  else if(path.includes('/incursions/'))body=[{state:'mobilizing',influence:0.4,infested_solar_systems:[30002187],staging_solar_system_id:30002187,constellation_id:20000322,faction_id:500019,has_boss:true,type:'Incursion'}];
  else if(path.includes('/universe/stargates/'))body={destination:{system_id:{50000010:30000144,50000011:30002187}[path.match(/(\d+)\/$/)[1]]||30000142}};
  else if(/\/universe\/stations\/\d+\/$/.test(path)){const id=Number(path.match(/(\d+)\/$/)[1]);if(state.noStationOwners)return route.fulfill({status:404,body:'{}'});body={station_id:id,name:NAMES[id],owner:id===JITA?1000035:1000084};}
  else if(/\/corporations\/100003[5]\/$/.test(path))body={name:'Caldari Navy',ticker:'CN',member_count:0,faction_id:500001};
  else if(/\/corporations\/1000084\/$/.test(path))body={name:'Emperor Family',ticker:'EF',member_count:0};
  else if(path.includes('/corporations/'))body={name:'Test Flight Academy',ticker:'TFA',member_count:120,tax_rate:0.1};
  else if(/\/characters\/\d+\/$/.test(path))body={name:path.includes(String(IDS[0]))?names[0]:names[1],corporation_id:1000044,birthday:'2026-01-01T00:00:00Z',security_status:0.5};
  else {privateEsi.push(path);return route.fulfill({status:404,body:'{}'});}
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.route('https://zkillboard.com/**',route=>{
  const region=Number(route.request().url().match(/regionID\/(\d+)/)?.[1]),t=m=>new Date(Date.now()-m*60000).toISOString();
  const kills=region===10000043?[1,2,3].map(i=>({killmail_id:i,killmail_time:t(i*4),solar_system_id:30003504,victim:{ship_type_id:648},attackers:[{ship_type_id:587,weapon_type_id:15000}],zkb:{locationID:50000010,npc:false,totalValue:2e8}})).concat([{killmail_id:9,killmail_time:t(5),solar_system_id:30003504,victim:{ship_type_id:648},attackers:[{ship_type_id:587}],zkb:{locationID:40000001,npc:true}}]):[];
  return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(kills)});
 });
 await page.route('https://api.eve-scout.com/**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify([
  {signature_type:'wormhole',out_system_name:'Thera',out_system_id:31000005,in_system_id:30003504,in_system_class:'hs',max_ship_size:'large',remaining_hours:14,wh_type:'Q063',in_signature:'XYZ-123'},
  {signature_type:'wormhole',out_system_name:'Turnur',out_system_id:30002086,in_system_id:31000537,in_system_class:'c2'}])}));
 await page.route(`${API}/**`,async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method(),authorization:req.headers().authorization});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization','access-control-allow-methods':'GET,POST,OPTIONS'}});
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  if(path==='/api/public/pilots')return json({pilots:state.unshared?[]:IDS.map(sharedRecord)});
  if(path==='/api/session'||path==='/api/sync'){
   if(state.expired)return json({error:'Backend session expired.'},401);
   const id=pilotOf(req.headers().authorization);
   return json(privateRecord(id,state));
  }
  if(path==='/api/disconnect')return json({disconnected:true});
  if(path==='/api/forget'){state.forgotten=(state.forgotten||0)+1;return json({forgotten:true,revoked:true,goals:false});}
  if(path==='/api/session/revoke')return json({revoked:true});
  if(path==='/api/wing'){if(state.expired)return json({error:'Backend session expired.'},401);return json({pilots:IDS.map(id=>wingRecord(id,state)).filter(r=>r.characterId===IDS[0]||!state.wingPrivate).map(r=>r.characterId===IDS[1]&&state.wingPrivate?{...r,sharing:false}:r)});}
  if(path==='/api/market/universe')return json(universeDoc(state.universeVersion||'u1'));
  if(path==='/api/market')return state.noMarket?json({meta:null,regions:[]}):json(new URL(req.url()).searchParams.get('v')==='2'&&!state.legacyMarket?splitMarket(state.universeVersion||'u1'):MARKET);
  if(path==='/api/contract-items'){
   const cid=Number(new URL(req.url()).searchParams.get('id'));
   if(!pilotOf(req.headers().authorization))return json({error:'Connect this pilot.'},401);
   state.contractItemCalls=(state.contractItemCalls||[]).concat(cid);
   if(state.contractItemsFail)return json({error:'EVE service is temporarily unavailable.'},502);
   return cid===7002?json({contractId:cid,items:[{type_id:34,quantity:1000,is_included:true},{type_id:35,quantity:5,is_included:false}]}):cid===7004?json({contractId:cid,items:[{type_id:605,quantity:1,is_included:true}]}):cid===7001||cid===7003?json({contractId:cid,items:[]}):json({error:'That contract is not one of yours.'},404);
  }
  if(path==='/api/sell-station'){if(!pilotOf(req.headers().authorization))return json({error:'Connect this pilot.'},401);const {station}=JSON.parse(req.postData());state.sellStation=station;state.sellStationPosts=(state.sellStationPosts||[]).concat([station]);return json({sellStation:station});}
  if(path==='/api/waypoints'){state.waypoints=JSON.parse(req.postData()).systems;return json({waypoints:state.waypoints.length});}
  if(path==='/api/journal'){
   // A small stand-in for the Worker's journal: one rev counter, goals for the wing, entries and prefs for their pilot
   // (prefs only for clients that ask, and only under the writer's own id).
   const j=state.journal||(state.journal={rows:new Map(),rev:0,posts:[]});
   const who=pilotOf(req.headers().authorization);
   if(!who)return json({error:'Connect this pilot.'},401);
   const out=r=>({kind:r.kind,id:r.id,rev:r.rev,record:r.record});
   if(req.method()==='GET'){const q=new URL(req.url()).searchParams,since=Number(q.get('since'))||0;return json({rev:j.rev,more:false,records:[...j.rows.values()].filter(r=>r.rev>since&&(r.owner===0||r.owner===who)&&(r.kind!=='pref'||q.get('prefs')==='1')).sort((a,b)=>a.rev-b.rev).map(out)});}
   const {changes}=JSON.parse(req.postData());j.posts.push({who,changes});const applied=[],conflicts=[],denied=[];
   if(changes.some(c=>c.kind==='pref'&&(c.record===null||c.id!==`${c.id.split(':')[0]}:${who}`)))return json({error:'A pilot can only set their own preferences.'},403);
   for(const c of changes){const k=`${c.kind}:${c.id}`,row=j.rows.get(k),owner=c.kind==='goal'?0:who;
    if(row&&row.owner!==owner){denied.push({kind:c.kind,id:c.id});continue;}
    if((row?.rev||0)!==c.base){conflicts.push(out(row));continue;}
    if(!row&&c.record===null){applied.push({kind:c.kind,id:c.id,rev:0});continue;}
    j.rows.set(k,{kind:c.kind,id:c.id,owner,record:c.record,rev:++j.rev});applied.push({kind:c.kind,id:c.id,rev:j.rev});}
   return json({applied,conflicts,denied});
  }
  if(path==='/auth/start')return route.fulfill({status:200,body:'EVE backend consent screen'});
  throw new Error(`Unexpected backend route ${path}`);
 });
 await page.addInitScript(({options,KEY,IDS,API,opaque})=>{
  if(!options.fresh&&!sessionStorage.getItem('e2e-started')){localStorage.setItem('eve-me:v1',options.me||'Fiofka');sessionStorage.setItem('e2e-started','1');}
  if(options.corrupt)localStorage.setItem(KEY,'{broken');
  else if(options.data)localStorage.setItem(KEY,JSON.stringify(options.data));
  if(options.connected){const ids=options.connected==='first'?IDS.slice(0,1):IDS;localStorage.setItem(`eve-backend-sessions:${API}`,JSON.stringify(ids.map(id=>[id,{token:`${opaque.slice(0,42)}${IDS.indexOf(id)}`,expires:Date.now()+1200000}])));}
 },{options,KEY,IDS,API,opaque});
 return {state,errors,calls,privateEsi};
}
// The strip settles on Synced, or on the warning that names why it could not (EVE not answering, a sign-in that ended).
export async function openApp(page){await page.goto('/');await expect(page.locator('#sync-status')).toContainText(/Synced|EVE data from|answering|expired/);}
// The Echelon IA: old tab ids map to a view, and each view lives in one of seven destinations.
const VIEW={overview:'bridge',empire:'strengths',wallet:'ledger',notes:'logbook',journal:'logbook'};
export const DEST={bridge:'bridge',strengths:'wing',goals:'wing',training:'pilot',skills:'pilot',clones:'pilot',industry:'earn',mining:'earn',exploration:'earn',market:'earn',jobs:'earn',planets:'earn',sell:'earn',map:'navigate',hauling:'navigate',ledger:'ledger',logbook:'logbook'};
export const isMobile=page=>page.viewportSize().width<=720;
// Navigate like a person: the rail on desktop, the tab bar or More sheet on a phone, then the view's sub-view tab.
export async function tab(page,name){
 const id=VIEW[name]||name,dest=DEST[id];
 if(isMobile(page)){const item=page.locator(`#tabbar [data-dest="${dest}"]`);if(await item.count())await item.click();else{await page.locator('#tabbar-more').click();await page.locator(`#drawer [data-go="${id}"]`).click();}}
 else await page.locator(`.rail [data-dest="${dest}"]`).click();
 const sub=page.locator(`#viewbar [data-go="${id}"]`);
 if(await sub.count()&&await sub.getAttribute('aria-selected')!=='true')await sub.click();
 await expect(page.locator(`#${id}`)).toBeVisible();
}
export async function openDesk(page){const f=page.locator('#journal-form');if(!await f.isVisible())await page.locator('#new-entry').click();return f;}
export async function addEntry(page,{title='First expedition',body='We found a quiet wormhole.',pilot='Fiofka',category='Adventure',date='2026-10-30'}={}){
 await tab(page,'journal');const f=await openDesk(page);await f.getByLabel('Entry title').fill(title);await f.getByLabel('Private notes').fill(body);await f.getByRole('combobox',{name:'Pilot',exact:true}).selectOption(pilot);await f.getByLabel('Date',{exact:true}).fill(date);await f.getByRole('combobox',{name:'Focus',exact:true}).selectOption(category);await f.getByRole('button',{name:'Save entry locally'}).click();await expect(page.locator('#entries')).toContainText(title);
}
export const data={version:1,goals:[{id:'goal-one',title:'Fly a cruiser',pilot:'Both pilots',done:false,due:'2026-12-01',category:'Ships'}],entries:[{id:'entry-one',title:'A first flight',body:'A careful journey home.',pilot:'Fiofka',date:'2026-10-29',category:'Milestone'},{id:'entry-two',title:'Wormhole discovery',body:'Decxus found a connection.',pilot:'Decxus',date:'2026-10-30',category:'Adventure'}]};
