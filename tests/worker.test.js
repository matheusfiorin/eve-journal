import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,sign} from 'node:crypto';
import {handleRequest,encrypt,decrypt,syncPilot,scheduledSync,pipelineToken} from '../worker/index.js';
import {REQUESTED_SCOPES,SCOPES} from '../auth.js';
const sql=(await Promise.all(['0001_initial.sql','0002_wing_sharing.sql','0003_market.sql'].map(f=>readFile(new URL(`../worker/migrations/${f}`,import.meta.url),'utf8')))).join('\n');
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'worker-test',alg:'RS256',use:'sig'};
const id=2124810474;
function token(character=id,scopes=REQUESTED_SCOPES){
 const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const body=`${enc({alg:'RS256',kid:jwk.kid})}.${enc({iss:'https://login.eveonline.com',aud:['test-client','EVE Online'],azp:'test-client',sub:`CHARACTER:EVE:${character}`,name:'Fiofka',exp:Math.floor(Date.now()/1000)+1200,scp:scopes})}`;
 return `${body}.${sign('RSA-SHA256',Buffer.from(body),pair.privateKey).toString('base64url')}`;
}
function database(){
 const db=new DatabaseSync(':memory:');db.exec(sql);
 return {raw:db,prepare(sql){return {bind(...values){const statement=db.prepare(sql);return {first:async()=>statement.get(...values)||null,all:async()=>({results:statement.all(...values)}),run:async()=>statement.run(...values)};},first:async()=>db.prepare(sql).get()||null,all:async()=>({results:db.prepare(sql).all()})};},async batch(statements){db.exec('BEGIN');try{const result=await Promise.all(statements.map(s=>s.run()));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
function setup(options={}){
 const env={DB:database(),FRONTEND_URL:'https://matheusfiorin.github.io/eve-journal/',EVE_CLIENT_ID:'test-client',EVE_CLIENT_SECRET:'test-client-secret',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64')};
 const calls=[];const fetchImpl=async(url,init={})=>{
  calls.push({url:String(url),init});const path=new URL(url).pathname;
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(path.endsWith('/oauth/token')){assert.match(init.headers.Authorization,/^Basic /);return json({access_token:token(options.character||id,options.scopes||REQUESTED_SCOPES),refresh_token:'private-rotating-refresh-token'});}
  if(path.endsWith('/oauth/jwks'))return json({keys:[jwk]});
  if(path.endsWith('/oauth/revoke'))return new Response(null,{status:200});
  assert.match(init.headers.Authorization,/^Bearer /);
  if(path.endsWith('/skills/'))return json({total_sp:125000,unallocated_sp:5000,skills:[{skill_id:3300,trained_skill_level:4,active_skill_level:4}]});
  if(path.endsWith('/skillqueue/'))return json([{queue_position:0,skill_id:3300,finished_level:5,start_date:new Date(Date.now()-3600000).toISOString(),finish_date:new Date(Date.now()+3600000).toISOString()}]);
  if(path.endsWith('/wallet/'))return options.walletFail?json({},503):json(12345678.25);
  if(path.endsWith('/ship/'))return json({ship_type_id:605,ship_name:'Private ship name'});
  if(path.endsWith('/location/'))return json({solar_system_id:30000142});
  if(path.endsWith('/industry/jobs/'))return json([]);
  if(path.endsWith('/wallet/journal/'))return json(Array.from({length:120},(_,i)=>({id:i,date:'2026-10-30T00:00:00Z',ref_type:'bounty_prizes',amount:1000+i,balance:5})));
  if(path.endsWith('/wallet/transactions/'))return json([{transaction_id:1,date:'2026-10-30T00:00:00Z',type_id:34,quantity:10,unit_price:5,is_buy:true,location_id:60003760}]);
  if(path.endsWith('/attributes/'))return json({charisma:19,intelligence:20,memory:20,perception:20,willpower:20,bonus_remaps:2});
  if(path.endsWith('/clones/'))return json({home_location:{location_id:60003760,location_type:'station'},jump_clones:[]});
  if(path.endsWith('/implants/'))return json([9899]);
  if(path.endsWith('/assets/')){const page=Number(new URL(url).searchParams.get('page')||1);const rows=page===1?[{type_id:34,quantity:1000,location_id:1},{type_id:34,quantity:500,location_id:2},{type_id:605,quantity:1,location_id:1},{type_id:999,quantity:1,location_id:1,is_blueprint_copy:true}]:[{type_id:35,quantity:7,location_id:3}];return new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json','X-Pages':'2'}});}
  throw new Error(`Unexpected request ${path}`);
 };
 const request=(path,init={})=>handleRequest(new Request(`https://api.example${path}`,init),env,{},fetchImpl);
 return {env,calls,request,fetchImpl};
}
async function consent(app,{wing=true,character=id}={}){
 const page=await app.request(`/auth/start?pilot=${character}`);assert.equal(page.status,200);
 const body=await page.text(),csrf=body.match(/name="csrf" value="([^"]+)"/)[1];
 const start=await app.request('/auth/start',{method:'POST',headers:{Origin:'https://api.example',Cookie:page.headers.get('Set-Cookie').split(';')[0]},body:new URLSearchParams({pilot:String(character),csrf,share:'yes',...(wing?{wing:'yes'}:{})})});
 assert.equal(start.status,303);const login=new URL(start.headers.get('Location'));
 return {state:login.searchParams.get('state'),cookie:start.headers.get('Set-Cookie').split(';')[0],login};
}
async function connect(app,options){
 const pending=await consent(app,options);const callback=await app.request(`/auth/callback?code=test-code&state=${pending.state}`,{headers:{Cookie:pending.cookie}});
 return {callback,pending,bearer:callback.status===303?new URLSearchParams(new URL(callback.headers.get('Location')).hash.slice(1)).get('backend_session'):null};
}
test('health verifies database and required backend secrets',async()=>{
 const app=setup();assert.equal((await app.request('/health')).status,200);delete app.env.EVE_CLIENT_SECRET;assert.equal((await app.request('/health')).status,503);
});
test('OAuth start presents explicit public-sharing consent and requires CSRF',async()=>{
 const app=setup();const page=await app.request(`/auth/start?pilot=${id}`);assert.match(await page.text(),/visible on the public/);assert.match(page.headers.get('Content-Security-Policy'),/form-action 'self' https:\/\/login.eveonline.com/);
 const denied=await app.request('/auth/start',{method:'POST',headers:{Origin:'https://api.example'},body:new URLSearchParams({pilot:String(id),share:'yes'})});assert.equal(denied.status,403);
 const valid=await consent(app);assert.equal(valid.login.searchParams.get('code_challenge_method'),'S256');assert.equal(valid.login.searchParams.get('redirect_uri'),'https://api.example/auth/callback');
});
test('unknown pilots cannot enroll and arbitrary redirect parameters are ignored',async()=>{
 const app=setup();assert.equal((await app.request('/auth/start?pilot=999&redirect=https://evil.example')).status,403);
});
test('callback stores encrypted credentials, hashes the session and exposes only an opaque fragment token',async()=>{
 const app=setup();const {callback,bearer}=await connect(app);assert.equal(callback.status,303);assert.equal(bearer.length,43);
 const row=app.env.DB.raw.prepare('SELECT * FROM pilots').get();assert.ok(!row.credentials.includes('private-rotating-refresh-token'));assert.ok(!row.credentials.includes('eyJ'));
 assert.equal((await decrypt(row.credentials,app.env.TOKEN_ENCRYPTION_KEY)).refreshToken,'private-rotating-refresh-token');
 const saved=app.env.DB.raw.prepare('SELECT * FROM sessions').get();assert.notEqual(saved.token_hash,bearer);assert.equal(saved.token_hash.length,43);
 const payload=await(await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}})).json();assert.equal(payload.characterId,id);assert.equal(payload.operations.wallet.value,12345678.25);assert.ok(!JSON.stringify(payload).includes('private-rotating-refresh-token'));
});
test('public snapshots whitelist skills and queue and exclude private operations and credentials',async()=>{
 const app=setup();await connect(app);const publicData=await(await app.request('/api/public/pilots')).json();assert.equal(publicData.pilots[0].skills.total_sp,125000);
 const text=JSON.stringify(publicData);for(const secret of ['12345678.25','Private ship name','refreshToken','accessToken','operations','unallocated_sp'])assert.ok(!text.includes(secret));
});
test('state is bound to the browser cookie and callback cannot be replayed',async()=>{
 const app=setup();const pending=await consent(app);const path=`/auth/callback?code=test&state=${pending.state}`;
 assert.equal((await app.request(path)).status,403);assert.equal((await app.request(path,{headers:{Cookie:pending.cookie}})).status,303);assert.equal((await app.request(path,{headers:{Cookie:pending.cookie}})).status,403);
});
test('wrong-character consent never creates enrollment or session',async()=>{
 const app=setup({character:2124815118});const {callback}=await connect(app);assert.equal(callback.status,403);assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots').get().n,0);
});
test('missing or expired session cannot access private snapshots',async()=>{
 const app=setup();assert.equal((await app.request('/api/session')).status,401);const {bearer}=await connect(app);app.env.DB.raw.exec('UPDATE sessions SET expires_at = 0');assert.equal((await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}})).status,401);
});
test('CORS permits the Pages origin and refuses unrelated origins',async()=>{
 const app=setup();const allowed=await app.request('/api/public/pilots',{headers:{Origin:'https://matheusfiorin.github.io'}});assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'https://matheusfiorin.github.io');
 const refused=await app.request('/api/public/pilots',{headers:{Origin:'https://evil.example'}});assert.equal(refused.status,403);assert.equal(refused.headers.get('Access-Control-Allow-Origin'),null);
});
test('optional permission failure does not destroy the training snapshot',async()=>{
 const app=setup({walletFail:true});await connect(app);const row=app.env.DB.raw.prepare('SELECT snapshot FROM pilots').get();const snap=JSON.parse(row.snapshot);assert.equal(snap.skills.total_sp,125000);assert.match(snap.operations.wallet.error,/temporarily unavailable/);assert.equal(snap.operations.ship.value.ship_type_id,605);
});
test('training-only consent does not fetch optional private endpoints',async()=>{
 const app=setup({scopes:SCOPES});await connect(app);assert.ok(!app.calls.some(call=>/\/(wallet|location|ship|industry\/jobs|clones|implants|assets)\//.test(call.url)));
});
test('expired access token refreshes and persists encrypted rotation before ESI sync',async()=>{
 const app=setup();await connect(app);const row=app.env.DB.raw.prepare('SELECT * FROM pilots').get();const c=await decrypt(row.credentials,app.env.TOKEN_ENCRYPTION_KEY);c.expires=0;c.refreshToken='old-refresh';app.env.DB.raw.prepare('UPDATE pilots SET credentials = ?, updated_at = 0').run(await encrypt(c,app.env.TOKEN_ENCRYPTION_KEY));
 const synced=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(synced.last_error,null);assert.equal((await decrypt(synced.credentials,app.env.TOKEN_ENCRYPTION_KEY)).refreshToken,'private-rotating-refresh-token');assert.ok(app.calls.some(call=>call.url.includes('/oauth/token')&&String(call.init.body).includes('grant_type=refresh_token')));
});
test('disconnect removes enrollment, all sessions and public snapshot and requests EVE revocation',async()=>{
 const app=setup();const {bearer}=await connect(app);const disconnected=await app.request('/api/disconnect',{method:'POST',headers:{Authorization:`Bearer ${bearer}`}});assert.equal(disconnected.status,200);assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots').get().n,0);assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.ok(app.calls.some(call=>call.url.endsWith('/oauth/revoke')));assert.deepEqual((await(await app.request('/api/public/pilots')).json()).pilots,[]);
});
test('scheduler removes expired transient state and does not duplicate recent syncs',async()=>{
 const app=setup();await connect(app);const before=app.calls.length;await scheduledSync(app.env,app.fetchImpl);assert.equal(app.calls.length,before);
});
test('encryption rejects altered ciphertext and uses a fresh IV',async()=>{
 const secret=Buffer.alloc(32,9).toString('base64');const a=await encrypt({token:'private'},secret),b=await encrypt({token:'private'},secret);assert.notEqual(a,b);assert.deepEqual(await decrypt(a,secret),{token:'private'});const changed=JSON.parse(a);changed.data=(changed.data[0]==='A'?'B':'A')+changed.data.slice(1);await assert.rejects(decrypt(JSON.stringify(changed),secret));
});
test('wallet history is trimmed to the latest 50 rows and clone data is stored privately',async()=>{
 const app=setup();const {bearer}=await connect(app);const payload=await(await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}})).json();
 assert.equal(payload.operations.journal.value.length,50);assert.equal(payload.operations.journal.value[0].id,0);assert.equal(payload.operations.attributes.value.bonus_remaps,2);assert.deepEqual(payload.operations.implants.value,[9899]);
 const text=JSON.stringify(await(await app.request('/api/public/pilots')).json());for(const secret of ['bounty_prizes','bonus_remaps','9899'])assert.ok(!text.includes(secret));
});
test('assets are paged, summed per type and exclude blueprint copies',async()=>{
 const app=setup();const {bearer}=await connect(app);const payload=await(await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}})).json();
 assert.deepEqual(payload.operations.assets.value,{items:4,locations:3,truncated:false,types:[[34,1500],[35,7],[605,1]]});
 assert.ok(app.calls.some(c=>c.url.includes('/assets/?page=2')));assert.ok(!JSON.stringify(await(await app.request('/api/public/pilots')).json()).includes('assets'));
});
test('wing summaries need a session and include only pilots who opted in',async()=>{
 const app=setup();assert.equal((await app.request('/api/wing')).status,401);
 const {bearer}=await connect(app,{wing:false});
 let wing=await(await app.request('/api/wing',{headers:{Authorization:`Bearer ${bearer}`}})).json();
 assert.equal(wing.pilots.length,1);assert.equal(wing.pilots[0].sharing,false);assert.equal(wing.pilots[0].wallet,12345678.25);
 app.env.DB.raw.prepare("INSERT INTO pilots (character_id,name,credentials,snapshot,share_wing) VALUES (2124815118,'Decxus','x',?,0)").run(JSON.stringify({operations:{wallet:{value:777}}}));
 wing=await(await app.request('/api/wing',{headers:{Authorization:`Bearer ${bearer}`}})).json();assert.equal(wing.pilots.length,1);
 app.env.DB.raw.exec('UPDATE pilots SET share_wing = 1 WHERE character_id = 2124815118');
 wing=await(await app.request('/api/wing',{headers:{Authorization:`Bearer ${bearer}`}})).json();assert.equal(wing.pilots.length,2);assert.equal(wing.pilots.find(p=>p.name==='Decxus').wallet,777);assert.ok(!JSON.stringify(wing).includes('credentials'));
});
test('consent records the wingmate choice',async()=>{
 const app=setup();await connect(app,{wing:true});assert.equal(app.env.DB.raw.prepare('SELECT share_wing FROM pilots').get().share_wing,1);
});
test('market pipeline must authenticate, stores snapshots per region and the public read returns them',async()=>{
 const app=setup();await connect(app);const token=await pipelineToken(app.env.EVE_CLIENT_SECRET);
 const ingest=(auth,body)=>app.request('/api/market/ingest',{method:'POST',headers:auth?{Authorization:`Bearer ${auth}`}:{},body:JSON.stringify(body)});
 assert.equal((await ingest(null,{region:1,data:{}})).status,401);assert.equal((await ingest('x'.repeat(43),{region:1,data:{}})).status,401);
 assert.equal((await ingest(token,{region:'x',data:{}})).status,400);
 assert.equal((await ingest(token,{region:0,data:{types:{34:{n:'Tritanium',v:0.01}}}})).status,200);
 assert.equal((await ingest(token,{region:10000002,data:{name:'The Forge',types:{34:{s:[[60003760,5,1000]]}}}})).status,200);
 assert.equal((await ingest(token,{region:10000002,data:{name:'The Forge',types:{}}})).status,200);
 assert.equal((await ingest(token,{region:2,data:{done:{10000002:1}}})).status,200);
 assert.equal((await app.request('/api/market/survey')).status,401);
 assert.deepEqual((await(await app.request('/api/market/survey',{headers:{Authorization:`Bearer ${token}`}})).json()).survey,{done:{10000002:1}});
 const market=await(await app.request('/api/market')).json();assert.equal(market.meta.data.types[34].n,'Tritanium');assert.equal(market.regions.length,1);assert.deepEqual(market.regions[0].data.types,{});
 assert.equal((await app.request('/api/market/regions')).status,401);
 const regions=await(await app.request('/api/market/regions',{headers:{Authorization:`Bearer ${token}`}})).json();assert.deepEqual(regions.systems,[30000142]);
});
test('active sessions slide forward at most once a day and expire after 30 idle days',async()=>{
 const app=setup();const {bearer}=await connect(app);const read=()=>app.env.DB.raw.prepare('SELECT expires_at FROM sessions').get().expires_at;
 const first=read();assert.ok(first>Date.now()+29*86400000);
 await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}});assert.equal(read(),first,'no write when renewed within a day');
 app.env.DB.raw.prepare('UPDATE sessions SET expires_at = ?').run(Date.now()+86400000);
 const payload=await(await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}})).json();
 assert.ok(read()>Date.now()+29*86400000);assert.equal(payload.expires,read());
});
