import {REQUESTED_SCOPES,OPERATIONS_SCOPES,base64url,challenge,validateToken} from '../auth.js';
import {validateBackup,validatePref} from '../model.js';
import {history,lastHour} from './activity.js';
import {pipelineSignature,PIPELINE_WINDOW} from './pipeline-auth.js';
import {compactOrders,compactHistory,compactContracts,compactBlueprints,compactStandings,fitCollector,stackCollector,stacksCover,isStationId,stepKillmails,stepPlanets,diffEvents,trackOrders} from './pilotdata.js';
import {sendAlerts} from './alerts.js';

const EVE='https://login.eveonline.com';
// Unversioned ESI routes answer as they did on the compatibility date sent with each request
// (developers.eveonline.com/docs/services/esi/overview). Checked against ESI's changelog (read again on
// 2026-11-18, entries through 2026-09-03): after this date the breaking changes are new endpoints (access lists, mercenary
// dens, skyhooks, sovereignty, military campaigns, SKINR), characters/{id} and corporations/{id} (which the Worker never
// reads) and the route/ POST. None touches universe/names, characters/*/{assets, contracts, orders, orders/history,
// killmails/recent, planets, blueprints, standings, skills, skillqueue}, killmails/ or universe/system_{kills,jumps}; the
// 2026-01-27 skills changes are non-breaking. Move it forward only after reading the changelog again.
const ESI='https://esi.evetech.net';
export const ESI_COMPAT='2025-12-16';
// Below this many errors (X-ESI-Error-Limit-Remain) or rate-limit tokens (X-Ratelimit-Remaining) left, a sync stops
// asking and keeps the last good data for what it did not reach.
export const ESI_FLOOR=20;
const UA='Echelon wing console (Cloudflare Worker)';
const ALLOWED=new Map([[2124810474,'Fiofka'],[2124815118,'Decxus']]);
// The pipeline's trade hubs (scripts/market-pipeline.mjs HUBS). Any other market region is where a pilot is flying.
export const HUB_REGIONS=new Set([10000002,10000043,10000032,10000030,10000042]);
// Dashboard sessions slide: each day of use pushes expiry 30 days out, so an active browser never logs out.
const SESSION_MS=30*24*60*60*1000;
const encoder=new TextEncoder();
class ServiceError extends Error {
  constructor(message,status=400,extra={}){super(message);this.status=status;Object.assign(this,extra);}
}
function cookie(request,name){return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||'';}
// True when the browser says the request came from this worker's own origin.
// Some browsers/policies send `Origin: null` on same-origin form posts; Sec-Fetch-Site is browser-set and cannot be forged by page scripts.
function isSameOrigin(request,url){
 const origin=request.headers.get('Origin');
 if(origin===url.origin)return true;
 return origin==='null'&&request.headers.get('Sec-Fetch-Site')==='same-origin';
}
// Legacy pipeline credential: an HMAC of the EVE client secret. It never changes, so a captured copy works forever; it
// is accepted only while PIPELINE_SECRET is not set (see worker/README.md), then every request must be signed.
export async function pipelineToken(secret){
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('market-pipeline'))));
}
// bytes is the request body as received: the signature covers its digest.
async function requirePipeline(request,env,url,bytes=new Uint8Array(0)){
 if(env.PIPELINE_SECRET){
  const ts=request.headers.get('X-Pipeline-Timestamp')||'',given=request.headers.get('X-Pipeline-Signature')||'';
  if(!/^\d{10,15}$/.test(ts)||!/^[\w-]{43}$/.test(given)||Math.abs(Date.now()-Number(ts))>PIPELINE_WINDOW)throw new ServiceError('Pipeline authorization required.',401);
  const want=await pipelineSignature(env.PIPELINE_SECRET,{ts,method:request.method,path:url.pathname,bytes});
  if(await hash(given)!==await hash(want))throw new ServiceError('Pipeline authorization required.',401);
  return;
 }
 const given=request.headers.get('Authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1]||'';
 // Compare digests so the comparison time does not depend on the token.
 if(!env.EVE_CLIENT_SECRET||await hash(given)!==await hash(await pipelineToken(env.EVE_CLIENT_SECRET)))throw new ServiceError('Pipeline authorization required.',401);
 log({e:'warn',what:'pipeline-legacy-token'});
}
// One structured JSON line per event for Workers Logs. Never put tokens, character ids, names or locations in one.
export const logger={sink:line=>console.log(line)};
export const log=event=>{try{logger.sink(JSON.stringify(event));}catch{/* Logging never fails a request. */}};
// The body in bytes (a string's length counts UTF-16 units, so a multi-byte body could pass a character limit and still
// exceed a byte one), refused above max. Content-Length can be missing or wrong, so the body is measured as read.
async function readBytes(request,max,message){
 if(Number(request.headers.get('Content-Length'))>max)throw new ServiceError(message,413);
 const bytes=new Uint8Array(await request.arrayBuffer());
 if(bytes.byteLength>max)throw new ServiceError(message,413);
 return bytes;
}
const readText=async(request,max,message)=>new TextDecoder().decode(await readBytes(request,max,message));
// Cloudflare's Rate Limiting binding (ratelimits in the Worker config). Without the binding (tests, local runs) it is a
// no-op, and a failing binding never blocks a request. Keys are per client address (CF-Connecting-IP) per limiter.
async function limit(env,request,name,key){
 const binding=env[name];if(typeof binding?.limit!=='function')return;
 let ok=true;try{ok=(await binding.limit({key:key||request.headers.get('CF-Connecting-IP')||'unknown'})).success!==false;}catch{/* Fail open. */}
 if(!ok)throw new ServiceError('Too many requests. Try again in a minute.',429,{retryAfter:60});
}
const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash=async value=>base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));
const authCookie=(name,value,seconds)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
function frontend(env){const u=new URL(env.FRONTEND_URL);if(u.protocol!=='https:')throw new ServiceError('Frontend configuration is invalid.',503);return u;}
function response(body,status=200,headers={}){return jsonText(JSON.stringify(body),status,headers);}
function jsonText(text,status=200,headers={}){
 return new Response(text,{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
}
function html(body,status=200,headers={}){
 // 'same-origin' (not 'no-referrer') so the consent form's POST carries a real Origin header; nothing leaks cross-origin.
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>EVE Pilot Console</title><style>body{background:#0a1019;color:#edf2f6;font:16px system-ui;max-width:620px;margin:60px auto;padding:24px;line-height:1.7}h1{line-height:1.2}button,a{color:#b9ee8d}button{background:#172b21;border:1px solid #b9ee8d;padding:14px;cursor:pointer;font:inherit}p,li{color:#b6c3d0}label{display:block;margin:20px 0}</style>${body}</html>`,{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://login.eveonline.com; frame-ancestors 'none'; base-uri 'none'",...headers}});
}
// context names the row a blob belongs to (pilot:<id>, goal:<id>, entry:<id>, state:<hash>) and is bound in as
// AES-GCM additional data (v:2), so a blob copied into another row no longer decrypts. v:1 blobs, written before
// that, still decrypt without it and are rewritten as v:2 the next time their row is saved.
export async function encrypt(value,secret,context){
 const bytes=unbase64(secret);
 if(bytes.length!==32)throw new ServiceError('Backend encryption is not configured.',503);
 if(typeof context!=='string'||!context)throw new ServiceError('Backend encryption needs a context.',500);
 const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},key,encoder.encode(JSON.stringify(value)));
 return JSON.stringify({v:2,iv:base64url(iv),data:base64url(new Uint8Array(ciphertext))});
}
function unbase64(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
export async function decrypt(value,secret,context){
 const item=JSON.parse(value);if(item.v!==1&&!(item.v===2&&typeof context==='string'&&context))throw new ServiceError('Stored authorization could not be read.',503);
 const key=await crypto.subtle.importKey('raw',unbase64(secret),'AES-GCM',false,['decrypt']);
 const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(item.iv),...(item.v===2?{additionalData:encoder.encode(context)}:{})},key,unbase64(item.data));
 return JSON.parse(new TextDecoder().decode(bytes));
}
const REVOKED='EVE authorization expired or was revoked. Reconnect the pilot.',LIMITED='EVE rate limit reached. Try again later.';
// Retry-After is seconds or an HTTP date; returns when to try again, capped at an hour, or 0 if absent or garbled.
export function retryAt(header,now=Date.now()){
 if(!header)return 0;const s=Number(header),at=Number.isFinite(s)?now+s*1000:Date.parse(header);
 return Number.isFinite(at)&&at>now?Math.min(at,now+3600000):0;
}
// gauge (optional) collects what ESI says about its limits during one sync or sample: stop once either budget runs low.
async function fetchOk(url,options,fetchImpl,gauge){
 const esi=url.startsWith(ESI);
 // ESI asks every client to identify itself; Workers send no User-Agent of their own.
 const r=await fetchImpl(url,{...options,headers:{'User-Agent':UA,...(esi?{'X-Compatibility-Date':ESI_COMPAT}:{}),...options?.headers},signal:AbortSignal.timeout(20000)});
 if(esi&&gauge&&['X-ESI-Error-Limit-Remain','X-Ratelimit-Remaining'].some(h=>{const v=r.headers.get(h);return v!==null&&v!==''&&Number(v)<ESI_FLOOR;}))gauge.stop=true;
 if(r.status===304)return r;
 // The token endpoint answers a revoked or expired refresh token (or a reused code) with 400 invalid_grant: only reconnecting helps.
 if(r.status===400&&(await r.clone().json().catch(()=>null))?.error==='invalid_grant')throw new ServiceError(REVOKED,502,{revoked:true});
 // 429 is ESI's (or login's) rate limit, 420 ESI's error limit. Retry-After says when; ESI's 420 says it in
 // X-ESI-Error-Limit-Reset, and an ESI limit without either waits a minute.
 if(r.status===429||r.status===420){
  if(gauge)gauge.stop=true;
  throw new ServiceError(LIMITED,502,{retryAt:retryAt(r.headers.get('Retry-After'))||(esi?retryAt(r.headers.get('X-ESI-Error-Limit-Reset'))||Date.now()+60000:0)});
 }
 if(!r.ok)throw new ServiceError(r.status===401||r.status===403?'EVE authorization expired or permission was declined.':'EVE service is temporarily unavailable.',502);
 return r;
}
async function remote(url,options,fetchImpl){return (await fetchOk(url,options,fetchImpl)).json();}
// ESI's cache rules (developers.eveonline.com/docs/services/esi/best-practices): don't ask again before Expires, and
// after it send the stored ETag, so an unchanged answer is a body-less 304 (fewer rate-limit tokens, nothing to parse).
function hintOf(r){
 const expires=Date.parse(r.headers.get('Expires')||''),etag=r.headers.get('ETag');
 return {...(etag?{etag}:{}),...(Number.isFinite(expires)?{expires:Math.min(expires,Date.now()+86400000)}:{})};
}
// value is undefined on a 304: the caller keeps what it has.
async function esiJson(url,options,fetchImpl,gauge){
 const r=await fetchOk(url,options,fetchImpl,gauge);
 return {value:r.status===304?undefined:await r.json(),hint:hintOf(r)};
}
// Assets come in pages of 1000; store only quantity per type so the snapshot stays small. Pages are summed one at a
// time rather than all held and parsed together.
async function assetSummary(url,options,fetchImpl,gauge,fit){
 const first=await fetchOk(url,options,fetchImpl,gauge);
 // All pages of a paged route share one cache entry (one Last-Modified), so an unchanged first page means an
 // unchanged set: the stored summary stands, and no page is downloaded or parsed.
 if(first.status===304)return {value:undefined,hint:hintOf(first)};
 // shortcut: 20 pages (20k items) covers our two pilots; raise it if a pilot outgrows that.
 const total=Number(first.headers.get('X-Pages'))||1,pages=Math.min(20,total),modified=first.headers.get('Last-Modified');
 const {'If-None-Match':_,...headers}=options.headers,types=new Map(),locations=new Set();let items=0;
 const add=rows=>{fit?.add(rows);for(const a of rows){if(a.is_blueprint_copy)continue;items++;locations.add(a.location_id);types.set(a.type_id,(types.get(a.type_id)||0)+a.quantity);}};
 add(await first.json());
 for(let page=2;page<=pages;page++){
  if(gauge?.stop)throw new ServiceError('EVE asked for fewer requests. Previous asset summary retained.',502);
  const r=await fetchOk(`${url}?page=${page}`,{headers},fetchImpl,gauge);
  // A page from a newer copy than page 1 would mix two inventories: keep the last summary and read again next time.
  if(modified&&r.headers.get('Last-Modified')&&r.headers.get('Last-Modified')!==modified)throw new ServiceError('EVE assets changed while they were read. Previous summary retained.',502);
  add(await r.json());
 }
 return {value:{items,locations:locations.size,truncated:pages<total,types:[...types].sort((a,b)=>b[1]-a[1]).slice(0,1500)},hint:hintOf(first)};
}
async function exchange(env,fields,fetchImpl){
 return remote(`${EVE}/v2/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:`Basic ${btoa(`${env.EVE_CLIENT_ID}:${env.EVE_CLIENT_SECRET}`)}`},body:new URLSearchParams(fields)},fetchImpl);
}
// EVE's signing keys change rarely: keep them for an hour per Worker instance, and refetch once if a token doesn't
// validate against the cached set (the keys may have just rotated).
let jwks=null;
export const resetJwks=()=>{jwks=null;};
async function verify(access,env,id,fetchImpl){
 const load=async()=>{jwks={at:Date.now(),keys:(await remote(`${EVE}/oauth/jwks`,{},fetchImpl)).keys};return jwks.keys;};
 const cached=jwks&&Date.now()-jwks.at<3600000;
 try{return await validateToken(access,env.EVE_CLIENT_ID,id,cached?jwks.keys:await load());}
 catch(error){
  if(error instanceof ServiceError)throw error;
  if(cached){try{return await validateToken(access,env.EVE_CLIENT_ID,id,await load());}catch(retry){if(retry instanceof ServiceError)throw retry;}}
  throw new ServiceError('EVE authorization did not match this pilot, application, or requested permissions.',403);
 }
}
async function session(request,env){
 const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
 if(!token)throw new ServiceError('Connect this pilot with EVE to access private data.',401);
 const row=await env.DB.prepare('SELECT token_hash, character_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await hash(token),Date.now()).first();
 if(!row)throw new ServiceError('This dashboard session expired. Connect the pilot again.',401);
 const now=Date.now();
 if(row.expires_at-now<SESSION_MS-86400000){row.expires_at=now+SESSION_MS;await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(row.expires_at,row.token_hash).run();}
 return row;
}
function parseSnapshot(row){try{return JSON.parse(row.snapshot);}catch{return {};}}
function privatePayload(row,sessionRow){
 const {esi,events,names,cursor,pendingOrders,...snapshot}=parseSnapshot(row); // ESI's cache hints, alert events and the round-robin cursor are the Worker's bookkeeping
 return {characterId:row.character_id,name:row.name,expires:sessionRow.expires_at,...snapshot,lastError:row.last_error};
}
// Call only while holding the pilot's sync lock (lockUntil): refresh tokens rotate and must not race.
async function freshCredentials(row,env,fetchImpl,lockUntil){
 const context=`pilot:${row.character_id}`;
 let credentials=await decrypt(row.credentials,env.TOKEN_ENCRYPTION_KEY,context);
 if(credentials.expires<Date.now()+60000){
  // A refresh token EVE refused stays refused, and asking again every cycle only spends EVE's patience: wait for the
  // pilot to reconnect (the callback clears both holds). The same for a 429 until its Retry-After has passed.
  if(row.grant_revoked_at)throw new ServiceError(REVOKED,502);
  if(row.refresh_after>Date.now())throw new ServiceError(LIMITED,502);
  let refreshed;
  try{refreshed=await exchange(env,{grant_type:'refresh_token',refresh_token:credentials.refreshToken},fetchImpl);}
  catch(error){
   // Bound to the lock: a reconnect meanwhile resets it, and its fresh grant must not be marked refused.
   if(error.revoked)await env.DB.prepare('UPDATE pilots SET grant_revoked_at = ? WHERE character_id = ? AND sync_lock_until = ?').bind(Date.now(),row.character_id,lockUntil).run();
   if(error.retryAt)await env.DB.prepare('UPDATE pilots SET refresh_after = ? WHERE character_id = ? AND sync_lock_until = ?').bind(error.retryAt,row.character_id,lockUntil).run();
   throw error;
  }
  // EVE has rotated the refresh token: the old one is dead from here on. Save the new one before anything else can
  // fail (checking the access token fetches EVE's keys), or one failed check would leave the pilot needing a reconnect.
  // If the lock was lost (another request reset it), the rotated token was not stored: stop rather than carry on with it.
  const save=async c=>{const r=await env.DB.prepare('UPDATE pilots SET credentials = ? WHERE character_id = ? AND sync_lock_until = ?').bind(await encrypt(c,env.TOKEN_ENCRYPTION_KEY,context),row.character_id,lockUntil).run();if(r?.meta?.changes===0)throw new ServiceError('This pilot changed while syncing. Try again in a moment.',409);};
  credentials={...credentials,accessToken:refreshed.access_token,refreshToken:refreshed.refresh_token||credentials.refreshToken,expires:0};
  await save(credentials);
  const identity=await verify(refreshed.access_token,env,row.character_id,fetchImpl);
  credentials={...credentials,expires:identity.expires,scopes:identity.scopes};
  await save(credentials);
 }
 return credentials;
}
// Journal sync (migration 0004). The browser keeps the journal and sends what changed since the last rev it saw for
// each record (base). A change applies only if the stored rev still equals base; otherwise the stored copy comes back
// as a conflict and the browser keeps both. Records are validated like a backup file and encrypted at rest.
// Kind 'pref' (migration 0005) is a pilot's own setting, id '<name>:<characterId>' (scanned systems, the haul plan):
// only that pilot may write it, and the browser merges conflicts instead of copying. Only clients that ask (prefs=1)
// are sent prefs, since older ones would take them for entries.
const JOURNAL_KINDS=['goal','entry','pref'];
export const JOURNAL_PAGE=500,JOURNAL_CHANGES=40;
const NEXT_REV='(SELECT COALESCE(MAX(rev),0)+1 FROM journal)';
function journalRecord(kind,record){
 if(kind==='pref'){try{return validatePref(record);}catch(error){throw new ServiceError(`Invalid preference: ${error.message}`);}}
 try{const data=validateBackup({version:1,goals:kind==='goal'?[record]:[],entries:kind==='entry'?[record]:[]});return (kind==='goal'?data.goals:data.entries)[0];}
 catch(error){throw new ServiceError(`Invalid ${kind}: ${error.message}`);}
}
async function journalOut(row,env){
 return {kind:row.kind,id:row.id,rev:row.rev,updatedAt:row.updated_at,record:row.data===null?null:await decrypt(row.data,env.TOKEN_ENCRYPTION_KEY,`${row.kind}:${row.id}`)};
}
async function journal(request,url,env){
 await limit(env,request,'RATE_JOURNAL',`j:${(await hash(request.headers.get('Authorization')||'')).slice(0,16)}`);
 const s=await session(request,env),me=s.character_id;
 if(request.method==='GET'){
  const since=Math.max(0,Math.floor(Number(url.searchParams.get('since')))||0);
  // Read the top rev first: a row written between the two queries is picked up next time instead of skipped.
  const top=(await env.DB.prepare('SELECT COALESCE(MAX(rev),0) AS rev FROM journal').first()).rev;
  const kinds=url.searchParams.get('prefs')==='1'?"":" AND kind != 'pref'";
  const rows=(await env.DB.prepare(`SELECT * FROM journal WHERE rev > ? AND rev <= ? AND owner IN (0, ?)${kinds} ORDER BY rev LIMIT ?`).bind(since,top,me,JOURNAL_PAGE+1).all()).results;
  const more=rows.length>JOURNAL_PAGE;if(more)rows.length=JOURNAL_PAGE;
  return response({rev:more?rows.at(-1).rev:Math.max(since,top),more,records:await Promise.all(rows.map(r=>journalOut(r,env)))});
 }
 if(request.method!=='POST')throw new ServiceError('Method not allowed.',405);
 // Records keep extra fields a newer build added, but validateBackup caps those per record, so 40 changes still fit.
 const raw=await readText(request,2000000,'Send fewer journal changes at once.');
 let body;try{body=JSON.parse(raw);}catch{throw new ServiceError('Journal changes must be JSON.');}
 const changes=body?.changes;
 if(!Array.isArray(changes)||!changes.length||changes.length>JOURNAL_CHANGES)throw new ServiceError(`Send between 1 and ${JOURNAL_CHANGES} journal changes.`);
 for(const c of changes){
  if(!JOURNAL_KINDS.includes(c?.kind)||typeof c.id!=='string'||!c.id||c.id.length>100||!Number.isSafeInteger(c.base)||c.base<0)throw new ServiceError('Invalid journal change.');
  // A pref is never deleted (a cleared setting is an empty one), and its id names the only pilot who may write it.
  if(c.kind==='pref'&&c.record===null)throw new ServiceError('Invalid journal change.');
  if(c.kind==='pref'&&c.id!==`${c.id.split(':')[0]}:${me}`)throw new ServiceError('A pilot can only set their own preferences.',403);
  if(c.record!==null){c.record=journalRecord(c.kind,c.record);if(c.record.id!==c.id)throw new ServiceError('Invalid journal change.');}
 }
 const key=c=>`${c.kind}:${c.id}`;
 if(new Set(changes.map(key)).size!==changes.length)throw new ServiceError('Duplicate journal changes.');
 const existing=new Map();
 for(const kind of JOURNAL_KINDS){
  const ids=changes.filter(c=>c.kind===kind).map(c=>c.id);
  if(ids.length)for(const row of (await env.DB.prepare(`SELECT * FROM journal WHERE kind = ? AND id IN (${ids.map(()=>'?').join(',')})`).bind(kind,...ids).all()).results)existing.set(key(row),row);
 }
 const applied=[],conflicts=[],denied=[],pending=[],now=Date.now();
 for(const c of changes){
  const row=existing.get(key(c)),owner=c.kind==='goal'?0:me;
  // Another pilot's entry: never revealed or replaced.
  if(row&&row.owner!==owner){denied.push({kind:c.kind,id:c.id});continue;}
  // No row although the device saw one (purged tombstone, reset database): a delete is done, a record is created anew.
  if(row&&row.rev!==c.base){conflicts.push(row);continue;}
  if(!row&&c.record===null){applied.push({kind:c.kind,id:c.id,rev:0});continue;}
  const data=c.record===null?null:await encrypt(c.record,env.TOKEN_ENCRYPTION_KEY,`${c.kind}:${c.id}`);
  pending.push([c,row?env.DB.prepare(`UPDATE journal SET data = ?, rev = ${NEXT_REV}, updated_at = ?, updated_by = ? WHERE kind = ? AND id = ? AND rev = ? RETURNING rev`).bind(data,now,me,c.kind,c.id,c.base)
   :env.DB.prepare(`INSERT INTO journal (kind, id, owner, data, rev, updated_at, updated_by) VALUES (?, ?, ?, ?, ${NEXT_REV}, ?, ?) ON CONFLICT DO NOTHING RETURNING rev`).bind(c.kind,c.id,owner,data,now,me)]);
 }
 const results=pending.length?await env.DB.batch(pending.map(([,statement])=>statement)):[];
 const lost=[];
 for(const [i,[c]] of pending.entries()){const rev=results[i]?.results?.[0]?.rev;if(rev)applied.push({kind:c.kind,id:c.id,rev});else lost.push(c);}
 // Lost a race with another device: read those rows back in one query (D1's free plan allows 50 per request).
 if(lost.length){
  const rows=(await env.DB.prepare(`SELECT * FROM journal WHERE ${lost.map(()=>'(kind = ? AND id = ?)').join(' OR ')}`).bind(...lost.flatMap(c=>[c.kind,c.id])).all()).results;
  for(const c of lost){const row=rows.find(r=>r.kind===c.kind&&r.id===c.id);if(row&&row.owner===(c.kind==='goal'?0:me))conflicts.push(row);else denied.push({kind:c.kind,id:c.id});}
 }
 return response({applied,denied,conflicts:await Promise.all(conflicts.map(r=>journalOut(r,env)))});
}
// Replace the pilot's in-game autopilot route with these systems, in order.
const MAX_WAYPOINTS=40; // shortcut: Cloudflare's free plan allows 50 subrequests per request
async function setWaypoints(id,systems,env,fetchImpl){
 if(!Array.isArray(systems)||!systems.length||systems.length>MAX_WAYPOINTS||!systems.every(n=>Number.isSafeInteger(n)&&n>30000000&&n<33000000))throw new ServiceError(`Send between 1 and ${MAX_WAYPOINTS} known-space system IDs.`);
 const now=Date.now(),lock=now+90000;
 const row=await env.DB.prepare('UPDATE pilots SET sync_lock_until = ? WHERE character_id = ? AND sync_lock_until < ? RETURNING *').bind(lock,id,now).first();
 if(!row)throw new ServiceError('This pilot is syncing. Try again in a moment.',409);
 try {
  const credentials=await freshCredentials(row,env,fetchImpl,lock);
  if(!credentials.scopes.includes(OPERATIONS_SCOPES.waypoints))throw new ServiceError('Permission not granted. Reconnect to allow setting autopilot waypoints.',403);
  for(const [i,system] of systems.entries()){
   const res=await fetchImpl(`${ESI}/ui/autopilot/waypoint/?add_to_beginning=false&clear_other_waypoints=${i===0}&destination_id=${system}`,{method:'POST',headers:{'User-Agent':UA,'X-Compatibility-Date':ESI_COMPAT,Authorization:`Bearer ${credentials.accessToken}`},signal:AbortSignal.timeout(15000)});
   if(!res.ok)throw new ServiceError(`EVE refused waypoint ${i+1} (HTTP ${res.status}). Is the pilot logged in to the game?`,502);
  }
  return {waypoints:systems.length};
 } finally {
  await env.DB.prepare('UPDATE pilots SET sync_lock_until = 0 WHERE character_id = ? AND sync_lock_until = ?').bind(id,lock).run();
 }
}
// The items of one contract, read on demand (the cron never asks: ESI has one route per contract). Only a contract in the
// caller's own stored list qualifies, so a pilot cannot probe contract ids.
async function contractItems(id,contractId,env,fetchImpl){
 if(!Number.isSafeInteger(contractId)||contractId<1)throw new ServiceError('Send a contract id.');
 const row=await env.DB.prepare('SELECT snapshot FROM pilots WHERE character_id = ?').bind(id).first();
 if(!row||!parseSnapshot(row).operations?.contracts?.value?.some(c=>c.contract_id===contractId))throw new ServiceError('That contract is not one of yours.',404);
 const now=Date.now(),lock=now+90000;
 const locked=await env.DB.prepare('UPDATE pilots SET sync_lock_until = ? WHERE character_id = ? AND sync_lock_until < ? RETURNING *').bind(lock,id,now).first();
 if(!locked)throw new ServiceError('This pilot is syncing. Try again in a moment.',409);
 try{
  const credentials=await freshCredentials(locked,env,fetchImpl,lock);
  if(!credentials.scopes.includes(OPERATIONS_SCOPES.contracts))throw new ServiceError('Permission not granted. Reconnect to allow reading contracts.',403);
  const res=await fetchImpl(`${ESI}/characters/${id}/contracts/${contractId}/items/`,{headers:{'User-Agent':UA,'X-Compatibility-Date':ESI_COMPAT,Accept:'application/json',Authorization:`Bearer ${credentials.accessToken}`},signal:AbortSignal.timeout(15000)});
  // Courier contracts have no items: ESI answers 404.
  if(res.status===404)return {contractId,items:[]};
  if(res.status===429||res.status===420)throw new ServiceError(LIMITED,429,{retryAfter:60});
  if(!res.ok)throw new ServiceError('EVE service is temporarily unavailable.',502);
  return {contractId,items:(await res.json()).slice(0,100).map(i=>({type_id:i.type_id,quantity:i.quantity,is_included:i.is_included!==false}))};
 }finally{
  await env.DB.prepare('UPDATE pilots SET sync_lock_until = 0 WHERE character_id = ? AND sync_lock_until = ?').bind(id,lock).run();
 }
}
// A sync stops asking ESI after this many fetches (token and key calls included): the free plan allows 50 subrequests per
// invocation, and the alert posts that follow a cron sync need a few of them.
export const SYNC_LIMIT=44;
// Endpoints a sync reads after the core ones, taking turns when the budget runs short (snapshot.cursor names the next).
// Most are cached by ESI for an hour or more, so a run usually skips them.
const EXTRA_PATHS={orders:'orders/',orderHistory:'orders/history/',contracts:'contracts/',killmails:'killmails/recent/',blueprints:'blueprints/',planets:'planets/',standings:'standings/'};
export const EXTRAS=Object.keys(EXTRA_PATHS);
const SHAPE={orders:compactOrders,orderHistory:list=>compactHistory(list),contracts:compactContracts,blueprints:compactBlueprints,standings:compactStandings};
export async function syncPilot(id,env,fetchImpl=fetch,{force=false}={}){
 const now=Date.now();
 const previous=await env.DB.prepare('SELECT * FROM pilots WHERE character_id = ?').bind(id).first();
 if(!previous)return null;
 if(!force&&previous.updated_at&&now-previous.updated_at<60000)return previous;
 // ESI said to back off (429/420): ask nothing, not even for a token, until its Retry-After. The last data stays.
 if(previous.esi_after>now)return previous;
 const row=await env.DB.prepare('UPDATE pilots SET sync_lock_until = ? WHERE character_id = ? AND sync_lock_until < ? RETURNING *').bind(now+90000,id,now).first();
 if(!row)return previous;
 // Every outgoing request goes through this count, so the limit holds however many pages or details a pilot has.
 let used=0;const counted=(url,options)=>{used++;return fetchImpl(url,options);},room=()=>SYNC_LIMIT-used;
 try {
  const credentials=await freshCredentials(row,env,counted,now+90000);
  const snapshot={fetchedAt:new Date().toISOString(),operations:{},errors:{},esi:{}};
  const paths={skills:'skills/',queue:'skillqueue/',wallet:'wallet/',ship:'ship/',location:'location/',jobs:'industry/jobs/?include_completed=false',journal:'wallet/journal/',transactions:'wallet/transactions/',attributes:'attributes/',clones:'clones/',implants:'implants/',assets:'assets/',mining:'mining/'};
  // ESI returns up to 2500 rows newest first; keep the latest 50 so snapshots stay small.
  const trim={journal:50,transactions:50,mining:400};
  // snapshot.esi keeps each endpoint's ETag and Expires; gauge stops the sync when ESI's budgets run low.
  const prior=parseSnapshot(row),hints=prior.esi||{},gauge={stop:false},auth={Authorization:`Bearer ${credentials.accessToken}`,Accept:'application/json'};
  // The assets read looks for the items inside the ship and in the hangar the pilot is docked at, so it waits for the ship and
  // location answers (both are started before it).
  const settlers=[];const shipKnown=Promise.all(['ship','location'].map(()=>new Promise(resolve=>settlers.push(resolve))));
  const shipSettled=()=>settlers.forEach(resolve=>resolve());
  let fitNow,stacksNow;
  const jobs=Object.entries(paths).map(([key,path])=>async()=>{
   const optional=OPERATIONS_SCOPES[key];
   if(optional&&!credentials.scopes.includes(optional)){snapshot.operations[key]={permission:false};return;}
   // Stations whose hangars are kept: where the pilot is docked now and the pickup station they chose. Stored stacks that miss one
   // of them cannot stand, so the assets are read in full even if ESI says they are unchanged.
   let fit,stacks,covered=true;
   if(key==='assets'){await shipKnown;const at=snapshot.operations.location?.value;stacks=stackCollector([at?.station_id??at?.structure_id,prior.sellStation]);covered=stacksCover(prior.operations?.stacks?.value,Object.keys(stacks.result()).map(Number));}
   const old=optional?prior.operations?.[key]?.value:prior[key],hint=hints[key];
   const keep=error=>{
    if(optional)snapshot.operations[key]={...prior.operations?.[key],permission:true,...(error?{error}:{})};
    else {if(old!==undefined)snapshot[key]=old;if(error)snapshot.errors[key]=error;}
    if(hint)snapshot.esi[key]=hint;
   };
   // Not expired: ESI would hand back its cached copy, which is what is stored already.
   if(old!==undefined&&hint?.expires>Date.now()&&covered){if(optional)snapshot.operations[key]=prior.operations[key];else snapshot[key]=old;snapshot.esi[key]=hint;return;}
   // Stopped early: keep the last good data; the next sync asks again.
   if(gauge.stop)return keep();
   try {
    if(key==='assets')fit=fitCollector(snapshot.operations.ship?.value?.ship_item_id);
    // A different ship than the stored fit was read from needs the whole list again, so no ETag goes with the request.
    const sameShip=!fit||!fit.result()||prior.operations?.fit?.value?.ship===fit.result().ship;
    const options={headers:{...auth,...(old!==undefined&&hint?.etag&&sameShip&&covered?{'If-None-Match':hint.etag}:{})}};
    const got=await(key==='assets'?assetSummary:esiJson)(`${ESI}/characters/${id}/${path}`,options,counted,gauge,key==='assets'?{add:rows=>{fit.add(rows);stacks.add(rows);}}:undefined);
    let value=got.value===undefined?old:got.value;
    if(trim[key]&&Array.isArray(value))value=value.slice(0,trim[key]);
    if(key==='assets'&&got.value!==undefined){fitNow=fit.result();stacksNow=stacks.result();}
    if(optional)snapshot.operations[key]={permission:true,value,fetched:snapshot.fetchedAt};
    else snapshot[key]=value;
    snapshot.esi[key]=got.value===undefined?{...hint,...got.hint}:got.hint; // a 304 may leave out the ETag
   }catch(error){
    if(error.retryAt)gauge.hold=Math.max(gauge.hold||0,error.retryAt);
    keep(error.message);
   }
  });
  for(const [at,settled] of ['ship','location'].map((k,i)=>[Object.keys(paths).indexOf(k),settlers[i]])){const settle=jobs[at];jobs[at]=async()=>{try{await settle();}finally{settled();}};}
  // Four at a time rather than all at once, so a low budget seen in one answer stops the requests not yet sent.
  await Promise.all(Array.from({length:4},async()=>{while(jobs.length)await jobs.shift()();}));
  shipSettled();
  // The current fit: from this run's asset pages, else the one stored (it stays valid until the next full asset read).
  if(![OPERATIONS_SCOPES.assets,OPERATIONS_SCOPES.ship].every(scope=>credentials.scopes.includes(scope)))snapshot.operations.fit={permission:false};
  else if(fitNow)snapshot.operations.fit={permission:true,value:fitNow,fetched:snapshot.fetchedAt};
  else if(prior.operations?.fit?.value)snapshot.operations.fit=prior.operations.fit;
  // The hangar stacks follow the assets scope: from this run's pages, else the stored ones (kept on an unchanged answer).
  if(!credentials.scopes.includes(OPERATIONS_SCOPES.assets))snapshot.operations.stacks={permission:false};
  else if(stacksNow)snapshot.operations.stacks={permission:true,value:stacksNow,fetched:snapshot.fetchedAt};
  else snapshot.operations.stacks=prior.operations?.stacks?.value?prior.operations.stacks:{permission:true,value:{},fetched:snapshot.fetchedAt};
  // Extras, one after another from the cursor: each costs one request (killmail details and planet pins a few more), only
  // while the budget lasts. An endpoint ESI has not expired costs nothing. The first one the budget did not reach goes first next time.
  const extra=async key=>{
   if(!credentials.scopes.includes(OPERATIONS_SCOPES[key])){snapshot.operations[key]={permission:false};return true;}
   const prev=prior.operations?.[key],old=prev?.value,hint=hints[key];
   const waiting=old!==undefined&&(key==='killmails'?old.wait?.length>0:key==='planets'?old.pending:false);
   const fresh=old!==undefined&&hint?.expires>Date.now();
   const reuse=error=>{snapshot.operations[key]={...prev,permission:true,...(error?{error}:{})};if(hint)snapshot.esi[key]=hint;};
   if(fresh&&!waiting){reuse();return true;}
   if(gauge.stop||room()<1){reuse();return false;}
   try{
    let list,next=hint;
    if(!fresh){
     const got=await esiJson(`${ESI}/characters/${id}/${EXTRA_PATHS[key]}`,{headers:{...auth,...(old!==undefined&&hint?.etag?{'If-None-Match':hint.etag}:{})}},counted,gauge);
     list=got.value;next=list===undefined?{...hint,...got.hint}:got.hint;
    }
    let value=old;
    if(key==='killmails')value=await stepKillmails(list,old,{id,room,get:(kid,hash)=>esiJson(`${ESI}/killmails/${kid}/${hash}/`,{headers:{Accept:'application/json'}},counted,gauge).then(r=>r.value)});
    else if(key==='planets')value=await stepPlanets(list,old,{room,get:planet=>esiJson(`${ESI}/characters/${id}/planets/${planet}/`,{headers:auth},counted,gauge).then(r=>r.value)});
    else if(list!==undefined)value=SHAPE[key](list);
    snapshot.operations[key]={permission:true,value,fetched:list!==undefined||waiting?snapshot.fetchedAt:prev?.fetched};
    if(next)snapshot.esi[key]=next;
   }catch(error){
    if(error.retryAt)gauge.hold=Math.max(gauge.hold||0,error.retryAt);
    reuse(error.message);
   }
   return true;
  };
  const start=Number.isInteger(prior.cursor)?prior.cursor%EXTRAS.length:0;let blocked=-1;
  for(let i=0;i<EXTRAS.length;i++){const at=(start+i)%EXTRAS.length;if(!await extra(EXTRAS[at])&&blocked<0)blocked=at;}
  snapshot.cursor=blocked<0?start:blocked;
  // What changed since the last sync, for the alert pass (kept three days).
  const events=diffEvents(prior,snapshot);
  const vanished=trackOrders(prior,snapshot).pending;
  if(vanished.length)snapshot.pendingOrders=vanished;
  if(events.length)snapshot.events=events;
  // Item names the alerts will use (the Worker has no name data): one lookup, only when alerts are on.
  if(env.DISCORD_WEBHOOK_URL){
   const ops=snapshot.operations,need=new Set([...(ops.jobs?.value||[]).flatMap(j=>[j.product_type_id,j.blueprint_type_id]),...(ops.orders?.value||[]).map(o=>o.type_id),...events.map(e=>e.type)].filter(Number.isSafeInteger));
   const known=prior.names||{},missing=[...need].filter(t=>!known[t]).slice(0,200);
   let found={};
   if(missing.length&&room()>=1&&!gauge.stop)try{found=Object.fromEntries((await(await fetchOk(`${ESI}/universe/names/`,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(missing)},counted,gauge)).json()).map(r=>[r.id,String(r.name).slice(0,80)]));}catch{/* The alerts say "an item". */}
   snapshot.names=Object.fromEntries([...need].map(t=>[t,known[t]||found[t]]).filter(([,n])=>n));
  }
  // A trail of systems the pilot was seen in (newest last, 7 days, at most 200): the Exploration tab skips them.
  const here=snapshot.operations.location?.value?.solar_system_id,trail=(prior.operations?.trail?.value||[]).filter(([,at])=>Date.now()-at<604800000);
  if(Number.isSafeInteger(here)&&trail.at(-1)?.[0]!==here)trail.push([here,Date.now()]);
  if(snapshot.operations.location?.permission)snapshot.operations.trail={permission:true,value:trail.slice(-200)};
  if(!snapshot.skills&&!snapshot.queue&&Object.keys(snapshot.errors).length)throw Object.assign(new ServiceError('Training data could not be refreshed. Previous snapshot retained.',502),{hold:gauge.hold});
  const errors=Object.values(snapshot.errors);
  // The pickup station may have been changed while this sync ran (it is written to the row, not through the sync lock): read it again.
  const chosen=(await env.DB.prepare("SELECT json_extract(snapshot, '$.sellStation') AS station FROM pilots WHERE character_id = ?").bind(id).first())?.station;
  if(isStationId(chosen))snapshot.sellStation=chosen;
  await env.DB.prepare('UPDATE pilots SET snapshot = ?, updated_at = ?, sync_lock_until = 0, last_error = ?, esi_after = ? WHERE character_id = ? AND sync_lock_until = ?').bind(JSON.stringify(snapshot),Date.now(),errors.length?'Some EVE data could not be refreshed.':null,gauge.hold||0,id,now+90000).run();
 }catch(error){
  await env.DB.prepare('UPDATE pilots SET sync_lock_until = 0, last_error = ?, esi_after = ? WHERE character_id = ? AND sync_lock_until = ?').bind(error instanceof ServiceError?error.message:'Synchronization failed. Reconnect if the problem persists.',error.hold||0,id,now+90000).run();
 }
 return env.DB.prepare('SELECT * FROM pilots WHERE character_id = ?').bind(id).first();
}
// The parts of the pipeline's meta (region 0) that only change with CCP's static data: served in the universe document.
export const STATIC_META=['ores','combat','skills'];
// The parts the cron keeps (market_docs 'activity'): last hour's kills and jumps, and their decayed history.
const LIVE_META=['risk','traffic','activity'];
// Splice JSON object texts into one object without parsing them. A key in a later part wins when the result is read.
export const joinObjects=(...parts)=>`{${parts.filter(Boolean).map(p=>p.trim().slice(1,-1).trim()).filter(Boolean).join(',')}}`;
function etagMatch(request,tag){
 const given=request.headers.get('If-None-Match');if(!given)return false;
 const bare=t=>t.trim().replace(/^W\//,'');
 return given.split(',').some(t=>t.trim()==='*'||bare(t)===bare(tag));
}
const notModified=headers=>new Response(null,{status:304,headers:{'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
// The universe version changes only when the map or the static meta does: each part's hash is kept in hints, so an
// upload of one part does not reread the other.
async function saveUniverse(env,{map,meta}){
 const doc=await env.DB.prepare("SELECT version, data, hints FROM market_docs WHERE name = 'universe'").first();
 const hints=JSON.parse(doc?.hints||'{}'),data=meta?JSON.stringify({...JSON.parse(doc?.data||'{}'),...meta}):doc?.data||'{}';
 if(map!==undefined)hints.map=await hash(map);
 else if(!hints.map){const row=await env.DB.prepare('SELECT data FROM market_snapshots WHERE region_id = 1').first();hints.map=row?await hash(row.data):'';}
 hints.meta=await hash(data);
 const version=(await hash(`${hints.map}|${hints.meta}`)).slice(0,16);
 await env.DB.prepare("INSERT INTO market_docs (name, version, data, hints, updated_at) VALUES ('universe', ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version, data = excluded.data, hints = excluded.hints, updated_at = CASE WHEN market_docs.version = excluded.version THEN market_docs.updated_at ELSE excluded.updated_at END").bind(version,data,JSON.stringify(hints),Date.now()).run();
}
// Take the pilot's sync lock, then have EVE revoke the refresh token. A sync running now may rotate the refresh token,
// and revoking the one it replaced would leave the new one authorized at EVE after its row is deleted; a sync holds the
// lock for seconds. Returns whether EVE confirmed; a failure there still lets the caller delete locally.
async function revokeGrant(id,env,fetchImpl,action){
 let locked=null;
 for(let i=0;i<8&&!locked;i++){
  if(i)await new Promise(r=>setTimeout(r,1000));
  locked=await env.DB.prepare('UPDATE pilots SET sync_lock_until = ? WHERE character_id = ? AND sync_lock_until < ? RETURNING *').bind(Date.now()+90000,id,Date.now()).first();
 }
 if(!locked)throw new ServiceError(`This pilot is syncing. Try ${action} again in a moment.`,409);
 try{
  const credentials=await decrypt(locked.credentials,env.TOKEN_ENCRYPTION_KEY,`pilot:${locked.character_id}`);
  const res=await fetchImpl(`${EVE}/v2/oauth/revoke`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:`Basic ${btoa(`${env.EVE_CLIENT_ID}:${env.EVE_CLIENT_SECRET}`)}`},body:new URLSearchParams({token:credentials.refreshToken,token_type_hint:'refresh_token'}),signal:AbortSignal.timeout(15000)});
  return res.ok;
 }catch{ /* Local deletion still removes access and shared snapshots. */ return false; }
}
// Delete everything stored about the caller: their journal entries and settings, the EVE grant, the pilot row and every
// session. Wing goals belong to both pilots, so they stay unless {goals:true,confirm:true} is sent.
async function forget(request,env,fetchImpl){
 const s=await session(request,env),me=s.character_id;
 let body={};try{const text=await readText(request,1024,'That request is too large.');if(text.trim())body=JSON.parse(text);}catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError('Send JSON.');}
 const goals=body?.goals===true;
 if(goals&&body.confirm!==true)throw new ServiceError('Deleting the wing goals needs confirmation.',400);
 const row=await env.DB.prepare('SELECT character_id FROM pilots WHERE character_id = ?').bind(me).first();
 const revoked=row?await revokeGrant(me,env,fetchImpl,'Delete my data'):false;
 // Revs only ever grow: a lower MAX(rev) would hand out revs the other devices have already read past. So the newest
 // row of the whole table, if it is being deleted, stays as an empty tombstone instead.
 const mine="(owner = ? OR (kind = 'pref' AND id LIKE ?))",top='rev < (SELECT MAX(rev) FROM journal)',args=[me,`%:${me}`];
 const statements=[
  env.DB.prepare(`DELETE FROM journal WHERE ${mine} AND ${top}`).bind(...args),
  env.DB.prepare(`UPDATE journal SET data = NULL, updated_at = ? WHERE ${mine}`).bind(Date.now(),...args),
  env.DB.prepare('DELETE FROM sessions WHERE character_id = ?').bind(me),
  env.DB.prepare('DELETE FROM pilots WHERE character_id = ?').bind(me)];
 // Goals become tombstones with fresh revs, so the wingmate's device learns they are gone (40 at a time: D1 caps the statements in a batch).
 let goalsLeft=false;
 if(goals){
  const rows=(await env.DB.prepare("SELECT id FROM journal WHERE kind = 'goal' AND owner = 0 AND data IS NOT NULL LIMIT 40").all()).results,now=Date.now();
  goalsLeft=rows.length===40;
  for(const g of rows)statements.unshift(env.DB.prepare(`UPDATE journal SET data = NULL, rev = ${NEXT_REV}, updated_at = ?, updated_by = ? WHERE kind = 'goal' AND id = ?`).bind(now,me,g.id));
 }
 await env.DB.batch(statements);
 return response({forgotten:true,revoked,goals,...(goalsLeft?{goalsLeft:true}:{})});
}
// Ingest bodies come from our own pipeline, but a leaked secret should not let anyone store anything anywhere: the region
// must be one the pipeline scans (meta 0, map 1, survey 2, the hubs, or a real ESI region id) and the data a plain object
// of the expected shape.
const plain=v=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
export const knownRegion=r=>Number.isSafeInteger(r)&&(r>=0&&r<=2||HUB_REGIONS.has(r)||(r>=10000001&&r<=10001000)||(r>=11000001&&r<=11001000));
export const INGEST_TYPES=20000;
function validateIngest(body){
 const region=body?.region,data=body?.data;
 if(!Number.isSafeInteger(region)||!plain(data))throw new ServiceError('Market snapshot needs a region and data.');
 if(!knownRegion(region))throw new ServiceError('Unknown market region.',400);
 if(region===0&&data.types!==undefined&&!plain(data.types))throw new ServiceError('Market meta types must be an object.');
 if(region===1&&((data.systems!==undefined&&!plain(data.systems))||(data.stations!==undefined&&!Array.isArray(data.stations))))throw new ServiceError('The gate map has the wrong shape.');
 if(region===2&&data.done!==undefined&&!plain(data.done))throw new ServiceError('The blueprint survey has the wrong shape.');
 if(region>2){
  if(data.name!==undefined&&(typeof data.name!=='string'||data.name.length>100))throw new ServiceError('Region name is invalid.');
  if(data.types!==undefined&&(!plain(data.types)||Object.keys(data.types).length>INGEST_TYPES))throw new ServiceError('Region types have the wrong shape.');
 }
}
// How old each part of the stored data is, for the freshness check: ages in seconds, never names, ids or locations.
// Market data older than 3 h, the activity sample older than 2 h, or a connected pilot not synced for an hour is a 503.
export const FRESH={market:3*3600000,activity:2*3600000,pilot:3600000};
async function freshness(env){
 const now=Date.now(),age=at=>Number.isFinite(at)?Math.max(0,Math.round((now-at)/1000)):null;
 const snaps=(await env.DB.prepare('SELECT region_id, updated_at FROM market_snapshots').all()).results;
 const docs=(await env.DB.prepare('SELECT name, updated_at FROM market_docs').all()).results;
 const pilots=(await env.DB.prepare('SELECT character_id, updated_at, last_error, grant_revoked_at FROM pilots ORDER BY character_id').all()).results.filter(p=>ALLOWED.has(p.character_id));
 const meta=snaps.find(r=>r.region_id===0)?.updated_at,hubs=snaps.filter(r=>HUB_REGIONS.has(r.region_id)).map(r=>r.updated_at);
 const report={market:{metaAge:age(meta),universeAge:age(docs.find(d=>d.name==='universe')?.updated_at),hubs:{count:hubs.length,oldestAge:hubs.length?age(Math.min(...hubs)):null}},
  activityAge:age(docs.find(d=>d.name==='activity')?.updated_at),
  pilots:pilots.map((p,i)=>({pilot:i+1,syncAge:age(p.updated_at),error:Boolean(p.last_error||p.grant_revoked_at)}))};
 // A missing row counts as stale. The universe document only changes with CCP's static data, so its age is not judged.
 // A pilot whose grant EVE refused cannot sync until they reconnect, so that is reported (error) but is not an outage.
 const stale=(seconds,max)=>seconds===null||seconds*1000>max,problems=[];
 if(stale(report.market.metaAge,FRESH.market)||(report.market.hubs.count&&stale(report.market.hubs.oldestAge,FRESH.market)))problems.push('market');
 if(stale(report.activityAge,FRESH.activity))problems.push('activity');
 for(const [i,p] of pilots.entries())if(!p.grant_revoked_at&&stale(report.pilots[i].syncAge,FRESH.pilot))problems.push(`pilot ${i+1}`);
 return response({ok:!problems.length,problems,...report},problems.length?503:200);
}
async function route(request,env,ctx,fetchImpl){
 const url=new URL(request.url),front=frontend(env);
 if(url.pathname==='/health'){
  let database=false;try{await env.DB.prepare('SELECT COUNT(*) AS count FROM pilots').first();database=true;}catch{}
  const ready=Boolean(database&&env.EVE_CLIENT_ID&&env.EVE_CLIENT_SECRET&&env.TOKEN_ENCRYPTION_KEY);
  return response({service:'eve-journal-api',ready,database,callback:`${url.origin}/auth/callback`},ready?200:503);
 }
 if(url.pathname==='/health/freshness'&&request.method==='GET'){
  await limit(env,request,'RATE_MARKET');
  return freshness(env);
 }
 if(url.pathname==='/auth/start'&&request.method==='GET'){
  const id=Number(url.searchParams.get('pilot'));if(!ALLOWED.has(id))throw new ServiceError('This character is not in the configured two-pilot dashboard.',403);
  const csrf=random();
  return html(`<h1>Connect ${ALLOWED.get(id)}</h1><p>EVE Pilot Console will periodically read your EVE data. What it keeps, and who sees it:</p><ul><li><b>Public:</b> your skill-point total and training queue will be visible on the public two-pilot dashboard, to anyone who opens it. The dashboard works that way, so connecting requires you to agree to it.</li><li><b>Only you, and your wingmate if you tick the second box:</b> wallet, ship, location, assets, industry jobs and mining ledger. The third box adds your ship's fit, blueprints and planetary colonies.</li><li><b>Only you, never your wingmate:</b> your market orders and their history, contracts, standings and ship losses. They are read to show them to you and to work out alerts.</li><li><b>Journal sync:</b> your Logbook entries, goals and settings are stored encrypted on the backend so they sync between your devices. Goals are shared with your wingmate; entries and settings are only yours.</li><li><b>Market scans:</b> once an hour the market pipeline reads the market of the region you are in, so the dashboard can price trades near you. That region is shown only to signed-in pilots, never publicly.</li><li>Refresh tokens are encrypted on the backend. You can disconnect, or use Delete my data on the dashboard to remove everything stored about you.</li></ul><form method="post" action="/auth/start"><input type="hidden" name="pilot" value="${id}"><input type="hidden" name="csrf" value="${csrf}"><label><input type="checkbox" name="share" value="yes" required> I agree that my skill total and training queue are shown publicly on this dashboard. (Required.)</label><label><input type="checkbox" name="wing" value="yes"> Also share my skills, wallet balance, asset summary, ship, location (with recently visited systems), industry jobs and mining ledger with my wingmate, the other pilot on this dashboard. Never public. (Optional.)</label><label><input type="checkbox" name="wing3" value="yes"> Also share my ship's fit, blueprints (with where they are) and planetary colonies (with their solar systems) with my wingmate. Needs the box above. (Optional.)</label><label><input type="checkbox" name="alerts" value="yes"> Post my alerts (skill queue, jobs ready, orders, contracts, losses, planet extractors) to the wing's Discord channel. No places are named. (Optional.)</label><button>Continue to EVE login</button></form><p><a href="${front.href}">Return to dashboard</a></p>`,200,{'Set-Cookie':authCookie('__Host-eve_csrf',csrf,600)});
 }
 if(url.pathname==='/auth/start'&&request.method==='POST'){
  if(!isSameOrigin(request,url))throw new ServiceError('Invalid connection origin.',403);
  await limit(env,request,'RATE_AUTH');
  const fields=new URLSearchParams(await readText(request,4096,'That request is too large.'));
  if(!fields.get('csrf')||fields.get('csrf')!==cookie(request,'__Host-eve_csrf')||fields.get('share')!=='yes')throw new ServiceError('Confirm sharing consent before connecting.',403);
  const id=Number(fields.get('pilot'));if(!ALLOWED.has(id))throw new ServiceError('Unknown pilot.',403);
  const state=random(),verifier=random(),stateHash=await hash(state);
  await env.DB.prepare('INSERT INTO oauth_states (state_hash, payload, expires_at) VALUES (?, ?, ?)').bind(stateHash,await encrypt({id,verifier,share:true,wing:fields.get('wing')==='yes'?(fields.get('wing3')==='yes'?3:2):0,alerts:fields.get('alerts')==='yes'},env.TOKEN_ENCRYPTION_KEY,`state:${stateHash}`),Date.now()+300000).run();
  const login=new URL(`${EVE}/v2/oauth/authorize/`);
  login.search=new URLSearchParams({response_type:'code',client_id:env.EVE_CLIENT_ID,redirect_uri:`${url.origin}/auth/callback`,scope:REQUESTED_SCOPES.join(' '),state,code_challenge:await challenge(verifier),code_challenge_method:'S256'});
  return new Response(null,{status:303,headers:{Location:login.href,'Cache-Control':'no-store','Set-Cookie':authCookie('__Host-eve_state',state,600),'Referrer-Policy':'no-referrer'}});
 }
 if(url.pathname==='/auth/callback'&&request.method==='GET'){
  const state=url.searchParams.get('state');
  if(!state||state!==cookie(request,'__Host-eve_state'))throw new ServiceError('EVE login state did not match. Start again.',403);
  const stateHash=await hash(state);
  const pending=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING payload').bind(stateHash,Date.now()).first();
  if(!pending)throw new ServiceError('EVE login expired or was already used. Start again.',403);
  if(url.searchParams.has('error'))throw new ServiceError('EVE login was cancelled or declined.');
  const code=url.searchParams.get('code');if(!code)throw new ServiceError('EVE did not return an authorization code.');
  const payload=await decrypt(pending.payload,env.TOKEN_ENCRYPTION_KEY,`state:${stateHash}`);
  const tokens=await exchange(env,{grant_type:'authorization_code',code,redirect_uri:`${url.origin}/auth/callback`,code_verifier:payload.verifier},fetchImpl);
  if(!tokens.refresh_token)throw new ServiceError('EVE did not return a refresh token. Reconnect the pilot.',502);
  const identity=await verify(tokens.access_token,env,payload.id,fetchImpl);
  const encrypted=await encrypt({accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expires:identity.expires,scopes:identity.scopes},env.TOKEN_ENCRYPTION_KEY,`pilot:${payload.id}`);
  await env.DB.prepare('INSERT INTO pilots (character_id, name, credentials, share_training, share_wing, share_alerts) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(character_id) DO UPDATE SET name = excluded.name, credentials = excluded.credentials, share_training = 1, share_wing = excluded.share_wing, share_alerts = excluded.share_alerts, sync_lock_until = 0, grant_revoked_at = NULL, refresh_after = 0').bind(payload.id,ALLOWED.get(payload.id),encrypted,payload.wing||0,payload.alerts?1:0).run();
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
 if(url.pathname==='/api/market/regions'&&request.method==='GET'){
  await requirePipeline(request,env,url);
  const rows=await env.DB.prepare('SELECT snapshot FROM pilots').all();
  const systems=[...new Set(rows.results.map(row=>parseSnapshot(row).operations?.location?.value?.solar_system_id).filter(Number.isSafeInteger))];
  return response({systems});
 }
 if(url.pathname==='/api/market/survey'&&request.method==='GET'){
  await requirePipeline(request,env,url);
  const row=await env.DB.prepare('SELECT data FROM market_snapshots WHERE region_id = 2').first();
  return response({survey:row?JSON.parse(row.data):null});
 }
 if(url.pathname==='/api/market/ingest'&&request.method==='POST'){
  const bytes=await readBytes(request,1900000,'Market snapshot is too large.'); // D1 rows top out at 2 MB
  await requirePipeline(request,env,url,bytes);
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ServiceError('Market snapshot is not JSON.');}
  validateIngest(body);
  const data=body.data,now=Date.now();
  if(body.region===0){
   // Kill and jump history is the cron's now. A pipeline from before the switch still sends its copy: keep it only if
   // it is newer than the cron's, so nothing is lost while both run.
   if(data.risk?.at){
    const live=await env.DB.prepare("SELECT json_extract(data, '$.risk.at') AS at FROM market_docs WHERE name = 'activity'").first();
    if(!(live?.at>=data.risk.at))await env.DB.prepare("INSERT INTO market_docs (name, data, updated_at) VALUES ('activity', ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(JSON.stringify({risk:data.risk,traffic:data.traffic,activity:data.activity}),now).run();
   }
   for(const key of LIVE_META)delete data[key];
   // The static parts go to the universe document; a run that could not read the static data keeps the last ones.
   const fixed=Object.fromEntries(STATIC_META.filter(k=>data[k]!=null).map(k=>[k,data[k]]));for(const k of STATIC_META)delete data[k];
   if(Object.keys(fixed).length)await saveUniverse(env,{meta:fixed});
  }
  const stored=JSON.stringify(data);
  await env.DB.prepare('INSERT INTO market_snapshots (region_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(region_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(body.region,stored,now).run();
  if(body.region===1)await saveUniverse(env,{map:stored});
  return response({stored:body.region});
 }
 // The static universe document: the gate map (region 1) and STATIC_META. A request naming the current version is
 // cached for a year; the browser asks again only when /api/market names a new one.
 if(url.pathname==='/api/market/universe'&&request.method==='GET'){
  await limit(env,request,'RATE_MARKET');
  const doc=await env.DB.prepare("SELECT version, data FROM market_docs WHERE name = 'universe'").first();
  if(!doc)throw new ServiceError('The universe map is not stored yet.',404);
  const tag=`"u-${doc.version}"`,headers={ETag:tag,'Cache-Control':url.searchParams.get('v')===doc.version?'public, max-age=31536000, immutable':'public, max-age=300'};
  if(etagMatch(request,tag))return notModified(headers);
  const map=await env.DB.prepare('SELECT data FROM market_snapshots WHERE region_id = 1').first();
  return jsonText(`{"version":${JSON.stringify(doc.version)},"universe":${map?.data||'null'},"meta":${doc.data}}`,200,headers);
 }
 if(url.pathname==='/api/market'&&request.method==='GET'){
  await limit(env,request,'RATE_MARKET');
  // Pilot regions reveal where the pilots fly, so only a signed-in dashboard session sees them; everyone else gets the hubs.
  let signedIn=false;
  if(request.headers.has('Authorization'))try{await session(request,env);signedIn=true;}catch{/* Serve the public view. */}
  // Region 0 holds item names, recipes and the starter blueprints; region 1 the gate map and NPC stations; region 2
  // (the pipeline's blueprint survey) is not served. Region rows the pipeline stopped scanning (a pilot flew home) go
  // stale; serve only the last 6 hours of them. ?v=2 clients take the static parts from /api/market/universe; older
  // ones get everything inline, as before.
  const split=url.searchParams.get('v')==='2';
  const heads=(await env.DB.prepare('SELECT region_id, updated_at FROM market_snapshots WHERE region_id < 2 OR (region_id > 2 AND updated_at > ?)').bind(Date.now()-6*3600000).all()).results;
  const docs=(await env.DB.prepare('SELECT name, version, updated_at FROM market_docs').all()).results,universe=docs.find(d=>d.name==='universe');
  const shown=heads.filter(r=>r.region_id===0||(r.region_id===1&&!(split&&universe))||(r.region_id>2&&(signedIn||HUB_REGIONS.has(r.region_id))));
  // Answer from the row timestamps alone when the browser already has this exact view, before reading megabytes.
  const tag=`W/"${(await hash([split?2:1,signedIn?1:0,...shown.map(r=>`${r.region_id}:${r.updated_at}`),...docs.map(d=>`${d.name}:${d.version}:${d.updated_at}`)].join('|'))).slice(0,27)}"`;
  // no-cache, not max-age: the browser still revalidates (ETag, 304, no body), so Refresh is never answered from its own cache.
  const headers={'Cache-Control':`${signedIn?'private':'public'}, no-cache`,Vary:'Authorization',ETag:tag};
  if(etagMatch(request,tag))return notModified(headers);
  const ids=shown.map(r=>r.region_id);
  const rows=ids.length?(await env.DB.prepare(`SELECT region_id, data, updated_at FROM market_snapshots WHERE region_id IN (${ids.map(()=>'?').join(',')}) ORDER BY region_id`).bind(...ids).all()).results:[];
  const parts=docs.length?(await env.DB.prepare(`SELECT name, data FROM market_docs WHERE name IN ('activity'${split?'':", 'universe'"})`).all()).results:[];
  // Stored data is already JSON, so splice it in rather than parsing megabytes per request.
  const meta=rows.find(r=>r.region_id===0),map=rows.find(r=>r.region_id===1),part=name=>parts.find(p=>p.name===name)?.data;
  const regions=rows.filter(r=>r.region_id>2).map(r=>`{"region":${r.region_id},"updatedAt":${r.updated_at},"data":${r.data}}`);
  const metaText=meta?`{"region":0,"updatedAt":${meta.updated_at},"data":${joinObjects(meta.data,split?null:part('universe'),part('activity'))}}`:'null';
  const text=`{"meta":${metaText},"universe":${map?map.data:'null'},${split?`"universeVersion":${JSON.stringify(map?null:universe?.version??null)},`:''}"regions":[${regions.join(',')}]}`;
  return jsonText(text,200,headers);
 }
 if(url.pathname==='/api/wing'&&request.method==='GET'){
  const s=await session(request,env);
  const rows=await env.DB.prepare('SELECT character_id, name, snapshot, share_wing, updated_at, last_error FROM pilots WHERE share_wing > 0 OR character_id = ?').bind(s.character_id).all();
  return response({pilots:rows.results.filter(row=>ALLOWED.has(row.character_id)).map(row=>{
   const snap=parseSnapshot(row),ops=snap.operations||{};
   return {characterId:row.character_id,name:row.name,sharing:Boolean(row.share_wing),shareLevel:row.share_wing,lastError:row.last_error||null,fetchedAt:snap.fetchedAt||null,skills:snap.skills||null,wallet:ops.wallet?.value??null,assets:ops.assets?.value||null,
    // Consent level 2: ship, location, trail, jobs and the mining ledger. Level 3 adds the fit, hangar stacks, blueprints (with where they are) and planets (with their systems).
    ...(row.share_wing>=2||row.character_id===s.character_id?{ship:ops.ship?.value||null,location:ops.location?.value||null,mining:ops.mining?.value||null,trail:ops.trail?.value||null,jobs:ops.jobs?.value||null}:{}),
    ...(row.share_wing>=3||row.character_id===s.character_id?{fit:ops.fit?.value||null,stacks:ops.stacks?.value||null,blueprints:ops.blueprints?.value||null,planets:ops.planets?.value||null}:{})};
  })});
 }
 // The pickup station the sell planner reads stacks from (besides the one the pilot is docked at); null clears it. The sync
 // that follows keeps that hangar's stacks. json_set rather than a read and write, so a sync running now cannot lose it.
 if(url.pathname==='/api/sell-station'&&request.method==='POST'){
  await limit(env,request,'RATE_JOURNAL',`s:${(await hash(request.headers.get('Authorization')||'')).slice(0,16)}`);
  const s=await session(request,env);
  let body;try{body=JSON.parse(await readText(request,1024,'That request is too large.'));}catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError('Send JSON.');}
  const station=body?.station;
  if(station!==null&&!isStationId(station))throw new ServiceError('Choose a station or structure.');
  const r=await env.DB.prepare(station===null?"UPDATE pilots SET snapshot = json_remove(snapshot, '$.sellStation') WHERE character_id = ?":"UPDATE pilots SET snapshot = json_set(snapshot, '$.sellStation', ?) WHERE character_id = ?").bind(...station===null?[s.character_id]:[station,s.character_id]).run();
  if(!(r?.meta?.changes>0))throw new ServiceError('This pilot is no longer connected.',401);
  return response({sellStation:station});
 }
 if(url.pathname==='/api/contract-items'&&request.method==='GET'){
  await limit(env,request,'RATE_JOURNAL',`c:${(await hash(request.headers.get('Authorization')||'')).slice(0,16)}`);
  const s=await session(request,env);
  return response(await contractItems(s.character_id,Number(url.searchParams.get('id')),env,fetchImpl));
 }
 if(url.pathname==='/api/waypoints'&&request.method==='POST'){
  const s=await session(request,env);
  let body;try{body=JSON.parse(await readText(request,4096,'Send fewer waypoints.'));}catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError('Waypoints must be JSON.');}
  return response(await setWaypoints(s.character_id,body?.systems,env,fetchImpl));
 }
 if(url.pathname==='/api/journal')return journal(request,url,env);
 // Ends the presented session and nothing else: a browser that reconnected a pilot hands in the token it replaced,
 // so the pilot's sessions on other devices stay. Only the token's holder can end it; an unknown one is a no-op.
 if(url.pathname==='/api/session/revoke'&&request.method==='POST'){
  const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!token)throw new ServiceError('Send the session to end.',401);
  const r=await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run();
  return response({revoked:(r?.meta?.changes||0)>0});
 }
 if(url.pathname==='/api/forget'){
  if(request.method!=='POST')throw new ServiceError('Method not allowed.',405);
  return forget(request,env,fetchImpl);
 }
 if(['/api/session','/api/sync','/api/disconnect'].includes(url.pathname)){
  if(url.pathname==='/api/session'&&request.method!=='GET')throw new ServiceError('Method not allowed.',405);
  if(url.pathname!=='/api/session'&&request.method!=='POST')throw new ServiceError('Method not allowed.',405);
  const s=await session(request,env);
  let row=await env.DB.prepare('SELECT * FROM pilots WHERE character_id = ?').bind(s.character_id).first();
  if(!row)throw new ServiceError('This pilot is no longer connected.',401);
  if(url.pathname==='/api/disconnect'){
   const revoked=await revokeGrant(row.character_id,env,fetchImpl,'Disconnect');
   await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE character_id = ?').bind(row.character_id),env.DB.prepare('DELETE FROM pilots WHERE character_id = ?').bind(row.character_id)]);
   return response({disconnected:true,revoked});
  }
  if(url.pathname==='/api/sync'){row=await syncPilot(row.character_id,env,fetchImpl);if(!row)throw new ServiceError('This pilot is no longer connected.',401);}
  return response(privatePayload(row,s));
 }
 throw new ServiceError('Not found.',404);
}
// Route names for logs: only the fixed paths, so a request for any other path (which may carry anything) logs as 'other'.
const LOGGED=new Set(['/health','/health/freshness','/auth/start','/auth/callback','/api/public/pilots','/api/market/regions','/api/market/survey','/api/market/ingest','/api/market/universe','/api/market','/api/wing','/api/waypoints','/api/sell-station','/api/contract-items','/api/journal','/api/session/revoke','/api/session','/api/sync','/api/disconnect','/api/forget']);
export async function handleRequest(request,env,ctx={},fetchImpl=fetch){
 const started=Date.now();
 const result=await handle(request,env,ctx,fetchImpl);
 // No query, headers, tokens or addresses: route, method, status and duration only.
 const {pathname}=new URL(request.url);
 log({e:'req',route:LOGGED.has(pathname)?pathname:'other',method:request.method,status:result.status,ms:Date.now()-started});
 return result;
}
async function handle(request,env,ctx,fetchImpl){
 const origin=request.headers.get('Origin');
 const url=new URL(request.url);
 let front;try{front=frontend(env);}catch{return response({error:'Backend configuration is incomplete.'},503);}
 if(origin&&origin!==front.origin&&!isSameOrigin(request,url))return response({error:'Origin is not allowed.'},403);
 const cors=origin===front.origin?{'Access-Control-Allow-Origin':front.origin,Vary:'Origin','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}:{};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,...(Object.keys(cors).length?{'Access-Control-Max-Age':'7200'}:{})}});
 let result;
 try{result=await route(request,env,ctx,fetchImpl);}catch(error){result=response({error:error instanceof ServiceError?error.message:'Backend request failed. Try again later.'},error instanceof ServiceError?error.status:500,error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});if(!(error instanceof ServiceError))log({e:'error',what:'unhandled'});}
 // Append Vary rather than replace it: /api/market varies by Authorization too, and a cached signed-in copy must not
 // be reused once the session is gone. Preflights are cached for two hours instead of preceding every request.
 const headers=new Headers(result.headers);for(const [key,value]of Object.entries(cors))key==='Vary'?headers.append(key,value):headers.set(key,value);
 return new Response(result.body,{status:result.status,headers});
}
// Last hour's kills and jumps per system, and their decayed history (worker/activity.js), sampled by the cron. ESI
// refreshes both feeds hourly and says when in Expires; a sample waits for both, and for SAMPLE_EVERY since the last.
export const SAMPLE_EVERY=55*60000;
// Before the switch the pipeline kept this history in its meta row. Its copy is the starting point while it is newer.
async function pipelineHistory(env,prev){
 const at=(await env.DB.prepare("SELECT json_extract(data, '$.risk.at') AS at FROM market_snapshots WHERE region_id = 0").first())?.at;
 if(!(at>(prev?.risk?.at||0)))return prev;
 const r=await env.DB.prepare("SELECT json_extract(data, '$.risk') AS risk, json_extract(data, '$.traffic') AS traffic, json_extract(data, '$.activity') AS activity FROM market_snapshots WHERE region_id = 0").first();
 const read=t=>{try{return t?JSON.parse(t):undefined;}catch{return undefined;}};
 return {risk:read(r.risk),traffic:read(r.traffic)??prev?.traffic,activity:read(r.activity)??prev?.activity};
}
// High- and low-sec systems from the stored gate map, as the Mining tab's reach. SQLite reads the map, not the Worker.
async function empire(env){
 const rows=(await env.DB.prepare("SELECT CAST(s.key AS INTEGER) AS id FROM market_snapshots m, json_each(m.data, '$.systems') s WHERE m.region_id = 1 AND json_extract(s.value, '$[1]') > 0").all()).results;
 if(!rows.length)return ()=>true;
 const ids=new Set(rows.map(r=>r.id));return id=>ids.has(id);
}
export async function sampleActivity(env,fetchImpl=fetch,now=Date.now()){
 const doc=await env.DB.prepare("SELECT data, hints FROM market_docs WHERE name = 'activity'").first();
 let hints={};try{hints=JSON.parse(doc?.hints||'{}');}catch{/* Ask without validators. */}
 const gauge={},get=async(key,path)=>{
  const hint=hints[key]||{};
  try{
   const r=await fetchOk(`${ESI}/universe/${path}/`,{headers:{Accept:'application/json',...(hint.etag?{'If-None-Match':hint.etag}:{})}},fetchImpl,gauge);
   const modified=Date.parse(r.headers.get('Last-Modified')||''),next={...hint,...hintOf(r),...(Number.isFinite(modified)?{modified}:{})};
   // The same hour again (a 304, or a copy no newer than the last one) adds nothing: counting it twice would double it.
   if(r.status===304||(Number.isFinite(modified)&&modified<=hint.modified))return {hint:next};
   return {rows:await r.json(),hint:next};
  }catch(error){return {error,hint};}
 };
 const [kills,jumps]=await Promise.all([get('kills','system_kills'),get('jumps','system_jumps')]);
 const failed=kills.error||jumps.error,fresh=kills.rows||jumps.rows;
 // A failed feed is asked again after its Retry-After, or in 10 minutes; otherwise once both feeds have a new hour.
 const expires=failed?Math.max(now+2*SYNC_EVERY,kills.error?.retryAt||0,jumps.error?.retryAt||0):Math.max(now+SAMPLE_EVERY,kills.hint.expires||0,jumps.hint.expires||0);
 let data=null;
 if(fresh){
  let prev=null;try{prev=doc?JSON.parse(doc.data):null;}catch{/* Start the history again. */}
  prev=await pipelineHistory(env,prev);
  const next=history(prev,kills.rows||null,jumps.rows||null,now);
  data=JSON.stringify({risk:next.risk,traffic:next.traffic,activity:lastHour(prev?.activity,kills.rows||null,jumps.rows||null,await empire(env))});
 }
 // updated_at moves only with new data: /api/market's ETag is built from it.
 await env.DB.prepare(`INSERT INTO market_docs (name, data, hints, updated_at, expires_at, turns) VALUES ('activity', ?, ?, ?, ?, 1) ON CONFLICT(name) DO UPDATE SET ${data?'data = excluded.data, updated_at = excluded.updated_at, ':''}hints = excluded.hints, expires_at = excluded.expires_at, turns = market_docs.turns + 1`)
  .bind(data||'{}',JSON.stringify({kills:kills.hint,jumps:jumps.hint}),now,expires).run();
 return {sampled:Boolean(fresh),expires,failed:Boolean(failed)};
}
// One ESI job per run, taking turns: a pilot sync makes about 13 core ESI calls plus up to 19 more asset pages, a token
// refresh and the extras (orders, contracts, losses and the rest, which are counted and capped: see SYNC_LIMIT), fewer
// now that unexpired endpoints are skipped, and the free plan allows 50 subrequests and 10 ms of CPU per invocation. The cron runs every 5 minutes (scripts/deploy-backend.mjs), so with two pilots each one refreshes every
// 10 minutes, about as often as ESI's own caches turn over. Turns follow the clock rather than the last sync, so a
// pilot whose sync keeps failing cannot starve the other. A pilot whose grant EVE refused gets no turn until they
// reconnect: it could not reach EVE anyway. Once an hour a run samples kills and jumps (2 calls) instead of syncing;
// the turn counter it bumps hands the skipped turn to the same pilot on the next run, so neither pilot always loses it.
export const SYNC_EVERY=5*60000;
export async function scheduledSync(env,fetchImpl=fetch,at=Date.now()){
 const result=await syncStep(env,fetchImpl,at);
 // Discord alerts come from what is stored, after the sync: a few posts at most, and never a reason to fail the run.
 try{const alerts=await sendAlerts(env,fetchImpl);if(alerts.sent||alerts.failed)Object.assign(result,{alerts:alerts.sent,...(alerts.failed?{alertsFailed:alerts.failed}:{})});}
 catch{Object.assign(result,{alertsFailed:1});}
 return result;
}
async function syncStep(env,fetchImpl,at){
 const sample=await env.DB.prepare("SELECT expires_at, turns FROM market_docs WHERE name = 'activity'").first();
 if(!sample||Date.now()>=sample.expires_at){const r=await sampleActivity(env,fetchImpl);return {job:'sample',kills:r.failed?'failed':'ok'};}
 const ids=(await env.DB.prepare('SELECT character_id FROM pilots WHERE grant_revoked_at IS NULL ORDER BY character_id').all()).results.map(row=>row.character_id).filter(id=>ALLOWED.has(id));
 if(!ids.length)return {job:'sync',pilot:'none'};
 const row=await syncPilot(ids[(Math.floor(at/SYNC_EVERY)+sample.turns)%ids.length],env,fetchImpl);
 return {job:'sync',pilot:row&&!row.last_error?'ok':'failed'};
}
// Once a day (DAILY_CRON in scripts/deploy-backend.mjs): expired sessions and login states are already refused where they
// are read, so removing them is housekeeping that does not need to run every 5 minutes.
export const DAILY_CRON='17 3 * * *';
export async function cleanup(env,now=Date.now()){
 await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now),
  // Tombstones only need to outlive the last sync of every device; half a year is plenty. The newest row always stays:
  // revs are MAX(rev)+1, and a lower MAX would hand out revs that devices have already read past.
  env.DB.prepare('DELETE FROM journal WHERE data IS NULL AND updated_at < ? AND rev < (SELECT MAX(rev) FROM journal)').bind(now-180*86400000),
  // Alert keys only stop a repeat; no event stays relevant for a month.
  env.DB.prepare('DELETE FROM alerts WHERE sent_at < ?').bind(now-30*86400000)]);
 return {job:'cleanup'};
}
// event.cron says which trigger fired: the daily one cleans up, any other syncs. Each run logs one structured line.
export async function scheduled(event,env,at=event.scheduledTime,fetchImpl=fetch){
 const started=Date.now();
 try{
  const result=event.cron===DAILY_CRON?await cleanup(env):await scheduledSync(env,fetchImpl,at);
  log({e:'cron',...result,ms:Date.now()-started});
  return result;
 }catch(error){log({e:'cron',job:event.cron===DAILY_CRON?'cleanup':'sync',failed:true,ms:Date.now()-started});throw error;}
}
export default {fetch:handleRequest,async scheduled(event,env,ctx){ctx.waitUntil(scheduled(event,env,event.scheduledTime));}};
