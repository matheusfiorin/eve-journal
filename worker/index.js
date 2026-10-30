import {REQUESTED_SCOPES,OPERATIONS_SCOPES,base64url,challenge,validateToken} from '../auth.js';

const EVE='https://login.eveonline.com';
const ESI='https://esi.evetech.net/latest';
const ALLOWED=new Map([[2124810474,'Fiofka'],[2124815118,'Decxus']]);
const SESSION_MS=24*60*60*1000;
const encoder=new TextEncoder();
class ServiceError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
function cookie(request,name){return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||'';}
const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash=async value=>base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
const authCookie=(name,value,seconds)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
function frontend(env){const u=new URL(env.FRONTEND_URL);if(u.protocol!=='https:')throw new ServiceError('Frontend configuration is invalid.',503);return u;}
function response(body,status=200,headers={}){
 return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
}
function html(body,status=200,headers={}){
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>EVE Pilot Console</title><style>body{background:#0a1019;color:#edf2f6;font:16px system-ui;max-width:620px;margin:60px auto;padding:24px;line-height:1.7}h1{line-height:1.2}button,a{color:#b9ee8d}button{background:#172b21;border:1px solid #b9ee8d;padding:14px;cursor:pointer;font:inherit}p,li{color:#b6c3d0}label{display:block;margin:20px 0}</style>${body}</html>`,{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://login.eveonline.com; frame-ancestors 'none'; base-uri 'none'",...headers}});
}
export async function encrypt(value,secret){
 const bytes=Uint8Array.from(atob(secret),c=>c.charCodeAt(0));
 if(bytes.length!==32)throw new ServiceError('Backend encryption is not configured.',503);
 const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(value)));
 return JSON.stringify({v:1,iv:base64url(iv),data:base64url(new Uint8Array(ciphertext))});
}
function unbase64(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
export async function decrypt(value,secret){
 const item=JSON.parse(value);if(item.v!==1)throw new ServiceError('Stored authorization could not be read.',503);
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),'AES-GCM',false,['decrypt']);
 const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(item.iv)},key,unbase64(item.data));
 return JSON.parse(new TextDecoder().decode(bytes));
}
async function remote(url,options,fetchImpl){
 const r=await fetchImpl(url,{...options,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new ServiceError(r.status===401||r.status===403?'EVE authorization expired or permission was declined.':r.status===429||r.status===420?'EVE rate limit reached. Try again later.':'EVE service is temporarily unavailable.',502);
 return r.json();
}
async function exchange(env,fields,fetchImpl){
 return remote(`${EVE}/v2/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:`Basic ${btoa(`${env.EVE_CLIENT_ID}:${env.EVE_CLIENT_SECRET}`)}`},body:new URLSearchParams(fields)},fetchImpl);
}
async function verify(access,env,id,fetchImpl){
 const keys=await remote(`${EVE}/oauth/jwks`,{},fetchImpl);
 try{return await validateToken(access,env.EVE_CLIENT_ID,id,keys.keys);}catch{throw new ServiceError('EVE authorization did not match this pilot, application, or requested permissions.',403);}
}
async function session(request,env){
 const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 if(!token)throw new ServiceError('Connect this pilot with EVE to access private data.',401);
 const row=await env.DB.prepare('SELECT token_hash, character_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await hash(token),Date.now()).first();
 if(!row)throw new ServiceError('This dashboard session expired. Connect the pilot again.',401);
 return row;
}
function parseSnapshot(row){try{return JSON.parse(row.snapshot);}catch{return {};}}
function privatePayload(row,sessionRow){
 return {characterId:row.character_id,name:row.name,expires:sessionRow.expires_at,...parseSnapshot(row),lastError:row.last_error};
}
export async function syncPilot(id,env,fetchImpl=fetch,{force=false}={}){
 const now=Date.now();
 const previous=await env.DB.prepare('SELECT * FROM pilots WHERE character_id = ?').bind(id).first();
 if(!previous)return null;
 if(!force&&previous.updated_at&&now-previous.updated_at<60000)return previous;
 const row=await env.DB.prepare('UPDATE pilots SET sync_lock_until = ? WHERE character_id = ? AND sync_lock_until < ? RETURNING *').bind(now+90000,id,now).first();
 if(!row)return previous;
 try {
  let credentials=await decrypt(row.credentials,env.TOKEN_ENCRYPTION_KEY);
  if(credentials.expires<Date.now()+60000){
   const refreshed=await exchange(env,{grant_type:'refresh_token',refresh_token:credentials.refreshToken},fetchImpl);
   const identity=await verify(refreshed.access_token,env,id,fetchImpl);
   credentials={accessToken:refreshed.access_token,refreshToken:refreshed.refresh_token||credentials.refreshToken,expires:identity.expires,scopes:identity.scopes};
   // Persist rotation before any ESI request; the prior refresh token may already be invalid.
   await env.DB.prepare('UPDATE pilots SET credentials = ? WHERE character_id = ? AND sync_lock_until = ?').bind(await encrypt(credentials,env.TOKEN_ENCRYPTION_KEY),id,now+90000).run();
  }
  const snapshot={fetchedAt:new Date().toISOString(),operations:{},errors:{}};
  const paths={skills:'skills/',queue:'skillqueue/',wallet:'wallet/',ship:'ship/',location:'location/',jobs:'industry/jobs/?include_completed=false'};
  const prior=parseSnapshot(row);
  await Promise.all(Object.entries(paths).map(async([key,path])=>{
   const optional=OPERATIONS_SCOPES[key];
   if(optional&&!credentials.scopes.includes(optional)){snapshot.operations[key]={permission:false};return;}
   try {
    const value=await remote(`${ESI}/characters/${id}/${path}`,{headers:{Authorization:`Bearer ${credentials.accessToken}`,Accept:'application/json'}},fetchImpl);
    if(optional)snapshot.operations[key]={permission:true,value,fetched:snapshot.fetchedAt};
    else snapshot[key]=value;
   }catch(error){
    if(optional)snapshot.operations[key]={...prior.operations?.[key],permission:true,error:error.message};
    else {if(prior[key]!==undefined)snapshot[key]=prior[key];snapshot.errors[key]=error.message;}
   }
  }));
  if(!snapshot.skills&&!snapshot.queue&&Object.keys(snapshot.errors).length)throw new ServiceError('Training data could not be refreshed. Previous snapshot retained.',502);
  const errors=Object.values(snapshot.errors);
  await env.DB.prepare('UPDATE pilots SET snapshot = ?, updated_at = ?, sync_lock_until = 0, last_error = ? WHERE character_id = ? AND sync_lock_until = ?').bind(JSON.stringify(snapshot),Date.now(),errors.length?'Some EVE data could not be refreshed.':null,id,now+90000).run();
 }catch(error){
  await env.DB.prepare('UPDATE pilots SET sync_lock_until = 0, last_error = ? WHERE character_id = ? AND sync_lock_until = ?').bind(error instanceof ServiceError?error.message:'Synchronization failed. Reconnect if the problem persists.',id,now+90000).run();
 }
 return env.DB.prepare('SELECT * FROM pilots WHERE character_id = ?').bind(id).first();
}
async function route(request,env,ctx,fetchImpl){
 const url=new URL(request.url),front=frontend(env);
 if(url.pathname==='/health'){
  let database=false;try{await env.DB.prepare('SELECT COUNT(*) AS count FROM pilots').first();database=true;}catch{}
  const ready=Boolean(database&&env.EVE_CLIENT_ID&&env.EVE_CLIENT_SECRET&&env.TOKEN_ENCRYPTION_KEY);
  return response({service:'eve-journal-api',ready,database,callback:`${url.origin}/auth/callback`},ready?200:503);
 }
 if(url.pathname==='/auth/start'&&request.method==='GET'){
  const id=Number(url.searchParams.get('pilot'));if(!ALLOWED.has(id))throw new ServiceError('This character is not in the configured two-pilot dashboard.',403);
  const csrf=random();
  return html(`<h1>Connect ${ALLOWED.get(id)}</h1><p>EVE Pilot Console will periodically read your EVE data.</p><ul><li>Your skill-point total and training queue will be visible on the public two-pilot dashboard.</li><li>Wallet, ship, location and industry jobs are visible only to your authorized dashboard session.</li><li>Refresh tokens are encrypted on the backend. You can disconnect and remove the stored authorization and snapshot.</li></ul><form method="post" action="/auth/start"><input type="hidden" name="pilot" value="${id}"><input type="hidden" name="csrf" value="${csrf}"><label><input type="checkbox" name="share" value="yes" required> I agree to share my skill total and training queue publicly.</label><button>Continue to EVE login</button></form><p><a href="${front.href}">Return to dashboard</a></p>`,200,{'Set-Cookie':authCookie('__Host-eve_csrf',csrf,600)});
 }
 if(url.pathname==='/auth/start'&&request.method==='POST'){
  if(request.headers.get('Origin')!==url.origin)throw new ServiceError('Invalid connection origin.',403);
  const fields=new URLSearchParams(await request.text());
  if(!fields.get('csrf')||fields.get('csrf')!==cookie(request,'__Host-eve_csrf')||fields.get('share')!=='yes')throw new ServiceError('Confirm sharing consent before connecting.',403);
  const id=Number(fields.get('pilot'));if(!ALLOWED.has(id))throw new ServiceError('Unknown pilot.',403);
  const state=random(),verifier=random();
  await env.DB.prepare('INSERT INTO oauth_states (state_hash, payload, expires_at) VALUES (?, ?, ?)').bind(await hash(state),await encrypt({id,verifier,share:true},env.TOKEN_ENCRYPTION_KEY),Date.now()+300000).run();
  const login=new URL(`${EVE}/v2/oauth/authorize/`);
  login.search=new URLSearchParams({response_type:'code',client_id:env.EVE_CLIENT_ID,redirect_uri:`${url.origin}/auth/callback`,scope:REQUESTED_SCOPES.join(' '),state,code_challenge:await challenge(verifier),code_challenge_method:'S256'});
  return new Response(null,{status:303,headers:{Location:login.href,'Cache-Control':'no-store','Set-Cookie':authCookie('__Host-eve_state',state,600),'Referrer-Policy':'no-referrer'}});
 }
 if(url.pathname==='/auth/callback'&&request.method==='GET'){
  const state=url.searchParams.get('state');
  if(!state||state!==cookie(request,'__Host-eve_state'))throw new ServiceError('EVE login state did not match. Start again.',403);
  const pending=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING payload').bind(await hash(state),Date.now()).first();
  if(!pending)throw new ServiceError('EVE login expired or was already used. Start again.',403);
  if(url.searchParams.has('error'))throw new ServiceError('EVE login was cancelled or declined.');
  const code=url.searchParams.get('code');if(!code)throw new ServiceError('EVE did not return an authorization code.');
  const payload=await decrypt(pending.payload,env.TOKEN_ENCRYPTION_KEY);
  const tokens=await exchange(env,{grant_type:'authorization_code',code,redirect_uri:`${url.origin}/auth/callback`,code_verifier:payload.verifier},fetchImpl);
  if(!tokens.refresh_token)throw new ServiceError('EVE did not return a refresh token. Reconnect the pilot.',502);
  const identity=await verify(tokens.access_token,env,payload.id,fetchImpl);
  const encrypted=await encrypt({accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expires:identity.expires,scopes:identity.scopes},env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare('INSERT INTO pilots (character_id, name, credentials, share_training) VALUES (?, ?, ?, 1) ON CONFLICT(character_id) DO UPDATE SET name = excluded.name, credentials = excluded.credentials, share_training = 1, sync_lock_until = 0').bind(payload.id,ALLOWED.get(payload.id),encrypted).run();
  const bearer=random(),expires=Date.now()+SESSION_MS;
  await env.DB.prepare('INSERT INTO sessions (token_hash, character_id, expires_at) VALUES (?, ?, ?)').bind(await hash(bearer),payload.id,expires).run();
  await syncPilot(payload.id,env,fetchImpl,{force:true});
  const dest=new URL(front);dest.hash=new URLSearchParams({backend_session:bearer,pilot:String(payload.id),expires:String(expires)}).toString();
  return new Response(null,{status:303,headers:{Location:dest.href,'Cache-Control':'no-store','Set-Cookie':authCookie('__Host-eve_state','',0),'Referrer-Policy':'no-referrer'}});
 }
 if(url.pathname==='/api/public/pilots'&&request.method==='GET'){
  const rows=await env.DB.prepare('SELECT character_id, name, snapshot, updated_at, last_error FROM pilots WHERE share_training = 1').all();
  return response({pilots:rows.results.filter(row=>ALLOWED.has(row.character_id)).map(row=>{
   const s=parseSnapshot(row);
   return {characterId:row.character_id,name:row.name,skills:s.skills?{total_sp:s.skills.total_sp}:null,queue:Array.isArray(s.queue)?s.queue.map(q=>({skill_id:q.skill_id,finished_level:q.finished_level,queue_position:q.queue_position,start_date:q.start_date,finish_date:q.finish_date})):[],fetchedAt:s.fetchedAt||null,stale:Boolean(row.last_error)};
  })});
 }
 if(['/api/session','/api/sync','/api/disconnect'].includes(url.pathname)){
  if(url.pathname==='/api/session'&&request.method!=='GET')throw new ServiceError('Method not allowed.',405);
  if(url.pathname!=='/api/session'&&request.method!=='POST')throw new ServiceError('Method not allowed.',405);
  const s=await session(request,env);
  let row=await env.DB.prepare('SELECT * FROM pilots WHERE character_id = ?').bind(s.character_id).first();
  if(!row)throw new ServiceError('This pilot is no longer connected.',401);
  if(url.pathname==='/api/disconnect'){
   try{
    const credentials=await decrypt(row.credentials,env.TOKEN_ENCRYPTION_KEY);
    await fetchImpl(`${EVE}/v2/oauth/revoke`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:`Basic ${btoa(`${env.EVE_CLIENT_ID}:${env.EVE_CLIENT_SECRET}`)}`},body:new URLSearchParams({token:credentials.refreshToken,token_type_hint:'refresh_token'}),signal:AbortSignal.timeout(15000)});
   }catch{ /* Local deletion still removes access and shared snapshots. */ }
   await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE character_id = ?').bind(row.character_id),env.DB.prepare('DELETE FROM pilots WHERE character_id = ?').bind(row.character_id)]);
   return response({disconnected:true});
  }
  if(url.pathname==='/api/sync')row=await syncPilot(row.character_id,env,fetchImpl);
  return response(privatePayload(row,s));
 }
 throw new ServiceError('Not found.',404);
}
export async function handleRequest(request,env,ctx={},fetchImpl=fetch){
 const origin=request.headers.get('Origin');
 let front;try{front=frontend(env);}catch{return response({error:'Backend configuration is incomplete.'},503);}
 if(origin&&origin!==front.origin&&origin!==new URL(request.url).origin)return response({error:'Origin is not allowed.'},403);
 const cors=origin===front.origin?{'Access-Control-Allow-Origin':front.origin,Vary:'Origin','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}:{};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 let result;
 try{result=await route(request,env,ctx,fetchImpl);}catch(error){result=response({error:error instanceof ServiceError?error.message:'Backend request failed. Try again later.'},error instanceof ServiceError?error.status:500);}
 const headers=new Headers(result.headers);for(const [key,value]of Object.entries(cors))headers.set(key,value);
 return new Response(result.body,{status:result.status,headers});
}
export async function scheduledSync(env,fetchImpl=fetch){
 await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(Date.now())]);
 const rows=await env.DB.prepare('SELECT character_id FROM pilots').all();
 for(const row of rows.results)if(ALLOWED.has(row.character_id))await syncPilot(row.character_id,env,fetchImpl);
}
export default {fetch:handleRequest,async scheduled(event,env,ctx){ctx.waitUntil(scheduledSync(env));}};
