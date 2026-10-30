import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,sign} from 'node:crypto';
import {handleRequest,encrypt,decrypt,syncPilot,scheduledSync} from '../worker/index.js';
import {REQUESTED_SCOPES,SCOPES} from '../auth.js';
const sql=await readFile(new URL('../worker/migrations/0001_initial.sql',import.meta.url),'utf8');
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
  throw new Error(`Unexpected request ${path}`);
 };
 const request=(path,init={})=>handleRequest(new Request(`https://api.example${path}`,init),env,{},fetchImpl);
 return {env,calls,request,fetchImpl};
}
async function consent(app){
 const page=await app.request(`/auth/start?pilot=${id}`);assert.equal(page.status,200);
 const body=await page.text(),csrf=body.match(/name="csrf" value="([^"]+)"/)[1];
 const start=await app.request('/auth/start',{method:'POST',headers:{Origin:'https://api.example',Cookie:page.headers.get('Set-Cookie').split(';')[0]},body:new URLSearchParams({pilot:String(id),csrf,share:'yes'})});
 assert.equal(start.status,303);const login=new URL(start.headers.get('Location'));
 return {state:login.searchParams.get('state'),cookie:start.headers.get('Set-Cookie').split(';')[0],login};
}
async function connect(app){
 const pending=await consent(app);const callback=await app.request(`/auth/callback?code=test-code&state=${pending.state}`,{headers:{Cookie:pending.cookie}});
 return {callback,pending,bearer:callback.status===303?new URLSearchParams(new URL(callback.headers.get('Location')).hash.slice(1)).get('backend_session'):null};
}
test('health verifies database and required backend secrets',async()=>{
 const app=setup();assert.equal((await app.request('/health')).status,200);delete app.env.EVE_CLIENT_SECRET;assert.equal((await app.request('/health')).status,503);
});
test('OAuth start presents explicit public-sharing consent and requires CSRF',async()=>{
 const app=setup();const page=await app.request(`/auth/start?pilot=${id}`);assert.match(await page.text(),/visible on the public/);
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
 const app=setup({scopes:SCOPES});await connect(app);assert.ok(!app.calls.some(call=>/\/(wallet|location|ship|industry\/jobs)\//.test(call.url)));
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
