import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,sign,createHmac,createHash} from 'node:crypto';
import {signPipelineRequest} from '../worker/pipeline-auth.js';
import {handleRequest,scheduled,cleanup,DAILY_CRON,INGEST_TYPES,logger,encrypt,decrypt,retryAt,syncPilot,scheduledSync,sampleActivity,pipelineToken,HUB_REGIONS,SYNC_EVERY,SAMPLE_EVERY,ESI_COMPAT,ESI_FLOOR,STATIC_META,joinObjects,resetJwks,JOURNAL_CHANGES,EXTRAS,SYNC_LIMIT} from '../worker/index.js';
import {EXTRA_MAX} from '../model.js';
import {HUBS} from '../scripts/market-pipeline.mjs';
import {REQUESTED_SCOPES,SCOPES} from '../auth.js';
const sql=(await Promise.all(['0001_initial.sql','0002_wing_sharing.sql','0003_market.sql','0004_journal.sql','0005_journal_prefs.sql','0006_refresh_holds.sql','0007_market_docs.sql','0008_cleanup_indexes.sql','0009_alerts.sql'].map(f=>readFile(new URL(`../worker/migrations/${f}`,import.meta.url),'utf8')))).join('\n');
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'worker-test',alg:'RS256',use:'sig'};
const id=2124810474,P=`pilot:${id}`;
function token(character=id,scopes=REQUESTED_SCOPES){
 const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const body=`${enc({alg:'RS256',kid:jwk.kid})}.${enc({iss:'https://login.eveonline.com',aud:['test-client','EVE Online'],azp:'test-client',sub:`CHARACTER:EVE:${character}`,name:'Fiofka',exp:Math.floor(Date.now()/1000)+1200,scp:scopes})}`;
 return `${body}.${sign('RSA-SHA256',Buffer.from(body),pair.privateKey).toString('base64url')}`;
}
// A D1 stand-in over SQLite: a fresh database with every migration, or the one given.
function database(db){
 if(!db){db=new DatabaseSync(':memory:');db.exec(sql);}
 return {raw:db,prepare(sql){return {bind(...values){const statement=db.prepare(sql);return {first:async()=>statement.get(...values)||null,all:async()=>({results:statement.all(...values)}),run:async()=>{if(/\bRETURNING\b/i.test(sql)){const results=statement.all(...values);return {results,meta:{changes:results.length}};}const r=statement.run(...values);return {results:[],meta:{changes:Number(r.changes)}};}};},first:async()=>db.prepare(sql).get()||null,all:async()=>({results:db.prepare(sql).all()})};},async batch(statements){db.exec('BEGIN');try{const result=await Promise.all(statements.map(s=>s.run()));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
function setup(options={}){
 const env={DB:database(),FRONTEND_URL:'https://matheusfiorin.github.io/eve-journal/',EVE_CLIENT_ID:'test-client',EVE_CLIENT_SECRET:'test-client-secret',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64')};
 const calls=[];const fetchImpl=async(url,init={})=>{
  calls.push({url:String(url),init});const path=new URL(url).pathname;
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(path.endsWith('/oauth/token')){assert.match(init.headers.Authorization,/^Basic /);if(options.limited&&String(init.body).includes('grant_type=refresh_token'))return new Response('{}',{status:429,headers:{'Retry-After':String(options.limited)}});if(options.revoked&&String(init.body).includes('grant_type=refresh_token'))return json({error:'invalid_grant',error_description:'Invalid refresh token. Token missing/expired.'},400);return json({access_token:token(options.character||id,options.scopes||REQUESTED_SCOPES),refresh_token:'private-rotating-refresh-token'});}
  if(path.endsWith('/oauth/jwks'))return options.jwksDown?json({},503):json({keys:[jwk]});
  if(path.endsWith('/oauth/revoke'))return new Response(null,{status:200});
  // ESI's public hourly feeds: options.feeds = {kills, jumps, modified, expires, fail} (a feed missing is a 503).
  if(path==='/universe/system_kills/'||path==='/universe/system_jumps/'){
   const f=options.feeds||{},key=path.includes('kills')?'kills':'jumps',rows=f[key];
   if(f.fail===key)return new Response('{}',{status:429,headers:{'Retry-After':'600'}});
   if(!rows)return json({},503);
   const tag=`"${key}-${f.modified}"`,headers={'Content-Type':'application/json',ETag:tag,'Last-Modified':new Date(f.modified).toUTCString(),Expires:new Date(f.expires).toUTCString()};
   if(init.headers?.['If-None-Match']===tag)return new Response(null,{status:304,headers});
   return new Response(JSON.stringify(rows),{headers});
  }
  // Public ESI routes the sync reads without a token: a killmail and the name lookup alerts use.
  if(/^\/killmails\/\d+\/\w+\/$/.test(path)){const kid=Number(path.split('/')[2]);return json(options.killmail?.(kid)||{killmail_id:kid,killmail_time:new Date(Date.now()-kid*60000).toISOString(),solar_system_id:30000142,victim:{ship_type_id:605,character_id:kid%2?id:99},attackers:[{final_blow:true,corporation_id:1000044},{corporation_id:5}]});}
  if(new URL(url).hostname==='discord.com'){if(options.webhookStatus>=400)return new Response('{}',{status:options.webhookStatus});(options.posts||=[]).push(JSON.parse(init.body));return new Response(null,{status:204});}
  if(path==='/universe/names/')return json(JSON.parse(init.body).map(i=>({id:i,name:options.typeNames?.[i]||`Type ${i}`,category:'inventory_type'})));
  assert.match(init.headers.Authorization,/^Bearer /);
  const res=await character(url,path,init);
  // options.cache = {ttl(path) -> ms until Expires, unchanged: answer 304 to a matching ETag}; options.limitPath answers
  // that path with a 429; options.remaining sets X-Ratelimit-Remaining on every answer.
  const headers=new Headers(res.headers);
  if(options.remaining!==undefined)headers.set('X-Ratelimit-Remaining',String(options.remaining));
  if(options.limitPath&&path.endsWith(options.limitPath))return new Response('{}',{status:429,headers:{'Retry-After':'120'}});
  if(!options.cache)return new Response(res.body,{status:res.status,headers});
  const tag=`"${path}"`;headers.set('ETag',tag);headers.set('Expires',new Date(Date.now()+options.cache.ttl(path)).toUTCString());headers.set('Last-Modified','Fri, 13 Nov 2026 10:00:00 GMT');
  if(options.cache.unchanged&&init.headers?.['If-None-Match']===tag)return new Response(null,{status:304,headers});
  return new Response(res.body,{status:res.status,headers});
 };
 const character=async(url,path)=>{
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(path.endsWith('/skills/'))return json({total_sp:125000,unallocated_sp:5000,skills:[{skill_id:3300,trained_skill_level:4,active_skill_level:4}]});
  if(path.endsWith('/skillqueue/'))return json([{queue_position:0,skill_id:3300,finished_level:5,start_date:new Date(Date.now()-3600000).toISOString(),finish_date:new Date(Date.now()+3600000).toISOString()}]);
  if(path.endsWith('/wallet/'))return options.walletFail?json({},503):json(12345678.25);
  if(path.endsWith('/ship/'))return json({ship_type_id:605,ship_name:'Private ship name',ship_item_id:1001});
  if(path.endsWith('/location/'))return json({solar_system_id:30000142});
  if(path.endsWith('/industry/jobs/'))return json(options.jobs||[]);
  if(path.endsWith('/wallet/journal/'))return json(Array.from({length:120},(_,i)=>({id:i,date:'2026-10-30T00:00:00Z',ref_type:'bounty_prizes',amount:1000+i,balance:5})));
  if(path.endsWith('/wallet/transactions/'))return json([{transaction_id:1,date:'2026-10-30T00:00:00Z',type_id:34,quantity:10,unit_price:5,is_buy:true,location_id:60003760}]);
  if(path.endsWith('/attributes/'))return json({charisma:19,intelligence:20,memory:20,perception:20,willpower:20,bonus_remaps:2});
  if(path.endsWith('/clones/'))return json({home_location:{location_id:60003760,location_type:'station'},jump_clones:[]});
  if(path.endsWith('/implants/'))return json([9899]);
  if(path.endsWith('/mining/'))return json([{date:'2026-11-01',solar_system_id:30000142,type_id:1230,quantity:100}]);
  if(path.endsWith('/assets/')){const page=Number(new URL(url).searchParams.get('page')||1);const rows=page===1?[{type_id:34,quantity:1000,location_id:1},{type_id:34,quantity:500,location_id:2},{type_id:605,quantity:1,location_id:1},{type_id:999,quantity:1,location_id:1,is_blueprint_copy:true},...(options.fit||[])]:[{type_id:35,quantity:7,location_id:3}];return new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json','X-Pages':String(options.assetPages||2)}});}
  if(path.endsWith('/orders/history/'))return json(options.history||[]);
  if(path.endsWith('/orders/'))return json(options.orders||[]);
  if(path.endsWith('/contracts/'))return json(options.contracts||[]);
  if(/\/contracts\/\d+\/items\/$/.test(path))return options.contractItems?json(options.contractItems,options.contractItemsStatus||200):json({error:'none'},404);
  if(path.endsWith('/killmails/recent/'))return json(options.kills||[]);
  if(path.endsWith('/blueprints/'))return json(options.blueprints||[]);
  if(/\/planets\/\d+\/$/.test(path))return json(options.planetPins||{links:[],pins:[{pin_id:1,extractor_details:{product_type_id:2268,heads:[{head_id:1}]},expiry_time:'2026-12-01T00:00:00Z'},{pin_id:2,factory_details:{schematic_id:121}},{pin_id:3,contents:[{type_id:2268,amount:300}]}],routes:[]});
  if(path.endsWith('/planets/'))return json(options.planets||[]);
  if(path.endsWith('/standings/'))return json(options.standings||[]);
  if(path.endsWith('/ui/autopilot/waypoint/'))return new Response(null,{status:options.gameOffline?404:204});
  throw new Error(`Unexpected request ${path}`);
 };
 const request=(path,init={})=>handleRequest(new Request(`https://api.example${path}`,init),env,{},fetchImpl);
 return {env,calls,request,fetchImpl};
}
// The hourly kills sample is not due, so a cron run goes to a pilot sync (see the sampling tests for the other case).
const sampled=(app,turns=0)=>app.env.DB.raw.prepare("INSERT INTO market_docs (name, data, updated_at, expires_at, turns) VALUES ('activity', '{}', ?, ?, ?) ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at, turns = excluded.turns").run(Date.now(),Date.now()+3600000,turns);
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
 assert.equal((await decrypt(row.credentials,app.env.TOKEN_ENCRYPTION_KEY,P)).refreshToken,'private-rotating-refresh-token');
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
 const app=setup({scopes:SCOPES});await connect(app);assert.ok(!app.calls.some(call=>/\/(wallet|location|ship|industry\/jobs|clones|implants|assets|mining|orders|contracts|killmails|blueprints|planets|standings)\//.test(call.url)));
});
test('expired access token refreshes and persists encrypted rotation before ESI sync',async()=>{
 const app=setup();await connect(app);const row=app.env.DB.raw.prepare('SELECT * FROM pilots').get();const c=await decrypt(row.credentials,app.env.TOKEN_ENCRYPTION_KEY,P);c.expires=0;c.refreshToken='old-refresh';app.env.DB.raw.prepare('UPDATE pilots SET credentials = ?, updated_at = 0').run(await encrypt(c,app.env.TOKEN_ENCRYPTION_KEY,P));
 const synced=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(synced.last_error,null);assert.equal((await decrypt(synced.credentials,app.env.TOKEN_ENCRYPTION_KEY,P)).refreshToken,'private-rotating-refresh-token');assert.ok(app.calls.some(call=>call.url.includes('/oauth/token')&&String(call.init.body).includes('grant_type=refresh_token')));
});
test('a failed key check after a refresh keeps the rotated refresh token, so the next sync recovers without a reconnect',async()=>{
 const options={},app=setup(options);await connect(app);
 const expire=async()=>{const row=app.env.DB.raw.prepare('SELECT * FROM pilots').get();const c=await decrypt(row.credentials,app.env.TOKEN_ENCRYPTION_KEY,P);c.expires=0;c.refreshToken='old-refresh';app.env.DB.raw.prepare('UPDATE pilots SET credentials = ?, updated_at = 0').run(await encrypt(c,app.env.TOKEN_ENCRYPTION_KEY,P));};
 await expire();resetJwks();options.jwksDown=true;
 const failed=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.match(failed.last_error,/temporarily unavailable/);
 const stored=await decrypt(app.env.DB.raw.prepare('SELECT credentials FROM pilots').get().credentials,app.env.TOKEN_ENCRYPTION_KEY,P);
 assert.equal(stored.refreshToken,'private-rotating-refresh-token','EVE already rotated the token, so the new one must be kept');assert.equal(stored.expires,0,'and the next sync refreshes again');
 options.jwksDown=false;const recovered=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(recovered.last_error,null);
 // The keys are cached: another refresh within the hour doesn't fetch them again.
 const jwksCalls=()=>app.calls.filter(c=>c.url.endsWith('/oauth/jwks')).length,before=jwksCalls();await expire();await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(jwksCalls(),before);
});
test('a revoked refresh token asks the pilot to reconnect instead of blaming EVE',async()=>{
 const app=setup({revoked:true});const {bearer}=await connect(app);const row=app.env.DB.raw.prepare('SELECT * FROM pilots').get();const c=await decrypt(row.credentials,app.env.TOKEN_ENCRYPTION_KEY,P);c.expires=0;app.env.DB.raw.prepare('UPDATE pilots SET credentials = ?, updated_at = 0').run(await encrypt(c,app.env.TOKEN_ENCRYPTION_KEY,P));
 const synced=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.match(synced.last_error,/authorization expired or was revoked.*Reconnect/);
 const payload=await(await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}})).json();assert.match(payload.lastError,/Reconnect/);
});
test('disconnect removes enrollment, all sessions and public snapshot and requests EVE revocation',async()=>{
 const app=setup();const {bearer}=await connect(app);const disconnected=await app.request('/api/disconnect',{method:'POST',headers:{Authorization:`Bearer ${bearer}`}});assert.equal(disconnected.status,200);assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots').get().n,0);assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);assert.ok(app.calls.some(call=>call.url.endsWith('/oauth/revoke')));assert.deepEqual((await(await app.request('/api/public/pilots')).json()).pilots,[]);
});
test('the 5 minute scheduler does not duplicate recent syncs',async()=>{
 const app=setup();await connect(app);sampled(app);const before=app.calls.length;await scheduledSync(app.env,app.fetchImpl);assert.equal(app.calls.length,before);
});
test('encryption rejects altered ciphertext and uses a fresh IV',async()=>{
 const secret=Buffer.alloc(32,9).toString('base64');const a=await encrypt({token:'private'},secret,P),b=await encrypt({token:'private'},secret,P);assert.notEqual(a,b);assert.deepEqual(await decrypt(a,secret,P),{token:'private'});const changed=JSON.parse(a);changed.data=(changed.data[0]==='A'?'B':'A')+changed.data.slice(1);await assert.rejects(decrypt(JSON.stringify(changed),secret,P));
});
// What encrypt() wrote before blobs were bound to their row: v:1, no additional data.
async function legacy(value,secret){
 const key=await crypto.subtle.importKey('raw',Buffer.from(secret,'base64'),'AES-GCM',false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
 return JSON.stringify({v:1,iv:Buffer.from(iv).toString('base64url'),data:Buffer.from(data).toString('base64url')});
}
async function expireCredentials(app,write=c=>encrypt(c,app.env.TOKEN_ENCRYPTION_KEY,P)){
 const c=await decrypt(app.env.DB.raw.prepare('SELECT credentials FROM pilots WHERE character_id = ?').get(id).credentials,app.env.TOKEN_ENCRYPTION_KEY,P);c.expires=0;
 app.env.DB.raw.prepare('UPDATE pilots SET credentials = ?, updated_at = 0 WHERE character_id = ?').run(await write(c),id);
}
test('a blob is bound to its row: v:2 decrypts only with the same context, v:1 still decrypts without one',async()=>{
 const secret=Buffer.alloc(32,9).toString('base64'),v2=await encrypt({token:'private'},secret,'pilot:1');
 assert.equal(JSON.parse(v2).v,2);await assert.rejects(decrypt(v2,secret,'pilot:2'));await assert.rejects(decrypt(v2,secret),/could not be read/);
 await assert.rejects(encrypt({token:'private'},secret),/needs a context/,'every new write names its row');
 const v1=await legacy({token:'old'},secret);assert.deepEqual(await decrypt(v1,secret,'pilot:1'),{token:'old'});assert.deepEqual(await decrypt(v1,secret),{token:'old'});
});
test('v:1 credentials keep working and are rewritten as v:2 on the next refresh; credentials moved to another pilot do not decrypt',async()=>{
 const app=setup();await connect(app);const key=app.env.TOKEN_ENCRYPTION_KEY;
 assert.equal(JSON.parse(app.env.DB.raw.prepare('SELECT credentials FROM pilots').get().credentials).v,2,'the callback writes v:2');
 await expireCredentials(app,c=>legacy(c,key));
 const synced=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(synced.last_error,null);
 assert.equal(JSON.parse(synced.credentials).v,2);assert.equal((await decrypt(synced.credentials,key,P)).refreshToken,'private-rotating-refresh-token');
 // Someone with write access to the table copies Fiofka's grant into Decxus's row.
 app.env.DB.raw.prepare("INSERT INTO pilots (character_id, name, credentials, share_training) SELECT 2124815118, 'Decxus', credentials, 1 FROM pilots WHERE character_id = ?").run(id);
 const before=app.calls.length,moved=await syncPilot(2124815118,app.env,app.fetchImpl,{force:true});
 assert.match(moved.last_error,/Synchronization failed/);assert.equal(app.calls.length,before,'no EVE call is made with it');
});
test('journal records are bound to kind and id; v:1 rows are still served and become v:2 when next written',async()=>{
 const {app,a,call}=await wingApp(),key=app.env.TOKEN_ENCRYPTION_KEY;
 await call(a,'POST',{changes:[{kind:'entry',id:'e1',base:0,record:entry}]});
 const stored=app.env.DB.raw.prepare("SELECT data FROM journal WHERE id = 'e1'").get().data;
 assert.deepEqual(await decrypt(stored,key,'entry:e1'),entry);await assert.rejects(decrypt(stored,key,'entry:e2'));await assert.rejects(decrypt(stored,key,'goal:e1'));
 app.env.DB.raw.prepare("INSERT INTO journal (kind, id, owner, data, rev, updated_at, updated_by) VALUES ('goal', 'g1', 0, ?, 7, 0, ?)").run(await legacy(goal,key),id);
 const pulled=await call(a,'GET',null,'?since=1');assert.deepEqual(pulled.body.records.map(r=>[r.id,r.record]),[['g1',goal]]);
 await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:7,record:{...goal,done:true}}]});
 const upgraded=app.env.DB.raw.prepare("SELECT data FROM journal WHERE id = 'g1'").get().data;assert.equal(JSON.parse(upgraded).v,2);assert.equal((await decrypt(upgraded,key,'goal:g1')).done,true);
});
test('after EVE refuses the refresh token, syncs stop asking EVE until the pilot reconnects',async()=>{
 const options={revoked:true},app=setup(options);await connect(app);await expireCredentials(app);sampled(app);
 const tokenCalls=()=>app.calls.filter(c=>c.url.endsWith('/oauth/token')).length,before=tokenCalls();
 const failed=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.match(failed.last_error,/revoked.*Reconnect/);assert.ok(failed.grant_revoked_at>0);assert.equal(tokenCalls(),before+1);
 const again=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.match(again.last_error,/revoked.*Reconnect/);assert.equal(tokenCalls(),before+1,'a request does not try again');
 const calls=app.calls.length;await scheduledSync(app.env,app.fetchImpl,0);assert.equal(app.calls.length,calls,'nor does the cron: the pilot gets no turn');
 options.revoked=false;await connect(app);
 const back=app.env.DB.raw.prepare('SELECT grant_revoked_at, last_error FROM pilots').get();assert.equal(back.grant_revoked_at,null);assert.equal(back.last_error,null);
 await expireCredentials(app);assert.equal((await syncPilot(id,app.env,app.fetchImpl,{force:true})).last_error,null);assert.equal(tokenCalls(),before+3,'the callback and the refresh after it');
});
test('a 429 from EVE login holds refreshes until Retry-After has passed',async()=>{
 const options={limited:120},app=setup(options);await connect(app);await expireCredentials(app);
 const tokenCalls=()=>app.calls.filter(c=>c.url.endsWith('/oauth/token')).length,before=tokenCalls();
 const started=Date.now(),limited=await syncPilot(id,app.env,app.fetchImpl,{force:true});
 assert.match(limited.last_error,/rate limit/);assert.ok(limited.refresh_after>=started+120000&&limited.refresh_after<=Date.now()+120000);
 await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(tokenCalls(),before+1,'held');
 options.limited=0;app.env.DB.raw.prepare('UPDATE pilots SET refresh_after = ?').run(Date.now()-1);
 assert.equal((await syncPilot(id,app.env,app.fetchImpl,{force:true})).last_error,null);assert.equal(tokenCalls(),before+2);
 assert.equal(retryAt('30',1000),31000);assert.equal(retryAt(new Date(61000).toUTCString(),1000),61000);assert.equal(retryAt('86400',0),3600000,'at most an hour');
 for(const bad of [null,'','soon','-5'])assert.equal(retryAt(bad,1000),0);
});
test('a browser can end the one session it holds, leaving the pilot’s other devices signed in',async()=>{
 const app=setup();const phone=(await connect(app)).bearer,laptop=(await connect(app)).bearer;
 const revoke=auth=>app.request('/api/session/revoke',{method:'POST',headers:{Origin:'https://matheusfiorin.github.io',...(auth?{Authorization:`Bearer ${auth}`}:{})}});
 const ended=await revoke(phone);assert.equal(ended.status,200);assert.deepEqual(await ended.json(),{revoked:true});assert.equal(ended.headers.get('Access-Control-Allow-Origin'),'https://matheusfiorin.github.io');
 assert.equal((await app.request('/api/session',{headers:{Authorization:`Bearer ${phone}`}})).status,401);
 assert.equal((await app.request('/api/session',{headers:{Authorization:`Bearer ${laptop}`}})).status,200);
 assert.deepEqual(await(await revoke(phone)).json(),{revoked:false},'ending it twice is harmless');
 assert.equal((await revoke(null)).status,401);assert.equal((await app.request('/api/session/revoke',{headers:{Authorization:`Bearer ${laptop}`}})).status,404,'POST only');
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots').get().n,1,'the pilot stays connected');
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
 app.env.DB.raw.prepare("INSERT INTO pilots (character_id,name,credentials,snapshot,share_wing) VALUES (2124815118,'Decxus','x',?,0)").run(JSON.stringify({operations:{wallet:{value:777},location:{value:{solar_system_id:30000142}},mining:{value:[{type_id:1230,quantity:5}]},jobs:{value:[{job_id:9,status:'active'}]}}}));
 wing=await(await app.request('/api/wing',{headers:{Authorization:`Bearer ${bearer}`}})).json();assert.equal(wing.pilots.length,1);
 app.env.DB.raw.exec('UPDATE pilots SET share_wing = 1 WHERE character_id = 2124815118');
 wing=await(await app.request('/api/wing',{headers:{Authorization:`Bearer ${bearer}`}})).json();assert.equal(wing.pilots.length,2);assert.equal(wing.pilots.find(p=>p.name==='Decxus').wallet,777);assert.ok(!JSON.stringify(wing).includes('credentials'));
 assert.equal(wing.pilots.find(p=>p.name==='Decxus').location,undefined,'the first consent did not cover location');
 app.env.DB.raw.exec('UPDATE pilots SET share_wing = 2 WHERE character_id = 2124815118');
 wing=await(await app.request('/api/wing',{headers:{Authorization:`Bearer ${bearer}`}})).json();const d=wing.pilots.find(p=>p.name==='Decxus');
 assert.equal(d.location.solar_system_id,30000142);assert.equal(d.mining[0].quantity,5);assert.equal(d.jobs[0].job_id,9);
});
test('consent records the wingmate choice',async()=>{
 const app=setup();await connect(app,{wing:true});assert.equal(app.env.DB.raw.prepare('SELECT share_wing FROM pilots').get().share_wing,2);
});
test('each scheduled run syncs one pilot, taking turns, to stay within the per-invocation subrequest limit',async()=>{
 const app=setup();await connect(app);const other=2124815118;sampled(app);
 app.env.DB.raw.prepare("INSERT INTO pilots (character_id, name, credentials, snapshot, share_training) SELECT ?, 'Decxus', credentials, snapshot, 1 FROM pilots WHERE character_id = ?").run(other,id);
 // Credentials are bound to their pilot, so the copy is sealed again for Decxus.
 const key=app.env.TOKEN_ENCRYPTION_KEY,copy=await decrypt(app.env.DB.raw.prepare('SELECT credentials FROM pilots WHERE character_id = ?').get(id).credentials,key,P);
 app.env.DB.raw.prepare('UPDATE pilots SET credentials = ? WHERE character_id = ?').run(await encrypt(copy,key,`pilot:${other}`),other);
 app.env.DB.raw.prepare('UPDATE pilots SET updated_at = 0, last_error = ?').run('still failing');
 let before;const synced=()=>[...new Set(app.calls.slice(before).map(c=>Number(c.url.match(/characters\/(\d+)\//)?.[1])).filter(Boolean))];
 const tick=n=>n*SYNC_EVERY;
 before=app.calls.length;await scheduledSync(app.env,app.fetchImpl,tick(100));assert.deepEqual(synced(),[id]);
 before=app.calls.length;await scheduledSync(app.env,app.fetchImpl,tick(101));assert.deepEqual(synced(),[other],'the next run takes the other pilot');
 app.env.DB.raw.prepare('UPDATE pilots SET updated_at = 0').run();
 before=app.calls.length;await scheduledSync(app.env,app.fetchImpl,tick(102));assert.deepEqual(synced(),[id]);
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
 assert.equal((await ingest(token,{region:10000043,data:{name:'Domain',types:{}}})).status,200);
 app.env.DB.raw.exec(`UPDATE market_snapshots SET updated_at = ${Date.now()-7*3600000} WHERE region_id IN (0, 10000043)`);
 const fresh=await(await app.request('/api/market')).json();assert.deepEqual(fresh.regions.map(r=>r.region),[10000002],'a region not scanned for 6 hours is dropped');assert.ok(fresh.meta,'meta is kept however old');
 assert.equal((await app.request('/api/market/regions')).status,401);
 const regions=await(await app.request('/api/market/regions',{headers:{Authorization:`Bearer ${token}`}})).json();assert.deepEqual(regions.systems,[30000142]);
});
test('the public market read serves only trade hubs; a signed-in session also sees the pilots\' regions',async()=>{
 const app=setup();const {bearer}=await connect(app);const token=await pipelineToken(app.env.EVE_CLIENT_SECRET);
 const ingest=body=>app.request('/api/market/ingest',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 for(const body of [{region:0,data:{types:{}}},{region:1,data:{systems:{}}},{region:2,data:{done:{10000002:1}}},{region:10000002,data:{name:'The Forge',types:{34:{d:5,s:[[60003760,5.5,1000]]}}}},{region:10000020,data:{name:'Tash-Murkon',types:{}}}])assert.equal((await ingest(body)).status,200);
 const anonymous=await app.request('/api/market');const open=await anonymous.json();
 assert.deepEqual(open.regions.map(r=>r.region),[10000002],'a pilot region is not public');assert.match(anonymous.headers.get('Cache-Control'),/^public/);assert.equal(anonymous.headers.get('Vary'),'Authorization');
 assert.deepEqual(open.regions[0].data,{name:'The Forge',types:{34:{d:5,s:[[60003760,5.5,1000]]}}});assert.deepEqual(open.universe,{systems:{}});assert.equal(open.meta.region,0);assert.ok(Number.isFinite(open.meta.updatedAt));
 assert.ok(!JSON.stringify(open).includes('done'),'the blueprint survey is never served');
 const forged=await(await app.request('/api/market',{headers:{Authorization:`Bearer ${'x'.repeat(43)}`}})).json();assert.deepEqual(forged.regions.map(r=>r.region),[10000002],'an invalid session gets the public view');
 const signed=await app.request('/api/market',{headers:{Authorization:`Bearer ${bearer}`}});
 assert.deepEqual((await signed.json()).regions.map(r=>r.region).sort(),[10000002,10000020]);assert.match(signed.headers.get('Cache-Control'),/^private/);
});
test('the Worker and the pipeline agree on the trade hubs',()=>{assert.deepEqual([...HUB_REGIONS].sort(),[...HUBS].sort());});
test('active sessions slide forward at most once a day and expire after 30 idle days',async()=>{
 const app=setup();const {bearer}=await connect(app);const read=()=>app.env.DB.raw.prepare('SELECT expires_at FROM sessions').get().expires_at;
 const first=read();assert.ok(first>Date.now()+29*86400000);
 await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}});assert.equal(read(),first,'no write when renewed within a day');
 app.env.DB.raw.prepare('UPDATE sessions SET expires_at = ?').run(Date.now()+86400000);
 const payload=await(await app.request('/api/session',{headers:{Authorization:`Bearer ${bearer}`}})).json();
 assert.ok(read()>Date.now()+29*86400000);assert.equal(payload.expires,read());
});
test('autopilot waypoints replace the in-game route in order, only with the permission',async()=>{
 const app=setup();const {bearer}=await connect(app);
 const send=(body,auth=bearer)=>app.request('/api/waypoints',{method:'POST',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await send({systems:[]})).status,400);assert.equal((await send({systems:[1]})).status,400);
 const ok=await send({systems:[30000142,30000144]});assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{waypoints:2});
 const calls=app.calls.filter(c=>c.url.includes('/ui/autopilot/waypoint/'));
 assert.deepEqual(calls.map(c=>new URL(c.url).searchParams.get('clear_other_waypoints')),['true','false']);assert.deepEqual(calls.map(c=>new URL(c.url).searchParams.get('destination_id')),['30000142','30000144']);
 assert.equal(app.env.DB.raw.prepare('SELECT sync_lock_until FROM pilots').get().sync_lock_until,0,'the lock is released');
 const limited=setup({scopes:SCOPES});const s2=await connect(limited);
 assert.equal((await limited.request('/api/waypoints',{method:'POST',headers:{Authorization:`Bearer ${s2.bearer}`},body:JSON.stringify({systems:[30000142]})})).status,403);
 const offline=setup({gameOffline:true});const s3=await connect(offline);
 assert.equal((await offline.request('/api/waypoints',{method:'POST',headers:{Authorization:`Bearer ${s3.bearer}`},body:JSON.stringify({systems:[30000142]})})).status,502);
});
test('sync keeps a trail of visited systems without repeating the current one',async()=>{
 const app=setup();await connect(app);
 const trail=()=>JSON.parse(app.env.DB.raw.prepare('SELECT snapshot FROM pilots').get().snapshot).operations.trail.value;
 assert.deepEqual(trail().map(([id])=>id),[30000142]);
 await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(trail().length,1,'still in Jita');
 const limited=setup({scopes:SCOPES});await connect(limited);
 assert.equal(JSON.parse(limited.env.DB.raw.prepare('SELECT snapshot FROM pilots').get().snapshot).operations.trail,undefined,'no location permission, no trail');
});
test('disconnect waits for a running sync before revoking, so it revokes the latest refresh token',async()=>{
 const app=setup();const {bearer}=await connect(app);
 app.env.DB.raw.prepare('UPDATE pilots SET sync_lock_until = ?').run(Date.now()+1500);
 const started=Date.now();
 const res=await app.request('/api/disconnect',{method:'POST',headers:{Authorization:`Bearer ${bearer}`}});
 assert.equal(res.status,200);assert.ok(Date.now()-started>=1000,'it waited for the lock');
 assert.deepEqual(await res.json(),{disconnected:true,revoked:true});
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots').get().n,0);
});
const other=2124815118;
async function wingApp(){
 const options={};const app=setup(options);const a=(await connect(app)).bearer;
 options.character=other;const b=(await connect(app,{character:other})).bearer;options.character=id;
 const call=async(bearer,method,body,query='')=>{const res=await app.request(`/api/journal${query}`,{method,headers:{Authorization:`Bearer ${bearer}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};};
 return {app,a,b,call};
}
const goal={id:'g1',title:'Fly a Heron',pilot:'Both pilots',done:false};
const entry={id:'e1',title:'First trip',pilot:'Fiofka',date:'2026-11-01',body:'JOURNAL-SECRET-4411'};
test('journal sync: goals reach both pilots, entries only their author, and nothing is stored in plain text',async()=>{
 const {app,a,b,call}=await wingApp();
 const put=await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:0,record:goal},{kind:'entry',id:'e1',base:0,record:entry}]});
 assert.equal(put.status,200);assert.deepEqual(put.body.applied.map(x=>[x.kind,x.rev]),[['goal',1],['entry',2]]);
 const mine=await call(a,'GET',null,'?since=0');assert.deepEqual(mine.body.records.map(r=>r.id),['g1','e1']);assert.equal(mine.body.rev,2);assert.deepEqual(mine.body.records[1].record,entry);
 const theirs=await call(b,'GET',null,'?since=0');assert.deepEqual(theirs.body.records.map(r=>r.id),['g1']);
 assert.equal((await call(a,'GET',null,'?since=2')).body.records.length,0);
 assert.doesNotMatch(JSON.stringify(app.env.DB.raw.prepare('SELECT data FROM journal').all()),/JOURNAL-SECRET|Heron/);
 // The other pilot can neither read nor replace the entry.
 const steal=await call(b,'POST',{changes:[{kind:'entry',id:'e1',base:2,record:{...entry,body:'mine now'}}]});
 assert.deepEqual(steal.body.denied,[{kind:'entry',id:'e1'}]);assert.deepEqual(steal.body.conflicts,[]);
 assert.equal((await app.request('/api/journal')).status,401);
});
test('journal sync: a stale base is a conflict that returns the stored copy; deletes leave a tombstone; disconnect keeps the journal',async()=>{
 const {app,a,b,call}=await wingApp();
 await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:0,record:goal}]});
 const edit=await call(b,'POST',{changes:[{kind:'goal',id:'g1',base:1,record:{...goal,done:true}}]});assert.deepEqual(edit.body.applied,[{kind:'goal',id:'g1',rev:2}]);
 const stale=await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:1,record:{...goal,title:'Fly a Buzzard'}}]});
 assert.deepEqual(stale.body.applied,[]);assert.equal(stale.body.conflicts[0].rev,2);assert.equal(stale.body.conflicts[0].record.done,true);
 const twice=await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:0,record:goal}]});assert.equal(twice.body.conflicts[0].rev,2,'creating an id that exists is a conflict too');
 const gone=await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:2,record:null}]});assert.deepEqual(gone.body.applied,[{kind:'goal',id:'g1',rev:3}]);
 const seen=await call(b,'GET',null,'?since=2');assert.deepEqual(seen.body.records.map(r=>[r.id,r.record]),[['g1',null]]);
 assert.equal((await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:0,record:{...goal,title:'x'.repeat(200)}}]})).status,400);
 assert.equal((await call(a,'POST',{changes:[{kind:'entry',id:'other-id',base:0,record:entry}]})).status,400,'the record id must match');
 await app.request('/api/disconnect',{method:'POST',headers:{Authorization:`Bearer ${a}`}});
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM journal').get().n,1);
});
test('journal sync: a change based on a row the server no longer has is applied, not a 500, and purging never lowers the rev',async()=>{
 const {app,a,call}=await wingApp();
 const ghost=await call(a,'POST',{changes:[{kind:'entry',id:'e9',base:7,record:{...entry,id:'e9'}},{kind:'goal',id:'g9',base:3,record:null}]});
 assert.equal(ghost.status,200);assert.deepEqual(ghost.body.applied.map(x=>[x.id,x.rev]).sort(),[['e9',1],['g9',0]]);
 await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:0,record:goal}]});
 await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:2,record:null}]});
 app.env.DB.raw.prepare('UPDATE journal SET updated_at = 0').run();
 await cleanup(app.env);
 assert.deepEqual(app.env.DB.raw.prepare('SELECT id, rev FROM journal ORDER BY rev').all().map(r=>[r.id,r.rev]),[['e9',1],['g1',3]],'the newest tombstone stays');
 const next=await call(a,'POST',{changes:[{kind:'goal',id:'g2',base:0,record:{...goal,id:'g2'}}]});assert.equal(next.body.applied[0].rev,4);
});
test('journal sync keeps fields a newer build added and edit times, within the same size limits',async()=>{
 const {a,call,app}=await wingApp();
 const newer={...entry,updatedAt:1762000000000,mood:{stars:4,tags:['calm']}};
 assert.equal((await call(a,'POST',{changes:[{kind:'entry',id:'e1',base:0,record:newer}]})).status,200);
 assert.deepEqual((await call(a,'GET',null,'?since=0')).body.records[0].record,newer,'mood is not stripped');
 assert.equal((await call(a,'POST',{changes:[{kind:'entry',id:'e2',base:0,record:JSON.parse('{"id":"e2","title":"t","pilot":"p","date":"2026-11-01","body":"b","__proto__":{"x":1}}')}]})).status,400,'no prototype keys');
 assert.equal((await call(a,'POST',{changes:[{kind:'entry',id:'e2',base:0,record:{...entry,id:'e2',x:'x'.repeat(EXTRA_MAX)}}]})).status,400,'extras are capped per record');
 assert.equal((await call(a,'POST',{changes:[{kind:'entry',id:'e2',base:0,record:{...entry,id:'e2',updatedAt:'yesterday'}}]})).status,400);
 // The biggest valid batch still fits under the body limit, and a body over it is refused even without Content-Length.
 const big=Array.from({length:JOURNAL_CHANGES},(_,i)=>({kind:'entry',id:`big${i}`,base:0,record:{...entry,id:`big${i}`,body:'x'.repeat(20000),x:'y'.repeat(EXTRA_MAX-20)}}));
 const full=await call(a,'POST',{changes:big});assert.equal(full.status,200);assert.equal(full.body.applied.length,JOURNAL_CHANGES);
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({changes:[],pad:'z'.repeat(2000001)})));c.close();}});
 const res=await app.request('/api/journal',{method:'POST',headers:{Authorization:`Bearer ${a}`,'Content-Type':'application/json'},body,duplex:'half'});
 assert.equal(res.status,413);
});
const explored={id:`explored:${id}`,marks:{30000142:1762000000000,30003504:1762100000000}};
const haul={id:`haul:${id}`,stops:['Jita','Amarr'],value:'100000000',volume:'5000',avoid:'Uedama',updatedAt:1762000000000};
test('journal sync: a pilot\'s prefs reach only that pilot, only clients that ask, and only the pilot named in the id can write them',async()=>{
 const {app,a,b,call}=await wingApp();
 const put=await call(a,'POST',{changes:[{kind:'pref',id:explored.id,base:0,record:explored},{kind:'pref',id:haul.id,base:0,record:haul},{kind:'goal',id:'g1',base:0,record:goal}]});
 assert.equal(put.status,200);assert.deepEqual(put.body.applied.map(x=>[x.id,x.rev]),[[explored.id,1],[haul.id,2],['g1',3]]);
 const mine=await call(a,'GET',null,'?since=0&prefs=1');assert.deepEqual(mine.body.records.map(r=>r.id),[explored.id,haul.id,'g1']);assert.deepEqual(mine.body.records[1].record,haul);
 const old=await call(a,'GET',null,'?since=0');assert.deepEqual(old.body.records.map(r=>r.id),['g1'],'an older client never sees prefs');assert.equal(old.body.rev,3);
 assert.deepEqual((await call(b,'GET',null,'?since=0&prefs=1')).body.records.map(r=>r.id),['g1']);
 assert.doesNotMatch(JSON.stringify(app.env.DB.raw.prepare("SELECT data FROM journal WHERE kind = 'pref'").all()),/Uedama|30003504/);
 // B can't write A's prefs, even with a fresh id.
 assert.equal((await call(b,'POST',{changes:[{kind:'pref',id:haul.id,base:2,record:{...haul,stops:['Rens','Hek']}}]})).status,403);
 assert.equal((await call(b,'POST',{changes:[{kind:'pref',id:'haul:999',base:0,record:{...haul,id:'haul:999'}}]})).status,403);
 // A stale base returns the stored copy for the browser to merge.
 const stale=await call(a,'POST',{changes:[{kind:'pref',id:haul.id,base:0,record:{...haul,updatedAt:5}}]});assert.equal(stale.body.conflicts[0].rev,2);assert.deepEqual(stale.body.conflicts[0].record,haul);
 const next=await call(a,'POST',{changes:[{kind:'pref',id:haul.id,base:2,record:{...haul,stops:['Rens','Hek'],extra:'dropped'}}]});assert.deepEqual(next.body.applied,[{kind:'pref',id:haul.id,rev:4}]);
 assert.equal((await call(a,'GET',null,'?since=3&prefs=1')).body.records[0].record.extra,undefined,'unknown fields are not stored');
});
test('journal sync: prefs are validated per kind with size caps, and never deleted',async()=>{
 const {call,a}=await wingApp();const send=async(record,extra={})=>(await call(a,'POST',{changes:[{kind:'pref',id:record?.id??explored.id,base:0,record,...extra}]})).status;
 assert.equal(await send(null),400);
 assert.equal(await send({...explored,marks:{Jita:1}}),400);assert.equal(await send({...explored,marks:{30000142:-1}}),400);assert.equal(await send({...explored,marks:[1]}),400);
 assert.equal(await send({...explored,marks:Object.fromEntries(Array.from({length:1001},(_,i)=>[30000000+i,1]))}),400,'at most 1000 marks');
 assert.equal(await send({...haul,updatedAt:undefined}),400);assert.equal(await send({...haul,stops:Array(51).fill('Jita')}),400);assert.equal(await send({...haul,avoid:'x'.repeat(2001)}),400);
 assert.equal(await send({id:`notes:${id}`,text:'x'}),400,'unknown pref names are refused');
 assert.equal(await send({...explored,id:`explored:${id}`},{id:`haul:${id}`}),400,'the record id must match');
 assert.equal(await send(explored),200);
});
test('migration 0005 widens the journal kinds and keeps every row and rev',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(sql.split('-- Journal kind \'pref\'')[0]);
 db.prepare("INSERT INTO journal VALUES ('entry','e1',?,'cipher',7,1,?)").run(id,id);
 assert.throws(()=>db.prepare("INSERT INTO journal VALUES ('pref','haul:1',1,'x',8,1,1)").run(),/CHECK/);
 db.exec(await readFile(new URL('../worker/migrations/0005_journal_prefs.sql',import.meta.url),'utf8'));
 assert.deepEqual({...db.prepare('SELECT * FROM journal').get()},{kind:'entry',id:'e1',owner:id,data:'cipher',rev:7,updated_at:1,updated_by:id});
 db.prepare("INSERT INTO journal VALUES ('pref','haul:1',1,'x',8,1,1)").run();
 assert.throws(()=>db.prepare("INSERT INTO journal VALUES ('note','n',1,'x',9,1,1)").run(),/CHECK/);
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'journal_rev'").get(),'the rev index is back');
});
test('responses to the app keep Vary: Authorization next to Origin, preflights are cached, and ESI calls identify the app',async()=>{
 const app=setup();await connect(app);
 const res=await app.request('/api/market',{headers:{Origin:'https://matheusfiorin.github.io'}});
 assert.match(res.headers.get('Vary'),/Authorization/);assert.match(res.headers.get('Vary'),/Origin/);
 const pre=await app.request('/api/journal',{method:'OPTIONS',headers:{Origin:'https://matheusfiorin.github.io'}});assert.equal(pre.headers.get('Access-Control-Max-Age'),'7200');
 const esi=app.calls.find(c=>c.url.includes('esi.evetech.net'));assert.match(esi.init.headers['User-Agent'],/Echelon/);
});
// ESI caching in the pilot sync.
const characterCalls=(app,from)=>app.calls.slice(from).filter(c=>/\/characters\/\d+\//.test(c.url));
const snap=app=>JSON.parse(app.env.DB.raw.prepare('SELECT snapshot FROM pilots WHERE character_id = ?').get(id).snapshot);
test('ESI calls use unversioned routes with a pinned compatibility date and a user agent',async()=>{
 const app=setup();await connect(app);
 const esi=app.calls.filter(c=>c.url.startsWith('https://esi.evetech.net/'));assert.ok(esi.length>=13);
 for(const c of esi){assert.doesNotMatch(c.url,/\/latest\//);assert.equal(c.init.headers['X-Compatibility-Date'],ESI_COMPAT);assert.match(c.init.headers['User-Agent'],/Echelon/);}
 assert.match(ESI_COMPAT,/^\d{4}-\d\d-\d\d$/);
});
test('a sync skips endpoints whose Expires has not passed and keeps their stored data',async()=>{
 const options={cache:{ttl:path=>/\/(location|ship)\/$/.test(path)?-1000:3600000}},app=setup(options);await connect(app);
 const first=snap(app);assert.ok(first.esi.wallet.expires>Date.now()+3000000);assert.equal(first.esi.wallet.etag,'"/characters/2124810474/wallet/"');
 const before=app.calls.length;await syncPilot(id,app.env,app.fetchImpl,{force:true});
 assert.deepEqual(characterCalls(app,before).map(c=>new URL(c.url).pathname.split('/').at(-2)).sort(),['location','ship'],'only the expired endpoints are asked');
 const second=snap(app);
 assert.deepEqual(second.operations.assets,first.operations.assets);assert.equal(second.operations.wallet.value,12345678.25);assert.deepEqual(second.skills,first.skills);assert.equal(second.operations.journal.value.length,50);
 const res=await app.request('/api/session',{headers:{Authorization:`Bearer ${(await connect(app)).bearer}`}});assert.equal((await res.json()).esi,undefined,'cache hints are not sent to the browser');
});
test('after Expires a sync sends If-None-Match and reuses stored data on 304, without reading asset pages again',async()=>{
 const options={cache:{ttl:()=>-1000}},app=setup(options);await connect(app);
 const first=snap(app);options.cache.unchanged=true;
 const before=app.calls.length;const row=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(row.last_error,null);
 const calls=characterCalls(app,before);assert.equal(calls.length,13+EXTRAS.length);
 for(const c of calls)assert.equal(c.init.headers['If-None-Match'],`"${new URL(c.url).pathname}"`);
 assert.ok(!calls.some(c=>c.url.includes('page=2')),'an unchanged first page means unchanged assets');
 const second=snap(app);
 for(const key of ['wallet','assets','journal','mining','clones'])assert.deepEqual(second.operations[key].value,first.operations[key].value,key);
 assert.deepEqual(second.queue,first.queue);assert.deepEqual(second.skills,first.skills);assert.equal(second.esi.wallet.etag,first.esi.wallet.etag);
});
test('a 429 from ESI keeps the last good data and holds the pilot\'s ESI calls until Retry-After',async()=>{
 const options={},app=setup(options);await connect(app);const first=snap(app);
 options.limitPath='/wallet/';const started=Date.now();
 const row=await syncPilot(id,app.env,app.fetchImpl,{force:true});
 assert.ok(row.esi_after>=started+120000&&row.esi_after<=Date.now()+120000,'held for Retry-After');
 const second=snap(app);assert.equal(second.operations.wallet.value,first.operations.wallet.value,'the last wallet stays');assert.match(second.operations.wallet.error,/rate limit/);
 const before=app.calls.length;options.limitPath=null;
 await syncPilot(id,app.env,app.fetchImpl,{force:true});await syncPilot(id,app.env,app.fetchImpl);
 assert.equal(app.calls.length,before,'nothing is asked of EVE meanwhile, not even a token');
 app.env.DB.raw.prepare('UPDATE pilots SET esi_after = ?').run(Date.now()-1);
 const back=await syncPilot(id,app.env,app.fetchImpl,{force:true});assert.equal(back.esi_after,0);assert.equal(snap(app).operations.wallet.error,undefined);
});
test('a 420 error limit backs off for X-ESI-Error-Limit-Reset, and a low remaining budget stops the sync early',async()=>{
 const options={},app=setup(options);await connect(app);const first=snap(app);
 const limited=(url,init)=>new URL(url).pathname.endsWith('/skills/')?Promise.resolve(new Response('{}',{status:420,headers:{'X-ESI-Error-Limit-Remain':'0','X-ESI-Error-Limit-Reset':'30'}})):app.fetchImpl(url,init);
 const t=Date.now(),row=await syncPilot(id,app.env,limited,{force:true});
 assert.ok(row.esi_after>=t+30000&&row.esi_after<=Date.now()+30000);assert.deepEqual(snap(app).skills,first.skills,'skills kept');
 app.env.DB.raw.prepare('UPDATE pilots SET esi_after = 0').run();
 options.remaining=ESI_FLOOR-1;const before=app.calls.length;
 const low=await syncPilot(id,app.env,app.fetchImpl,{force:true});
 const asked=characterCalls(app,before).length;assert.ok(asked<=4,`stopped after the first answers (${asked} asked)`);
 assert.equal(low.esi_after,0,'a low budget is not a hold');
 const kept=snap(app);for(const key of ['wallet','assets','journal','clones'])assert.deepEqual(kept.operations[key].value,first.operations[key].value,key);
});
test('assets are not mixed from two copies: a page newer than page 1 keeps the previous summary',async()=>{
 const app=setup();await connect(app);const first=snap(app).operations.assets.value;
 let n=0;const shifting=async(url,init)=>{const r=await app.fetchImpl(url,init);if(!new URL(url).pathname.endsWith('/assets/'))return r;const h=new Headers(r.headers);h.set('Last-Modified',new Date(Date.UTC(2026,10,13,10,n++)).toUTCString());return new Response(r.body,{status:r.status,headers:h});};
 await syncPilot(id,app.env,shifting,{force:true});const assets=snap(app).operations.assets;
 assert.deepEqual(assets.value,first);assert.match(assets.error,/changed while/);
});
// The cron's kills and jumps sample (item: the pipeline no longer keeps this history).
const H=3600000,T0=Date.UTC(2026,10,13,12,0,0);
const feeds=(modified,kills=[{system_id:30000142,ship_kills:3,pod_kills:1,npc_kills:5},{system_id:30002813,ship_kills:2,pod_kills:0,npc_kills:0}],jumps=[{system_id:30000142,ship_jumps:900},{system_id:30002813,ship_jumps:40}])=>({kills,jumps,modified,expires:modified+H});
const activityDoc=app=>app.env.DB.raw.prepare("SELECT * FROM market_docs WHERE name = 'activity'").get();
test('the cron samples ESI kills and jumps into decayed 24 h / 7 day history, once per new hour',async()=>{
 const options={feeds:feeds(T0)},app=setup(options);
 const map={systems:{30000142:['Jita',0.946,10000002,[],0],30002813:['Tama',0.3,10000002,[],0],30004000:['Null',-0.4,10000060,[],0]}};
 app.env.DB.raw.prepare('INSERT INTO market_snapshots VALUES (1, ?, 1)').run(JSON.stringify(map));
 options.feeds.kills.push({system_id:30004000,ship_kills:9,pod_kills:0,npc_kills:0});
 const first=await sampleActivity(app.env,app.fetchImpl,T0+60000);assert.equal(first.sampled,true);assert.equal(first.expires,T0+H,'next when ESI has a new hour');
 let d=JSON.parse(activityDoc(app).data);
 assert.deepEqual(d.risk.s,{30000142:[3,3],30002813:[2,2],30004000:[9,9]});assert.deepEqual(d.traffic.s,{30000142:900,30002813:40});
 assert.deepEqual(d.activity,{30000142:[4,5,900],30002813:[2,0,40]},'last hour only for high- and low-sec, as the pipeline did');
 // Same hour again: ESI answers 304 to the ETag, nothing is counted twice.
 const calls=app.calls.length,again=await sampleActivity(app.env,app.fetchImpl,T0+120000);assert.equal(again.sampled,false);
 assert.ok(app.calls.slice(calls).every(c=>c.init.headers['If-None-Match']));assert.deepEqual(JSON.parse(activityDoc(app).data),d);
 // An hour later: the old sums decay and the new hour is added.
 options.feeds=feeds(T0+H,[{system_id:30000142,ship_kills:1,pod_kills:0,npc_kills:0}],[{system_id:30000142,ship_jumps:100}]);
 await sampleActivity(app.env,app.fetchImpl,T0+H+60000);d=JSON.parse(activityDoc(app).data);
 assert.ok(Math.abs(d.risk.s[30000142][0]-Math.round((3*Math.exp(-1/24)+1)*100)/100)<0.011);assert.ok(Math.abs(d.risk.s[30000142][1]-Math.round((3*Math.exp(-1/168)+1)*100)/100)<0.011);
 assert.equal(d.traffic.s[30000142],Math.round(900*Math.exp(-1/24)+100));assert.equal(d.risk.since,T0+60000);
 assert.deepEqual(d.activity,{30000142:[1,0,100]});
});
test('a failed feed keeps its history and is asked again after Retry-After; the other feed still counts',async()=>{
 const options={feeds:{...feeds(T0),fail:'kills'}},app=setup(options);
 const r=await sampleActivity(app.env,app.fetchImpl,T0);assert.equal(r.sampled,true);assert.ok(r.expires>=Date.now()+590000,'Retry-After 600 s');
 const d=JSON.parse(activityDoc(app).data);assert.equal(d.risk,undefined);assert.deepEqual(d.traffic.s,{30000142:900,30002813:40});
 options.feeds={...feeds(T0)};await sampleActivity(app.env,app.fetchImpl,T0+600000);
 const e=JSON.parse(activityDoc(app).data);assert.deepEqual(e.risk.s[30000142],[3,3]);assert.deepEqual(e.traffic,d.traffic,'the jumps hour is not counted twice');
});
test('a cron run that samples syncs no pilot, and the pilot whose turn it took goes next',async()=>{
 const options={feeds:feeds(Date.now()-60000)},app=setup(options);await connect(app);const other=2124815118;
 app.env.DB.raw.prepare("INSERT INTO pilots (character_id, name, credentials, snapshot, share_training) SELECT ?, 'Decxus', credentials, snapshot, 1 FROM pilots WHERE character_id = ?").run(other,id);
 const key=app.env.TOKEN_ENCRYPTION_KEY,copy=await decrypt(app.env.DB.raw.prepare('SELECT credentials FROM pilots WHERE character_id = ?').get(id).credentials,key,P);
 app.env.DB.raw.prepare('UPDATE pilots SET credentials = ? WHERE character_id = ?').run(await encrypt(copy,key,`pilot:${other}`),other);
 app.env.DB.raw.prepare('UPDATE pilots SET updated_at = 0').run();
 let before=app.calls.length;const synced=()=>[...new Set(app.calls.slice(before).map(c=>Number(c.url.match(/characters\/(\d+)\//)?.[1])).filter(Boolean))];
 const tick=n=>n*SYNC_EVERY;
 await scheduledSync(app.env,app.fetchImpl,tick(100));
 assert.deepEqual(synced(),[],'no pilot this run');assert.deepEqual(app.calls.slice(before).map(c=>new URL(c.url).pathname).sort(),['/universe/system_jumps/','/universe/system_kills/']);
 assert.equal(activityDoc(app).turns,1);assert.ok(activityDoc(app).expires_at>=Date.now()+SAMPLE_EVERY-1000);
 before=app.calls.length;await scheduledSync(app.env,app.fetchImpl,tick(101));assert.deepEqual(synced(),[id],'Fiofka had tick 100, so she goes at 101');
 app.env.DB.raw.prepare('UPDATE pilots SET updated_at = 0').run();
 before=app.calls.length;await scheduledSync(app.env,app.fetchImpl,tick(102));assert.deepEqual(synced(),[other]);
});
// Migration 0007 moves the pipeline's history and static meta without losing either.
const LEGACY_META={generatedAt:'2026-11-13T10:00:00Z',types:{34:{n:'Tritanium',v:0.01}},recipes:{},regions:{10000002:'The Forge'},starters:[{type:587}],skillNames:{3327:'Spaceship Command'},
 ores:[{n:'Veldspar',ore:1230}],combat:{sb:[1],dictor:[2]},skills:{industry:3380},activity:{30000142:[1,2,3]},risk:{at:T0,since:T0-86400000,s:{30000142:[4,9]}},traffic:{at:T0,since:T0-86400000,s:{30000142:500}}};
const MAP={systems:{30000142:['Jita',0.946,10000002,[30000144],0]},stations:[],regions:{10000002:'The Forge'},constellations:{}};
function legacyDb(){
 const db=new DatabaseSync(':memory:');db.exec(sql.split('-- Market documents the Worker keeps')[0]);
 db.prepare('INSERT INTO market_snapshots VALUES (0, ?, ?)').run(JSON.stringify(LEGACY_META),T0+5);db.prepare('INSERT INTO market_snapshots VALUES (1, ?, ?)').run(JSON.stringify(MAP),T0+4);
 db.prepare('INSERT INTO market_snapshots VALUES (10000002, ?, ?)').run(JSON.stringify({name:'The Forge',types:{}}),Date.now());
 return db;
}
test('migration 0007 moves the pipeline\'s kill and jump history and static meta into documents, and old clients see the same market',async()=>{
 const db=legacyDb();const before={meta:LEGACY_META,universe:MAP};
 db.exec(await readFile(new URL('../worker/migrations/0007_market_docs.sql',import.meta.url),'utf8'));
 const live=JSON.parse(db.prepare("SELECT data FROM market_docs WHERE name = 'activity'").get().data);
 assert.deepEqual(live,{risk:LEGACY_META.risk,traffic:LEGACY_META.traffic,activity:LEGACY_META.activity});
 const fixed=db.prepare("SELECT version, data FROM market_docs WHERE name = 'universe'").get();assert.deepEqual(JSON.parse(fixed.data),{ores:LEGACY_META.ores,combat:LEGACY_META.combat,skills:LEGACY_META.skills});assert.ok(fixed.version);
 assert.deepEqual(Object.keys(JSON.parse(db.prepare('SELECT data FROM market_snapshots WHERE region_id = 0').get().data)).sort(),['generatedAt','recipes','regions','skillNames','starters','types']);
 // The new Worker on the migrated rows: an old client's /api/market is what the old Worker served.
 const app=setup();app.env.DB=database(db);
 const old=await(await app.request('/api/market')).json();
 assert.deepEqual(old.meta.data,before.meta);assert.deepEqual(old.universe,before.universe);assert.equal(old.meta.updatedAt,T0+5);
 // And the cron's first sample builds on the pipeline's history rather than starting over.
 const options={feeds:feeds(T0+H)};const sampler=setup(options);
 await sampleActivity(app.env,sampler.fetchImpl,T0+H);
 const next=JSON.parse(db.prepare("SELECT data FROM market_docs WHERE name = 'activity'").get().data);
 assert.equal(next.risk.since,T0-86400000);assert.ok(next.risk.s[30000142][1]>9);assert.equal(next.traffic.s[30000142],Math.round(500*Math.exp(-1/24)+900));
});
test('a pipeline still sending kill history only replaces the cron\'s copy when it is newer, and the sampler adopts a newer pipeline copy',async()=>{
 const app=setup(),token=await pipelineToken(app.env.EVE_CLIENT_SECRET);
 const ingest=body=>app.request('/api/market/ingest',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 app.env.DB.raw.prepare("INSERT INTO market_docs (name, data, updated_at) VALUES ('activity', ?, 1)").run(JSON.stringify({risk:{at:T0,since:T0,s:{1:[5,5]}},traffic:{at:T0,since:T0,s:{}}}));
 await ingest({region:0,data:{types:{},risk:{at:T0-H,since:T0-H,s:{1:[1,1]}}}});
 assert.deepEqual(JSON.parse(activityDoc(app).data).risk.s,{1:[5,5]},'an older copy is ignored');
 assert.equal(JSON.parse(app.env.DB.raw.prepare('SELECT data FROM market_snapshots WHERE region_id = 0').get().data).risk,undefined,'and never stored with the meta');
 await ingest({region:0,data:{types:{},risk:{at:T0+H,since:T0,s:{1:[7,7]}},traffic:{at:T0+H,since:T0,s:{1:3}},activity:{1:[1,0,3]}}});
 assert.deepEqual(JSON.parse(activityDoc(app).data),{risk:{at:T0+H,since:T0,s:{1:[7,7]}},traffic:{at:T0+H,since:T0,s:{1:3}},activity:{1:[1,0,3]}});
 // An old Worker wrote a newer pipeline copy straight into the meta row during the deploy: the next sample uses it.
 app.env.DB.raw.prepare('UPDATE market_snapshots SET data = ? WHERE region_id = 0').run(JSON.stringify({types:{},risk:{at:T0+2*H,since:T0,s:{1:[9,9]}}}));
 const options={feeds:feeds(T0+3*H,[],[])};await sampleActivity(app.env,setup(options).fetchImpl,T0+3*H);
 assert.ok(Math.abs(JSON.parse(activityDoc(app).data).risk.s[1][0]-Math.round(9*Math.exp(-1/24)*100)/100)<0.011);
});
// /api/market: ETag and 304, and the versioned universe document.
async function marketApp(){
 const app=setup();const {bearer}=await connect(app);const token=await pipelineToken(app.env.EVE_CLIENT_SECRET);
 const ingest=body=>app.request('/api/market/ingest',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 for(const body of [{region:1,data:MAP},{region:0,data:LEGACY_META},{region:10000002,data:{name:'The Forge',types:{}}},{region:10000020,data:{name:'Tash-Murkon',types:{}}}])assert.equal((await ingest(structuredClone(body))).status,200);
 return {app,bearer,ingest};
}
test('/api/market sends an ETag and answers a matching If-None-Match with 304 before reading the big rows',async()=>{
 const {app,bearer,ingest}=await marketApp();
 const first=await app.request('/api/market?v=2');assert.equal(first.status,200);const tag=first.headers.get('ETag');assert.match(tag,/^W\/".+"$/);
 const queries=[],prepare=app.env.DB.prepare;app.env.DB.prepare=q=>{queries.push(q);return prepare.call(app.env.DB,q);};
 const again=await app.request('/api/market?v=2',{headers:{'If-None-Match':tag,Origin:'https://matheusfiorin.github.io'}});
 assert.equal(again.status,304);assert.equal(await again.text(),'');assert.equal(again.headers.get('ETag'),tag);assert.match(again.headers.get('Cache-Control'),/^public/);
 assert.equal(again.headers.get('Access-Control-Allow-Origin'),'https://matheusfiorin.github.io');
 assert.ok(!queries.some(q=>/SELECT[^]*\bdata\b[^]*FROM market_snapshots/.test(q)),'no stored data was read');
 app.env.DB.prepare=prepare;
 const signed=await app.request('/api/market?v=2',{headers:{Authorization:`Bearer ${bearer}`,'If-None-Match':tag}});assert.equal(signed.status,200,'the signed-in view has its own ETag');assert.notEqual(signed.headers.get('ETag'),tag);
 assert.notEqual((await app.request('/api/market')).headers.get('ETag'),tag,'old clients\' full view too');
 await ingest({region:10000002,data:{name:'The Forge',types:{34:{d:1,s:[]}}}});
 const changed=await app.request('/api/market?v=2',{headers:{'If-None-Match':tag}});assert.equal(changed.status,200);assert.notEqual(changed.headers.get('ETag'),tag);
 const fresh=changed.headers.get('ETag');app.env.DB.raw.prepare("UPDATE market_docs SET updated_at = updated_at + 1 WHERE name = 'activity'").run();
 assert.equal((await app.request('/api/market?v=2',{headers:{'If-None-Match':fresh}})).status,200,'a new kills sample is a new view');
});
test('the split market response leaves the universe to a versioned document, and old clients still get everything inline',async()=>{
 const {app,bearer}=await marketApp();
 const split=await(await app.request('/api/market?v=2')).json();
 assert.equal(split.universe,null);assert.match(split.universeVersion,/^[\w-]{16}$/);
 for(const key of STATIC_META)assert.equal(split.meta.data[key],undefined,`${key} is in the universe document`);
 assert.deepEqual(split.meta.data.risk,LEGACY_META.risk);assert.deepEqual(split.meta.data.starters,LEGACY_META.starters);assert.deepEqual(split.regions.map(r=>r.region),[10000002]);
 const doc=await app.request(`/api/market/universe?v=${split.universeVersion}`);assert.equal(doc.status,200);
 assert.match(doc.headers.get('Cache-Control'),/max-age=31536000, immutable/);assert.equal(doc.headers.get('Vary'),null);
 const universe=await doc.json();assert.equal(universe.version,split.universeVersion);assert.deepEqual(universe.universe,MAP);assert.deepEqual(universe.meta,{ores:LEGACY_META.ores,combat:LEGACY_META.combat,skills:LEGACY_META.skills});
 assert.equal((await app.request(`/api/market/universe?v=${split.universeVersion}`,{headers:{'If-None-Match':doc.headers.get('ETag')}})).status,304);
 assert.match((await app.request('/api/market/universe?v=old')).headers.get('Cache-Control'),/max-age=300/,'an unknown version is not cached for long');
 // Merged, the split view is exactly what an old client gets.
 const old=await(await app.request('/api/market')).json();
 const {universeVersion,...rest}=split;
 assert.deepEqual(old,{...rest,universe:universe.universe,meta:{...split.meta,data:{...universe.meta,...split.meta.data}}});
 const privateOld=await(await app.request('/api/market',{headers:{Authorization:`Bearer ${bearer}`}})).json();assert.deepEqual(privateOld.regions.map(r=>r.region),[10000002,10000020]);
 assert.ok(!JSON.stringify(universe).includes('Tash-Murkon'),'the public universe document holds no pilot region');
});
test('the universe version changes only when the map or the static meta changes; a run without static data keeps the last',async()=>{
 const {app,ingest}=await marketApp();const version=async()=>(await(await app.request('/api/market?v=2')).json()).universeVersion;
 const v1=await version();
 await ingest(structuredClone({region:1,data:MAP}));await ingest(structuredClone({region:0,data:{...LEGACY_META,generatedAt:'later',types:{}}}));
 assert.equal(await version(),v1,'same content, same version');
 await ingest({region:0,data:{types:{},recipesError:'Blueprint data unavailable'}});assert.equal(await version(),v1);
 assert.deepEqual((await(await app.request('/api/market')).json()).meta.data.ores,LEGACY_META.ores,'the last ores stay');
 await ingest({region:1,data:{...MAP,regions:{10000002:'The Forge',10000043:'Domain'}}});const v2=await version();assert.notEqual(v2,v1);
 await ingest({region:0,data:{types:{},ores:[{n:'Scordite',ore:1228}]}});const v3=await version();assert.notEqual(v3,v2);
 assert.deepEqual((await(await app.request(`/api/market/universe?v=${v3}`)).json()).meta.ores,[{n:'Scordite',ore:1228}]);
});
test('joinObjects splices JSON objects without parsing them',()=>{
 assert.deepEqual(JSON.parse(joinObjects('{"a":1}',null,'{}',' {"b":[1,2]} ','{"a":3}')),{a:3,b:[1,2]});assert.equal(joinObjects(),'{}');
});

// ---- Observability, pipeline signing, rate limits, Delete my data, freshness, cron (items 6 and 7) ----
const LOGS=[];logger.sink=line=>LOGS.push(line);
const signedHeaders=(secret,method,path,body='',now=Date.now())=>signPipelineRequest(secret,method,path,body,now);
const ingestSigned=async(app,body,{path='/api/market/ingest',now,tamper,secret='pipeline-secret'}={})=>{
 const text=JSON.stringify(body),headers=await signedHeaders(secret,'POST',path,text,now);
 return app.request('/api/market/ingest',{method:'POST',headers,body:tamper?text.replace('Forge','Fargo'):text});
};
test('the pipeline signs each request: ts|method|path|body digest within a 5 minute window',async()=>{
 const app=setup();app.env.PIPELINE_SECRET='pipeline-secret';const forge={region:10000002,data:{name:'The Forge',types:{}}};
 assert.equal((await ingestSigned(app,forge)).status,200);
 // Everything the signature covers is checked, and the old fixed token no longer works once PIPELINE_SECRET is set.
 assert.equal((await ingestSigned(app,forge,{now:Date.now()-6*60000})).status,401,'a replay after the window');
 assert.equal((await ingestSigned(app,forge,{now:Date.now()+6*60000})).status,401,'a timestamp from the future');
 assert.equal((await ingestSigned(app,forge,{now:Date.now()-4*60000})).status,200,'inside the window');
 assert.equal((await ingestSigned(app,forge,{tamper:true})).status,401,'another body');
 assert.equal((await ingestSigned(app,forge,{path:'/api/market/regions'})).status,401,'a signature made for another route');
 assert.equal((await ingestSigned(app,forge,{secret:'other'})).status,401);
 const legacy=await pipelineToken(app.env.EVE_CLIENT_SECRET);
 assert.equal((await app.request('/api/market/ingest',{method:'POST',headers:{Authorization:`Bearer ${legacy}`},body:JSON.stringify(forge)})).status,401,'the legacy token is refused');
 assert.equal((await app.request('/api/market/ingest',{method:'POST',body:JSON.stringify(forge)})).status,401);
 assert.equal((await app.request('/api/market/ingest',{method:'POST',headers:{'X-Pipeline-Timestamp':String(Date.now()),'X-Pipeline-Signature':'x'.repeat(43)},body:JSON.stringify(forge)})).status,401);
 // GETs are signed too (empty body).
 assert.equal((await app.request('/api/market/regions',{headers:await signedHeaders('pipeline-secret','GET','/api/market/regions')})).status,200);
 assert.equal((await app.request('/api/market/survey',{headers:await signedHeaders('pipeline-secret','GET','/api/market/regions')})).status,401);
});
test('without PIPELINE_SECRET the legacy token still works and logs a warning',async()=>{
 const app=setup();LOGS.length=0;const token=await pipelineToken(app.env.EVE_CLIENT_SECRET);
 const res=await app.request('/api/market/ingest',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({region:10000002,data:{name:'The Forge',types:{}}})});
 assert.equal(res.status,200);assert.ok(LOGS.some(l=>JSON.parse(l).what==='pipeline-legacy-token'));
 // A request signed for a Worker that has no PIPELINE_SECRET is not accepted either.
 const text=JSON.stringify({region:10000002,data:{types:{}}});
 assert.equal((await app.request('/api/market/ingest',{method:'POST',headers:await signedHeaders('pipeline-secret','POST','/api/market/ingest',text),body:text})).status,401);
});
test('the pipeline script signs the way the Worker verifies',async()=>{
 const headers=await signPipelineRequest('s3cret','post','/api/market/ingest','{"a":"é"}',1762000000000);
 assert.equal(headers['X-Pipeline-Timestamp'],'1762000000000');
 assert.equal(headers['X-Pipeline-Signature'],createHmac('sha256','s3cret').update(`1762000000000|POST|/api/market/ingest|${createHash('sha256').update('{"a":"é"}').digest('base64url')}`).digest('base64url'));
});
test('ingest accepts only known regions and well-shaped data, and measures its body in bytes',async()=>{
 const app=setup();const token=await pipelineToken(app.env.EVE_CLIENT_SECRET);
 const send=body=>app.request('/api/market/ingest',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:typeof body==='string'?body:JSON.stringify(body)});
 for(const region of [0,1,2,10000002,10000001,10000043,10001000,11000005])assert.equal((await send({region,data:region===1?{systems:{},stations:[]}:{types:{}}})).status,200,`region ${region}`);
 for(const region of [-1,3,999,10000000,10001001,10999999,12000000,2**40,1.5,'10000002',null])assert.equal((await send({region,data:{types:{}}})).status,400,`region ${region}`);
 assert.equal((await send({region:10000002,data:[]})).status,400);
 assert.equal((await send({region:10000002,data:{types:[]}})).status,400,'types must be an object');
 assert.equal((await send({region:10000002,data:{name:'x'.repeat(101),types:{}}})).status,400);
 assert.equal((await send({region:10000002,data:{types:Object.fromEntries(Array.from({length:INGEST_TYPES+1},(_,i)=>[i,{}]))}})).status,400,'too many types');
 assert.equal((await send({region:1,data:{systems:[]}})).status,400);
 assert.equal((await send({region:2,data:{done:[]}})).status,400);
 // 1,000,000 two-byte characters is under 1.9 million characters but over 1.9 million bytes.
 const big=JSON.stringify({region:10000002,data:{name:'é'.repeat(1000000)}});assert.ok(big.length<1900000&&new TextEncoder().encode(big).length>1900000);
 assert.equal((await send(big)).status,413);
 assert.equal((await send('not json')).status,400);
});
function limiter(allow){const keys=[];return {keys,limit:async({key})=>{keys.push(key);return {success:keys.length<=allow};}};}
test('rate limits are a no-op without the binding, fail open when it breaks, and answer 429 when it says no',async()=>{
 const app=setup();
 for(let i=0;i<30;i++)assert.equal((await app.request(`/auth/start?pilot=${id}`)).status,200);
 const page=await app.request(`/auth/start?pilot=${id}`),csrf=(await page.text()).match(/name="csrf" value="([^"]+)"/)[1],cookie=page.headers.get('Set-Cookie').split(';')[0];
 const post=()=>app.request('/auth/start',{method:'POST',headers:{Origin:'https://api.example',Cookie:cookie,'CF-Connecting-IP':'203.0.113.9'},body:new URLSearchParams({pilot:String(id),csrf,share:'yes'})});
 app.env.RATE_AUTH={limit:async()=>{throw new Error('binding down');}};assert.equal((await post()).status,303,'a broken binding never blocks');
 const auth=app.env.RATE_AUTH=limiter(1);assert.equal((await post()).status,303);
 const blocked=await post();assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'60');
 assert.deepEqual(auth.keys,['203.0.113.9','203.0.113.9'],'keyed by CF-Connecting-IP');
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n,2,'a refused request writes nothing');
 // Public market reads share one limiter; the journal has its own, keyed by session.
 const market=app.env.RATE_MARKET=limiter(2);
 assert.equal((await app.request('/api/market',{headers:{'CF-Connecting-IP':'198.51.100.1'}})).status,200);
 assert.equal((await app.request('/api/market/universe')).status,404,'under the limit: the real answer (no universe stored yet)');
 assert.equal((await app.request('/api/market')).status,429);assert.equal((await app.request('/api/market/universe')).status,429);assert.equal((await app.request('/health/freshness')).status,429);
 assert.equal(market.keys[0],'198.51.100.1');assert.equal(market.keys[1],'unknown','no address header, still one shared key');
 const journal=setup();const b2=(await connect(journal)).bearer;
 const jl=journal.env.RATE_JOURNAL=limiter(1);const get=()=>journal.request('/api/journal?since=0',{headers:{Authorization:`Bearer ${b2}`}});
 assert.equal((await get()).status,200);assert.equal((await get()).status,429);assert.ok(!jl.keys.join().includes(b2),'the session token is not the key');assert.equal(new Set(jl.keys).size,1);
});
test('small endpoints cap their bodies',async()=>{
 const app=setup();const {bearer}=await connect(app);
 const page=await app.request(`/auth/start?pilot=${id}`),cookie=page.headers.get('Set-Cookie').split(';')[0];
 const start=await app.request('/auth/start',{method:'POST',headers:{Origin:'https://api.example',Cookie:cookie},body:'x'.repeat(5000)});assert.equal(start.status,413);
 const waypoints=body=>app.request('/api/waypoints',{method:'POST',headers:{Authorization:`Bearer ${bearer}`},body});
 assert.equal((await waypoints(JSON.stringify({systems:[30000142],pad:'é'.repeat(3000)}))).status,413,'3000 two-byte characters are 6000 bytes');
 assert.equal((await waypoints(JSON.stringify({systems:[30000142]}))).status,200);
});
test('the consent page names journal sync and the market scan, states the public sharing plainly, and leaves wing sharing unticked',async()=>{
 const app=setup();const text=await (await app.request(`/auth/start?pilot=${id}`)).text();
 assert.match(text,/Journal sync/);assert.match(text,/market of the region you are in/);assert.match(text,/visible on the public two-pilot dashboard, to anyone/);assert.match(text,/Delete my data/);
 assert.match(text,/<input type="checkbox" name="share" value="yes" required>/);
 const wing=text.match(/<input type="checkbox" name="wing"[^>]*>/)[0];assert.doesNotMatch(wing,/checked/);assert.doesNotMatch(wing,/required/);
 const kept=setup();await connect(kept,{wing:false});assert.equal(kept.env.DB.raw.prepare('SELECT share_wing FROM pilots').get().share_wing,0);
});
test('Delete my data removes the journal, prefs, grant, pilot and sessions; goals and the wingmate stay',async()=>{
 const {app,a,b,call}=await wingApp();
 assert.equal((await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:0,record:goal},{kind:'entry',id:'e1',base:0,record:entry},{kind:'pref',id:explored.id,base:0,record:explored}]})).status,200);
 assert.equal((await call(b,'POST',{changes:[{kind:'entry',id:'e2',base:0,record:{...entry,id:'e2',pilot:'Decxus'}}]})).status,200);
 const forget=(bearer,body)=>app.request('/api/forget',{method:'POST',headers:{Authorization:`Bearer ${bearer}`},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await app.request('/api/forget',{method:'POST'})).status,401);assert.equal((await app.request('/api/forget',{headers:{Authorization:`Bearer ${a}`}})).status,405);
 const before=app.calls.length;
 const res=await forget(a);assert.equal(res.status,200);assert.deepEqual(await res.json(),{forgotten:true,revoked:true,goals:false});
 assert.ok(app.calls.slice(before).some(c=>c.url.endsWith('/oauth/revoke')&&String(c.init.body).includes('private-rotating-refresh-token')),'EVE is asked to revoke the grant');
 const rows=app.env.DB.raw.prepare('SELECT kind, id, owner, data FROM journal ORDER BY rev').all();
 assert.ok(!rows.some(r=>r.id==='e1'&&r.data),'the entry is gone');assert.ok(!rows.some(r=>r.kind==='pref'&&r.data),'the prefs are gone');
 assert.ok(rows.some(r=>r.id==='g1'&&r.data&&r.owner===0),'the wing goal stays');assert.ok(rows.some(r=>r.id==='e2'&&r.data),'the wingmate\'s entry stays');
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots WHERE character_id = ?').get(id).n,0);
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE character_id = ?').get(id).n,0);
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots WHERE character_id = ?').get(other).n,1);
 assert.equal((await app.request('/api/session',{headers:{Authorization:`Bearer ${a}`}})).status,401,'the session is gone');
 // Revs never go back, so the other pilot's device keeps its place.
 const next=await call(b,'POST',{changes:[{kind:'entry',id:'e3',base:0,record:{...entry,id:'e3',pilot:'Decxus'}}]});assert.ok(next.body.applied[0].rev>3);
});
test('Delete my data: wing goals go only when asked and confirmed, as tombstones the wingmate learns of',async()=>{
 const {app,a,b,call}=await wingApp();
 await call(a,'POST',{changes:[{kind:'goal',id:'g1',base:0,record:goal},{kind:'entry',id:'e1',base:0,record:entry}]});
 const forget=body=>app.request('/api/forget',{method:'POST',headers:{Authorization:`Bearer ${a}`},body:JSON.stringify(body)});
 assert.equal((await forget({goals:true})).status,400,'unconfirmed');
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots').get().n,2);
 assert.equal((await app.request('/api/forget',{method:'POST',headers:{Authorization:`Bearer ${a}`},body:'{nope'})).status,400);
 assert.equal((await forget({goals:true,confirm:true})).status,200);
 const seen=await call(b,'GET',null,'?since=0');assert.deepEqual(seen.body.records.map(r=>[r.id,r.record]),[['g1',null]],'the goal is a tombstone');
});
test('Delete my data waits for a running sync like Disconnect, and a pilot who never synced is still removed',async()=>{
 const app=setup();const {bearer}=await connect(app);
 app.env.DB.raw.prepare('UPDATE pilots SET sync_lock_until = ?').run(Date.now()+60000);
 const real=globalThis.setTimeout;globalThis.setTimeout=(fn)=>real(fn,0);
 try{assert.equal((await app.request('/api/forget',{method:'POST',headers:{Authorization:`Bearer ${bearer}`}})).status,409);}finally{globalThis.setTimeout=real;}
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pilots').get().n,1,'nothing was deleted');
});
const age=(app,sql,...values)=>app.env.DB.raw.prepare(sql).run(...values);
async function freshApp(){
 const app=setup();await connect(app);const now=Date.now();
 age(app,'INSERT INTO market_snapshots (region_id, data, updated_at) VALUES (0, ?, ?), (10000002, ?, ?), (10000043, ?, ?)','{}',now-600000,'{}',now-300000,'{}',now-900000);
 age(app,"INSERT INTO market_docs (name, data, updated_at) VALUES ('activity', '{}', ?), ('universe', '{}', ?)",now-1200000,now-30*86400000);
 return app;
}
test('/health/freshness reports ages only, 200 when fresh',async()=>{
 const app=await freshApp();const res=await app.request('/health/freshness');assert.equal(res.status,200);
 const body=await res.json();assert.equal(body.ok,true);assert.deepEqual(body.problems,[]);
 assert.ok(Math.abs(body.market.metaAge-600)<5);assert.equal(body.market.hubs.count,2);assert.ok(Math.abs(body.market.hubs.oldestAge-900)<5);assert.ok(body.market.universeAge>86400,'an old universe document is not an outage');
 assert.ok(Math.abs(body.activityAge-1200)<5);assert.deepEqual(body.pilots.map(p=>[p.pilot,p.error]),[[1,false]]);assert.ok(body.pilots[0].syncAge<60);
 const text=JSON.stringify(body);for(const secret of [String(id),'Fiofka','30000142','Private ship'])assert.ok(!text.includes(secret),`${secret} stays out`);
 assert.deepEqual(Object.keys(body.pilots[0]).sort(),['error','pilot','syncAge']);
 assert.equal(res.headers.get('Cache-Control'),'no-store');
});
test('/health/freshness is 503 for old market data, an old activity sample, a pilot not synced for an hour or missing data',async()=>{
 const H=3600000,now=Date.now(),check=async(fix)=>{const app=await freshApp();fix(app);const res=await app.request('/health/freshness');return {status:res.status,body:await res.json()};};
 let r=await check(app=>age(app,'UPDATE market_snapshots SET updated_at = ? WHERE region_id = 0',now-3*H-60000));assert.equal(r.status,503);assert.deepEqual(r.body.problems,['market']);
 r=await check(app=>age(app,'UPDATE market_snapshots SET updated_at = ? WHERE region_id = 10000043',now-4*H));assert.deepEqual(r.body.problems,['market'],'a stale hub row counts as market data');
 r=await check(app=>age(app,"UPDATE market_docs SET updated_at = ? WHERE name = 'activity'",now-2*H-60000));assert.equal(r.status,503);assert.deepEqual(r.body.problems,['activity']);
 r=await check(app=>age(app,'UPDATE pilots SET updated_at = ?',now-H-60000));assert.equal(r.status,503);assert.deepEqual(r.body.problems,['pilot 1']);
 r=await check(app=>age(app,'UPDATE pilots SET updated_at = NULL'));assert.deepEqual(r.body.problems,['pilot 1'],'never synced');
 r=await check(app=>age(app,"DELETE FROM market_docs WHERE name = 'activity'"));assert.deepEqual(r.body.problems,['activity']);assert.equal(r.body.activityAge,null);
 r=await check(app=>age(app,'DELETE FROM market_snapshots'));assert.deepEqual(r.body.problems,['market']);
 r=await check(app=>age(app,'UPDATE pilots SET last_error = ?','Some EVE data could not be refreshed.'));assert.equal(r.status,200);assert.equal(r.body.pilots[0].error,true,'an error flag alone is not an outage');
 r=await check(app=>age(app,'UPDATE pilots SET updated_at = ?, grant_revoked_at = ?',now-5*H,now));assert.equal(r.status,200,'a revoked grant waits for the pilot to reconnect');assert.equal(r.body.pilots[0].error,true);
 // No pilot connected: nothing to be late.
 r=await check(app=>age(app,'DELETE FROM pilots'));assert.equal(r.status,200);assert.deepEqual(r.body.pilots,[]);
});
test('the daily cron cleans up, any other cron syncs, and each logs one structured line',async()=>{
 const app=setup();await connect(app);sampled(app);
 const raw=app.env.DB.raw;raw.prepare('INSERT INTO sessions (token_hash, character_id, expires_at) VALUES (?, ?, ?)').run('old',id,1);raw.prepare('INSERT INTO oauth_states (state_hash, payload, expires_at) VALUES (?, ?, ?)').run('old','x',1);
 raw.prepare("INSERT INTO journal (kind, id, owner, data, rev, updated_at, updated_by) VALUES ('entry','dead',?,NULL,1,0,?),('entry','top',?,NULL,2,0,?)").run(id,id,id,id);
 LOGS.length=0;const before=app.calls.length;
 const daily=await scheduled({cron:DAILY_CRON,scheduledTime:Date.now()},app.env,Date.now(),app.fetchImpl);
 assert.deepEqual(daily,{job:'cleanup'});assert.equal(app.calls.length,before,'cleanup asks EVE for nothing');
 assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get('old').n,0);assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n,0);
 assert.deepEqual(raw.prepare('SELECT id FROM journal').all().map(r=>r.id),['top'],'old tombstones go, the newest stays');
 assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash != ?').get('old').n>0,true,'live sessions stay');
 // The 5 minute cron no longer deletes.
 raw.prepare('INSERT INTO sessions (token_hash, character_id, expires_at) VALUES (?, ?, ?)').run('old2',id,1);
 const sync=await scheduled({cron:'*/5 * * * *',scheduledTime:Date.now()},app.env,Date.now(),app.fetchImpl);
 assert.deepEqual(sync,{job:'sync',pilot:'ok'});assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get('old2').n,1);
 const events=LOGS.map(l=>JSON.parse(l));assert.deepEqual(events.map(e=>[e.e,e.job]),[['cron','cleanup'],['cron','sync']]);
 for(const e of events)assert.equal(typeof e.ms,'number');
});
test('cron logs say which job ran and whether the pilot sync and the kills sample worked, and never who or where',async()=>{
 const T0=Date.parse('2026-11-14T12:00:00Z');
 const app=setup({feeds:{kills:[{system_id:30000142,ship_kills:3,pod_kills:0,npc_kills:1}],jumps:[{system_id:30000142,ship_jumps:9}],modified:T0,expires:T0+3600000}});await connect(app);
 LOGS.length=0;
 assert.deepEqual(await scheduled({cron:'*/5 * * * *'},app.env,T0,app.fetchImpl),{job:'sample',kills:'ok'},'no sample stored yet: the first run samples');
 const down=setup({feeds:{fail:'kills',kills:[],jumps:[],modified:T0,expires:T0+3600000}});
 assert.deepEqual(await scheduled({cron:'*/5 * * * *'},down.env,T0,down.fetchImpl),{job:'sample',kills:'failed'});
 const failing=setup({revoked:true});await connect(failing);sampled(failing);
 failing.env.DB.raw.prepare('UPDATE pilots SET sync_lock_until = 0, updated_at = 0, last_error = NULL, credentials = ?').run(await encrypt({accessToken:'a',refreshToken:'r',expires:1,scopes:[]},failing.env.TOKEN_ENCRYPTION_KEY,P));
 assert.deepEqual(await scheduled({cron:'*/5 * * * *'},failing.env,Date.now(),failing.fetchImpl),{job:'sync',pilot:'failed'});
 const text=LOGS.join('\n');for(const secret of [String(id),'Fiofka','30000142','private-rotating','Bearer'])assert.ok(!text.includes(secret),`${secret} stays out of the logs`);
 const empty=setup();sampled(empty);assert.deepEqual(await scheduled({cron:'*/5 * * * *'},empty.env,Date.now(),empty.fetchImpl),{job:'sync',pilot:'none'});
 const boom=setup();boom.env.DB={prepare(){throw new Error('db down');},batch(){throw new Error('db down');}};LOGS.length=0;
 await assert.rejects(scheduled({cron:DAILY_CRON},boom.env));assert.equal(JSON.parse(LOGS[0]).failed,true);
});
test('each request logs its route, status and duration, and nothing about who or where',async()=>{
 const app=setup();const {bearer}=await connect(app);LOGS.length=0;
 await app.request('/health');await app.request(`/api/journal?since=0&secret=zzz`,{headers:{Authorization:`Bearer ${bearer}`,'CF-Connecting-IP':'203.0.113.7'}});await app.request('/api/session',{headers:{Authorization:'Bearer nope'}});await app.request('/some/odd/path/with-token-abc');
 const events=LOGS.map(l=>JSON.parse(l));
 assert.deepEqual(events.map(e=>[e.route,e.status]),[['/health',200],['/api/journal',200],['/api/session',401],['other',404]]);
 for(const e of events){assert.deepEqual(Object.keys(e).sort(),['e','method','ms','route','status']);assert.equal(typeof e.ms,'number');}
 const text=LOGS.join('\n');for(const secret of [bearer,'zzz','203.0.113.7','token-abc',String(id)])assert.ok(!text.includes(secret),`${secret} stays out`);
});
test('migration 0008 indexes the cleanup and Delete my data lookups',async()=>{
 const app=setup();const names=app.env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(r=>r.name);
 for(const n of ['oauth_states_expiry','sessions_character','journal_owner','journal_tombstones'])assert.ok(names.includes(n),n);
});

// ── Orders, contracts, losses, blueprints, planets, standings, the current fit and Discord alerts ──
const NEW_SCOPES=['esi-markets.read_character_orders.v1','esi-contracts.read_character_contracts.v1','esi-killmails.read_killmails.v1','esi-characters.read_blueprints.v1','esi-planets.manage_planets.v1','esi-characters.read_standings.v1'];
const hoursFromNow=h=>new Date(Date.now()+h*3600000).toISOString();
const WEBHOOK='https://discord.com/api/webhooks/123456/abc-DEF_ghi';
const expire=async app=>{const row=app.env.DB.raw.prepare('SELECT * FROM pilots').get();const c=await decrypt(row.credentials,app.env.TOKEN_ENCRYPTION_KEY,P);c.expires=0;app.env.DB.raw.prepare('UPDATE pilots SET credentials = ?, updated_at = 0, sync_lock_until = 0').run(await encrypt(c,app.env.TOKEN_ENCRYPTION_KEY,P));};
const readyJob=(job_id,extra={})=>({job_id,activity_id:1,blueprint_type_id:1234,product_type_id:605,runs:1,status:'ready',end_date:hoursFromNow(-1),...extra});
test('the new scopes are requested, optional, and a pilot without them keeps working',async()=>{
 for(const scope of NEW_SCOPES){assert.ok(REQUESTED_SCOPES.includes(scope),scope);assert.ok(!SCOPES.includes(scope),`${scope} is not required`);}
 const app=setup({scopes:REQUESTED_SCOPES.filter(s=>!NEW_SCOPES.includes(s))});await connect(app);
 const got=snap(app);assert.equal(got.skills.total_sp,125000);
 for(const key of ['orders','orderHistory','contracts','killmails','blueprints','planets','standings'])assert.deepEqual(got.operations[key],{permission:false},key);
 assert.ok(!app.calls.some(c=>/\/(orders|contracts|killmails|blueprints|planets|standings)\//.test(c.url)),'nothing is asked without the scope');
});
test('a sync keeps compact orders, history, contracts, losses, blueprints, planets and standings, and only the ship\'s own items',async()=>{
 const issued=hoursFromNow(-48);
 const app=setup({
  fit:[{type_id:2977,quantity:1,location_id:1001,location_flag:'HiSlot0'},{type_id:5973,quantity:1,location_id:1001,location_flag:'MedSlot0'},{type_id:2454,quantity:2,location_id:1001,location_flag:'DroneBay'},{type_id:34,quantity:900,location_id:1002,location_flag:'HiSlot0'},{type_id:34,quantity:5,location_id:1001,location_flag:'Cargo'}],
  orders:[{order_id:1,type_id:34,location_id:60003760,region_id:10000002,is_buy_order:false,price:5.5,volume_remain:10,volume_total:50,issued,duration:90,range:'region',min_volume:1,escrow:0,junk:'x'}],
  history:[{order_id:2,type_id:35,location_id:60003760,region_id:10000002,is_buy_order:true,price:9,volume_remain:0,volume_total:10,issued,duration:30,range:'station'},{order_id:3,type_id:35,price:9,volume_remain:5,volume_total:10,issued:hoursFromNow(-24*80),duration:30,state:'expired'}],
  contracts:[{contract_id:7,type:'courier',status:'outstanding',issuer_id:id,assignee_id:0,date_issued:issued,date_expired:hoursFromNow(10),reward:1e6,collateral:5e7,volume:100,start_location_id:60003760,end_location_id:60000001,days_to_complete:3,availability:'public',title:'Haul'},{contract_id:8,type:'item_exchange',status:'deleted',issuer_id:id,date_issued:issued,date_expired:hoursFromNow(10)}],
  kills:[{killmail_id:1,killmail_hash:'aaa'},{killmail_id:2,killmail_hash:'bbb'}],
  blueprints:[{item_id:1,type_id:1234,quantity:-1,runs:-1,material_efficiency:10,time_efficiency:20},{item_id:2,type_id:1234,quantity:-2,runs:5,material_efficiency:0,time_efficiency:0}],
  planets:[{planet_id:40000001,planet_type:'lava',solar_system_id:30000142,upgrade_level:3,num_pins:4,last_update:issued}],
  standings:[{from_id:500001,from_type:'faction',standing:0.5},{from_id:3009,from_type:'agent',standing:-3.4}]});
 await connect(app);const got=snap(app).operations;
 assert.deepEqual(got.fit.value,{ship:1001,items:[[2977,'HiSlot0',1],[5973,'MedSlot0',1],[2454,'DroneBay',2],[34,'Cargo',5]]},'items of the ship only, no full asset list');
 assert.equal(got.orders.value[0].junk,undefined);assert.equal(got.orders.value[0].price,5.5);
 assert.deepEqual(got.orderHistory.value.map(o=>o.order_id),[2],'history older than 30 days is dropped');
 assert.deepEqual(got.contracts.value.map(c=>c.contract_id),[7]);assert.equal(got.contracts.value[0].collateral,5e7);
 assert.deepEqual(got.killmails.value.losses.map(l=>l.id),[1],'losses are the kills whose victim is the pilot');assert.deepEqual(got.killmails.value.seen,[2]);
 assert.equal(got.killmails.value.losses[0].corp,1000044);assert.equal(got.killmails.value.losses[0].attackers,2);
 assert.deepEqual(got.blueprints.value.types,[[1234,1,1,10,20,5]]);
 assert.equal(got.planets.value.planets[0].pins.ext[0][0],2268);assert.equal(got.planets.value.planets[0].pins.fac[0],121);
 assert.deepEqual(got.standings.value[0],[3009,'agent',-3.4]);
 const session=await(await app.request('/api/session',{headers:{Authorization:`Bearer ${(await connect(app)).bearer}`}})).json();
 for(const k of ['events','names','cursor','esi'])assert.equal(session[k],undefined,`${k} stays on the Worker`);
 assert.ok(JSON.stringify(got).length<60000,'the snapshot stays small');
});
test('killmails are read once: a later sync asks only for the ones it has not seen',async()=>{
 const options={kills:[{killmail_id:1,killmail_hash:'aaa'}],cache:{ttl:()=>-1000}},app=setup(options);await connect(app);
 const detail=()=>app.calls.filter(c=>/\/killmails\/\d+\/\w+\/$/.test(c.url)).length;assert.equal(detail(),1);
 options.kills=[{killmail_id:3,killmail_hash:'ccc'},{killmail_id:1,killmail_hash:'aaa'}];await expire(app);await syncPilot(id,app.env,app.fetchImpl,{force:true});
 assert.equal(detail(),2,'only the new one');assert.deepEqual(snap(app).operations.killmails.value.losses.map(l=>l.id).sort(),[1,3]);
});
test('the 50 subrequest limit holds in the worst case: token refresh, 20 asset pages, 10 new killmails, 12 planets, alerts to send',async()=>{
 const T0=Date.now();
 const options={assetPages:25,posts:[],typeNames:{605:'Venture',1234:'Venture Blueprint'},
  jobs:Array.from({length:8},(_,i)=>readyJob(i+1,{activity_id:5,product_type_id:1234})),
  kills:Array.from({length:10},(_,i)=>({killmail_id:i*2+1,killmail_hash:`h${i}`})),
  planets:Array.from({length:12},(_,i)=>({planet_id:40000001+i,planet_type:'lava',solar_system_id:30000142,upgrade_level:3,num_pins:4,last_update:hoursFromNow(-2)})),
  orders:[{order_id:1,type_id:34,location_id:60003760,region_id:10000002,is_buy_order:false,price:5.5,volume_remain:10,volume_total:50,issued:hoursFromNow(-48),duration:90}],
  contracts:[{contract_id:7,type:'courier',status:'outstanding',issuer_id:id,date_issued:hoursFromNow(-48),date_expired:hoursFromNow(5)}],
  blueprints:[{item_id:1,type_id:1234,quantity:-1,runs:-1,material_efficiency:10,time_efficiency:20}],standings:[{from_id:1,from_type:'faction',standing:1}]};
 const app=setup(options);app.env.DISCORD_WEBHOOK_URL=WEBHOOK;await connect(app);
 sampled(app);
 let worst=0;const seen=new Set();
 for(let run=0;run<8;run++){
  await expire(app);app.env.DB.raw.exec('DELETE FROM alerts'); // every alert is due again, and the access token must be refreshed
  const before=app.calls.length;await scheduledSync(app.env,app.fetchImpl,T0+run*SYNC_EVERY);
  const used=app.calls.length-before;worst=Math.max(worst,used);assert.ok(used<=50,`run ${run} made ${used} subrequests`);
  const ops=snap(app).operations;for(const key of Object.keys(ops))if(ops[key].value!==undefined)seen.add(key);
 }
 assert.ok(worst>=44,`the scenario really is a worst case (${worst})`);
 for(const key of ['orders','orderHistory','contracts','killmails','blueprints','planets','standings','fit'])assert.ok(seen.has(key),`${key} arrives within a few runs`);
 assert.equal(snap(app).operations.killmails.value.wait.length,0,'every killmail detail is read in the end');
 assert.ok(snap(app).operations.planets.value.planets.every(p=>p.pins),'every planet\'s pins are read in the end');
});
test('a stored cursor past the last extra wraps instead of failing',async()=>{
 const app=setup({});await connect(app);const first=snap(app);assert.ok(Number.isInteger(first.cursor));
 app.env.DB.raw.prepare('UPDATE pilots SET snapshot = ?').run(JSON.stringify({...first,cursor:99}));await expire(app);
 assert.equal((await syncPilot(id,app.env,app.fetchImpl,{force:true})).last_error,null);
});
test('contract items are read on demand, only for the caller\'s own contracts',async()=>{
 const app=setup({contracts:[{contract_id:7,type:'item_exchange',status:'outstanding',issuer_id:id,date_issued:hoursFromNow(-1),date_expired:hoursFromNow(48),price:1000}],contractItems:[{type_id:34,quantity:100,is_included:true,record_id:1,junk:1}]});
 const {bearer}=await connect(app);const headers={Authorization:`Bearer ${bearer}`};
 assert.equal((await app.request('/api/contract-items?id=7')).status,401);
 assert.ok(!app.calls.some(c=>/contracts\/7\/items/.test(c.url)),'the cron never reads items');
 const ok=await(await app.request('/api/contract-items?id=7',{headers})).json();assert.deepEqual(ok,{contractId:7,items:[{type_id:34,quantity:100,is_included:true}]});
 assert.equal((await app.request('/api/contract-items?id=8',{headers})).status,404,'not in the pilot\'s list');
 assert.equal((await app.request('/api/contract-items?id=abc',{headers})).status,400);
 assert.equal(app.calls.filter(c=>/contracts\/8\/items/.test(c.url)).length,0,'a stranger\'s contract id never reaches ESI');
 assert.equal(app.env.DB.raw.prepare('SELECT sync_lock_until AS l FROM pilots').get().l,0,'the lock is released');
 const courier=setup({contracts:[{contract_id:9,type:'courier',status:'outstanding',issuer_id:id,date_issued:hoursFromNow(-1),date_expired:hoursFromNow(48)}]});const c=await connect(courier);
 assert.deepEqual(await(await courier.request('/api/contract-items?id=9',{headers:{Authorization:`Bearer ${c.bearer}`}})).json(),{contractId:9,items:[]},'a courier contract has none');
 const old=setup({scopes:REQUESTED_SCOPES.filter(s=>!NEW_SCOPES.includes(s))});const o=await connect(old);
 old.env.DB.raw.prepare('UPDATE pilots SET snapshot = ?').run(JSON.stringify({operations:{contracts:{permission:true,value:[{contract_id:5}]}}}));
 assert.equal((await old.request('/api/contract-items?id=5',{headers:{Authorization:`Bearer ${o.bearer}`}})).status,403,'without the contracts scope');
});
test('the wing summary carries the current fit only at consent level 2',async()=>{
 const app=setup({fit:[{type_id:2977,quantity:1,location_id:1001,location_flag:'HiSlot0'}]});const {bearer}=await connect(app);
 const wing=async()=>(await(await app.request('/api/wing',{headers:{Authorization:`Bearer ${bearer}`}})).json()).pilots[0];
 app.env.DB.raw.prepare('UPDATE pilots SET share_wing = 2').run();assert.deepEqual((await wing()).fit,{ship:1001,items:[[2977,'HiSlot0',1]]});
 app.env.DB.raw.prepare('UPDATE pilots SET share_wing = 1').run();assert.equal((await wing()).fit.ship,1001,'the pilot always sees their own');
 const text=JSON.stringify(await(await app.request('/api/public/pilots')).json());assert.ok(!text.includes('2977'),'never public');
});
const alertApp=async(options={})=>{
 const o={posts:[],typeNames:{1234:'Venture Blueprint',34:'Tritanium',605:'Venture'},...options},app=setup(o);app.posts=o.posts;app.env.DISCORD_WEBHOOK_URL=WEBHOOK;await connect(app);app.env.DB.raw.exec('DELETE FROM alerts');return app;
};
test('Discord alerts: one message per new event, never repeated, and no place names',async()=>{
 const {sendAlerts}=await import('../worker/alerts.js');
 const app=await alertApp({
  jobs:[readyJob(1,{activity_id:5,product_type_id:1234,station_id:60003760})],
  contracts:[{contract_id:7,type:'courier',status:'outstanding',issuer_id:id,date_issued:hoursFromNow(-48),date_expired:hoursFromNow(5),start_location_id:60003760}]});
 const first=await sendAlerts(app.env,app.fetchImpl);
 const texts=app.posts?.map(p=>p.content)||[];
 assert.equal(first.sent,3,texts.join('|'));
 assert.ok(texts.includes("Fiofka's job (Venture blueprint copy) is ready"),texts.join('|'));
 assert.ok(texts.some(t=>/^Fiofka's courier contract expires in \d+ h$/.test(t)),texts.join('|'));
 assert.ok(texts.some(t=>/^Fiofka's skill queue ends in \d+ h$/.test(t)),texts.join('|'));
 for(const t of texts)for(const place of ['Jita','60003760','30000142','Forge','Caldari'])assert.ok(!t.includes(place),`${place} stays out of "${t}"`);
 assert.equal((await sendAlerts(app.env,app.fetchImpl)).sent,0,'the same events are not sent twice');
 assert.equal(app.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM alerts').get().n,3);
});
test('Discord alerts: an empty queue, an outbid order, orders that ended, contracts that moved and a new loss',async()=>{
 const {sendAlerts}=await import('../worker/alerts.js');
 const old=hoursFromNow(-48),order=(order_id,extra={})=>({order_id,type_id:34,location_id:60003760,region_id:10000002,is_buy_order:false,price:7,volume_remain:10,volume_total:50,issued:old,duration:90,...extra});
 const options={posts:[],typeNames:{34:'Tritanium',605:'Venture'},orders:[order(1),order(2,{price:5})],kills:[],contracts:[{contract_id:7,type:'item_exchange',status:'outstanding',issuer_id:id,date_issued:old,date_expired:hoursFromNow(200)}]};
 const app=setup(options);app.env.DISCORD_WEBHOOK_URL=WEBHOOK;await connect(app);
 // The stored market says Tritanium sells at 5 in Jita: order 1 (7) is outbid, order 2 (5) is the best price.
 app.env.DB.raw.prepare('INSERT INTO market_snapshots (region_id, data, updated_at) VALUES (?, ?, ?)').run(10000002,JSON.stringify({name:'The Forge',types:{34:{d:1,s:[[60003760,5,100]],b:[]}}}),Date.now());
 app.env.DB.raw.prepare("UPDATE pilots SET snapshot = json_set(snapshot, '$.queue', json('[]'))").run();
 app.env.DB.raw.exec('DELETE FROM alerts');
 await sendAlerts(app.env,app.fetchImpl);
 const first=options.posts.splice(0).map(p=>p.content);
 assert.ok(first.includes("Fiofka's skill queue is empty"),first.join('|'));
 assert.ok(first.includes("Fiofka's sell order for Tritanium was outbid"),first.join('|'));
 assert.equal(first.filter(t=>/outbid/.test(t)).length,1,'only the order that is not the best');
 // Next sync: order 1 filled (in history), order 2 gone with no history, the contract accepted, a new loss.
 options.orders=[];options.history=[{...order(1),volume_remain:0}];options.contracts=[{contract_id:7,type:'item_exchange',status:'in_progress',issuer_id:id,date_issued:old,date_expired:hoursFromNow(200)}];options.kills=[{killmail_id:1,killmail_hash:'aaa'}];
 await expire(app);await syncPilot(id,app.env,app.fetchImpl,{force:true});
 await sendAlerts(app.env,app.fetchImpl);
 const second=options.posts.splice(0).map(p=>p.content);
 assert.ok(second.includes("Fiofka's sell order for Tritanium filled"),second.join('|'));
 assert.ok(second.includes("Fiofka's item exchange contract was accepted"),second.join('|'));
 assert.ok(second.includes('Fiofka lost a Venture'),second.join('|'));
 assert.ok(!second.some(t=>/outbid/.test(t)),'orders that are gone are not outbid');
 for(const t of [...first,...second])assert.ok(!/Jita|Forge|30000142/.test(t),t);
});
test('Discord alerts do nothing without the secret, reject a bad URL, release a key when the post fails, and cap a run',async()=>{
 const {sendAlerts,MAX_ALERTS}=await import('../worker/alerts.js');
 const plain=setup({posts:[],jobs:[readyJob(1)]});await connect(plain);
 const before=plain.calls.length;assert.deepEqual(await sendAlerts(plain.env,plain.fetchImpl),{sent:0,skipped:true});assert.equal(plain.calls.length,before,'no request at all');
 plain.env.DISCORD_WEBHOOK_URL='https://evil.example/hook';assert.equal((await sendAlerts(plain.env,plain.fetchImpl)).sent,0);assert.equal(plain.calls.length,before);
 const down=await alertApp({webhookStatus:500,jobs:[readyJob(1)]});
 const r=await sendAlerts(down.env,down.fetchImpl);assert.equal(r.sent,0);assert.equal(r.failed,1);assert.equal(down.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM alerts').get().n,0,'a failed post can be tried again');
 const many=await alertApp({jobs:Array.from({length:9},(_,i)=>readyJob(i+1))});
 assert.equal((await sendAlerts(many.env,many.fetchImpl)).sent,MAX_ALERTS);assert.equal((await sendAlerts(many.env,many.fetchImpl)).sent,MAX_ALERTS,'the rest follows on the next runs');
});
test('the cron sends alerts after its sync, and a failing webhook never fails the run',async()=>{
 const app=await alertApp({jobs:[readyJob(1)]});sampled(app);
 app.env.DB.raw.exec('UPDATE pilots SET updated_at = 0');
 const result=await scheduled({cron:'*/5 * * * *'},app.env,Date.now(),app.fetchImpl);
 assert.equal(result.job,'sync');assert.ok(result.alerts>=1);
 assert.ok(!/Fiofka|Venture/.test(JSON.stringify(result)),'the cron log names nobody');
 const bad=await alertApp({webhookStatus:500,jobs:[readyJob(1)]});sampled(bad);bad.env.DB.raw.exec('UPDATE pilots SET updated_at = 0');
 assert.equal((await scheduled({cron:'*/5 * * * *'},bad.env,Date.now(),bad.fetchImpl)).job,'sync');
});
test('the daily cleanup purges alert keys older than 30 days',async()=>{
 const app=setup();const now=Date.now();
 app.env.DB.raw.prepare('INSERT INTO alerts (key, sent_at) VALUES (?, ?)').run('old',now-31*86400000);app.env.DB.raw.prepare('INSERT INTO alerts (key, sent_at) VALUES (?, ?)').run('new',now-86400000);
 await cleanup(app.env,now);assert.deepEqual(app.env.DB.raw.prepare('SELECT key FROM alerts').all().map(r=>r.key),['new']);
});
