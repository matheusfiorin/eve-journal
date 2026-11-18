const MAX_SESSION=31*86400000,MARK_MS=1800000,PILOTS=[2124810474,2124815118];
export class BackendClient {
 constructor(url,storage=globalThis.localStorage,fetchImpl=globalThis.fetch){
  const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error('The backend URL must use HTTPS.');
  this.url=parsed.origin;this.storage=storage;this.fetch=(...args)=>fetchImpl(...args);this.key=`eve-backend-sessions:${this.url}`;this.connectKey=`eve-backend-connect:${this.url}`;
  // Sessions used to live in sessionStorage and died with the tab; carry an open tab's session over once.
  try{const legacy=globalThis.sessionStorage?.getItem(this.key);if(legacy&&!storage.getItem(this.key))storage.setItem(this.key,legacy);globalThis.sessionStorage?.removeItem(this.key);}catch{/* Start fresh. */}
  // Marks from logins nobody finished, and the per-tab mark this replaced, go too.
  try{globalThis.sessionStorage?.removeItem(this.connectKey);for(const id of PILOTS){const at=JSON.parse(storage.getItem(this.markKey(id)))?.at;if(at!==undefined&&!(Date.now()-at<MARK_MS))storage.removeItem(this.markKey(id));}}catch{/* Marks expire on use. */}
  this.sessions=new Map();this.expire(); // Sessions that ran out while no page was open go quietly.
 }
 // Every tab of this browser shares the stored sessions. Read them fresh before each change and touch only the pilot
 // being changed, so a tab opened before the other pilot connected can't write back a map without them.
 read(){try{return new Map(JSON.parse(this.storage.getItem(this.key)||'[]').filter(([id,s])=>Number.isSafeInteger(id)&&/^[\w-]{43}$/.test(s?.token)&&Number.isFinite(s.expires)));}catch{return null;}}
 // Adopt what another tab stored (call on a storage event); without readable storage the in-memory sessions stay.
 reload(){
  const stored=this.read();if(!stored)return this.sessions;
  // After a failed write some sessions exist only in this page: keep those the stored copy doesn't have.
  if(this.memoryOnly)for(const [id,s] of this.sessions)if(!stored.has(id))stored.set(id,s);
  this.sessions=stored;return this.sessions;
 }
 change(id,fn){
  this.reload();const next=fn(this.sessions.get(id));
  if(next)this.sessions.set(id,next);else this.sessions.delete(id);
  try{this.storage.setItem(this.key,JSON.stringify([...this.sessions]));this.memoryOnly=false;}catch{this.memoryOnly=true;/* Sessions last for this page only. */}
 }
 // Drop a session only if it is still the token that failed: another tab may have reconnected the pilot meanwhile.
 drop(id,token){this.change(id,s=>s&&(token===undefined||s.token===token)?null:s);}
 has(id){return this.sessions.get(id)?.expires>Date.now();}
 expires(id){return this.sessions.get(id)?.expires;}
 acceptRedirect(hash){
  const params=new URLSearchParams(hash.replace(/^#/,''));if(!params.has('backend_session'))return false;
  const token=params.get('backend_session'),id=Number(params.get('pilot')),expires=Number(params.get('expires'));
  if(!PILOTS.includes(id)||!token||!/^[\w-]{43}$/.test(token)||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+MAX_SESSION)throw new Error('Backend session response was invalid. Connect the pilot again.');
  // A link carrying someone else's session must not silently replace a working one (login CSRF): a pilot who is
  // already connected here is replaced only by a redirect this browser asked for with connect(), in any of its tabs.
  const asked=this.takeMark(id);
  this.reload();const old=this.sessions.get(id);
  if(this.has(id)&&!asked)throw new Error('This pilot is already connected in this browser; ignored a connection link it did not start. Use Reconnect to replace the session.');
  this.change(id,()=>({token,expires}));
  // The replaced session would otherwise live on at the Worker for 30 days. Only a holder of a token can end it, so
  // this never touches the pilot's sessions on other devices.
  if(old&&old.token!==token)this.revoke(old.token);
  return true;
 }
 // connect() leaves a mark in localStorage rather than sessionStorage: on a phone the EVE login often returns in
 // another tab (app switching), and that tab must still know this browser asked. Per pilot, used once, 30 minutes.
 markKey(id){return `${this.connectKey}:${id}`;}
 takeMark(id){try{const at=JSON.parse(this.storage.getItem(this.markKey(id)))?.at;this.storage.removeItem(this.markKey(id));return Number.isFinite(at)&&at<=Date.now()&&Date.now()-at<MARK_MS;}catch{return false;}}
 // The EVE login URL for a pilot; remembers in this browser that a redirect back for them is expected.
 connect(id){try{this.storage.setItem(this.markKey(id),JSON.stringify({at:Date.now()}));}catch{/* A reconnect then needs Disconnect first. */}return this.authURL(id);}
 // Ends one session at the Worker. Best effort: an unreachable Worker leaves it to expire on its own.
 revoke(token){return Promise.resolve().then(()=>this.fetch(`${this.url}/api/session/revoke`,{method:'POST',headers:{Accept:'application/json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)})).then(r=>r.ok,()=>false);}
 async call(path,{id,method='GET',body}={}){
  const headers={Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})};const token=id?this.sessions.get(id)?.token:undefined;if(id){if(!this.has(id))throw new Error('Connect this pilot again.');headers.Authorization=`Bearer ${token}`;}
  const response=await this.fetch(`${this.url}${path}`,{method,headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  // A proxy or Cloudflare error page is HTML, not JSON: report the status rather than a parse error.
  const data=/json/i.test(response.headers.get('Content-Type')||'')?await response.json().catch(()=>null):null;
  if(!response.ok){if(response.status===401&&id)this.drop(id,token);throw Object.assign(new Error(data?.error||`Backend returned ${response.status}.`),{status:response.status});}
  if(!data||typeof data!=='object')throw new Error('Backend returned an unreadable response.');
  return data;
 }
 async publicPilots(){const data=await this.call('/api/public/pilots');if(!Array.isArray(data.pilots))throw new Error('Backend returned an invalid public snapshot.');return data.pilots;}
 async privatePilot(id,force=false){
  const token=this.sessions.get(id)?.token;
  const data=await this.call(force?'/api/sync':'/api/session',{id,method:force?'POST':'GET'});
  if(data.characterId!==id){this.drop(id,token);throw new Error('Backend returned a different pilot. Connect again.');}
  // The backend extends active sessions; remember the new expiry.
  const s=this.sessions.get(id);
  if(s&&s.token===token&&Number.isFinite(data.expires)&&data.expires>s.expires&&data.expires<=Date.now()+MAX_SESSION)this.change(id,c=>c?.token===token?{...c,expires:Math.max(c.expires,data.expires)}:c);
  return data;
 }
 authURL(id){return `${this.url}/auth/start?pilot=${encodeURIComponent(id)}`;}
 async wing(id){const data=await this.call('/api/wing',{id});if(!Array.isArray(data.pilots))throw new Error('Backend returned an invalid wing summary.');return data.pilots;}
 // Any signed-in pilot unlocks the regions the pilots fly in; without one the backend serves the trade hubs only.
 // v=2 leaves the static universe out and names its version instead (see universe()); a Worker from before that ignores
 // it and sends everything inline. The browser's HTTP cache revalidates with the ETag, so an unchanged market is a 304.
 async market(){const id=[...this.sessions.keys()].find(id=>this.has(id));return this.call('/api/market?v=2',id?{id}:{});}
 // The static universe document (gate map, stations, ore and skill IDs): public, the same for every visitor, and
 // cached for a year under its version, so it is sent without a session.
 async universe(version){const data=await this.call(`/api/market/universe?v=${encodeURIComponent(version)}`);if(typeof data.version!=='string'||!data.meta||typeof data.meta!=='object')throw new Error('Backend returned an invalid universe map.');return data;}
 // One contract's items, read on demand: the backend checks the contract is the pilot's own.
 async contractItems(id,contractId){const data=await this.call(`/api/contract-items?id=${encodeURIComponent(contractId)}`,{id});if(!Array.isArray(data.items))throw new Error('Backend returned an invalid contract.');return data.items;}
 async waypoints(id,systems){return this.call('/api/waypoints',{id,method:'POST',body:{systems}});}
 // Journal sync: records after a rev, and changes sent against the rev each was based on (see worker/index.js).
 // prefs=1: this client understands pilot preferences; older clients aren't sent them, as they'd take them for entries.
 async journalPull(id,since){const data=await this.call(`/api/journal?since=${encodeURIComponent(since)}&prefs=1`,{id});if(!Array.isArray(data.records)||!Number.isSafeInteger(data.rev))throw new Error('Backend returned an invalid journal.');return data;}
 async journalPush(id,changes){const data=await this.call('/api/journal',{id,method:'POST',body:{changes}});if(![data.applied,data.conflicts,data.denied].every(Array.isArray))throw new Error('Backend returned an invalid journal reply.');return data;}
 // Deletes everything the backend stores about this pilot, then forgets the session (the backend ended it too).
 async forget(id){const token=this.sessions.get(id)?.token;await this.call('/api/forget',{id,method:'POST',body:{}});this.drop(id,token);}
 async disconnect(id){const token=this.sessions.get(id)?.token;await this.call('/api/disconnect',{id,method:'POST'});this.drop(id,token);}
 expire(){this.reload();const ids=[...this.sessions].filter(([,s])=>s.expires<=Date.now()).map(([id])=>id);for(const id of ids)this.change(id,s=>s&&s.expires<=Date.now()?null:s);return ids;}
}
