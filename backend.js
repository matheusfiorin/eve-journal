const MAX_SESSION=31*86400000;
export class BackendClient {
 constructor(url,storage=globalThis.localStorage,fetchImpl=globalThis.fetch){
  const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error('The backend URL must use HTTPS.');
  this.url=parsed.origin;this.storage=storage;this.fetch=(...args)=>fetchImpl(...args);this.key=`eve-backend-sessions:${this.url}`;this.connectKey=`eve-backend-connect:${this.url}`;
  // Sessions used to live in sessionStorage and died with the tab; carry an open tab's session over once.
  try{const legacy=globalThis.sessionStorage?.getItem(this.key);if(legacy&&!storage.getItem(this.key))storage.setItem(this.key,legacy);globalThis.sessionStorage?.removeItem(this.key);}catch{/* Start fresh. */}
  this.sessions=new Map();this.expire(); // Sessions that ran out while no page was open go quietly.
 }
 // Every tab of this browser shares the stored sessions. Read them fresh before each change and touch only the pilot
 // being changed, so a tab opened before the other pilot connected can't write back a map without them.
 read(){try{return new Map(JSON.parse(this.storage.getItem(this.key)||'[]').filter(([id,s])=>Number.isSafeInteger(id)&&/^[\w-]{43}$/.test(s?.token)&&Number.isFinite(s.expires)));}catch{return null;}}
 // Adopt what another tab stored (call on a storage event); without readable storage the in-memory sessions stay.
 reload(){const stored=this.memoryOnly?null:this.read();if(stored)this.sessions=stored;return this.sessions;}
 change(id,fn){
  this.reload();const next=fn(this.sessions.get(id));
  if(next)this.sessions.set(id,next);else this.sessions.delete(id);
  try{this.storage.setItem(this.key,JSON.stringify([...this.sessions]));}catch{this.memoryOnly=true;/* Sessions last for this page only. */}
 }
 // Drop a session only if it is still the token that failed: another tab may have reconnected the pilot meanwhile.
 drop(id,token){this.change(id,s=>s&&(token===undefined||s.token===token)?null:s);}
 has(id){return this.sessions.get(id)?.expires>Date.now();}
 expires(id){return this.sessions.get(id)?.expires;}
 acceptRedirect(hash){
  const params=new URLSearchParams(hash.replace(/^#/,''));if(!params.has('backend_session'))return false;
  const token=params.get('backend_session'),id=Number(params.get('pilot')),expires=Number(params.get('expires'));
  if(![2124810474,2124815118].includes(id)||!token||!/^[\w-]{43}$/.test(token)||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+MAX_SESSION)throw new Error('Backend session response was invalid. Connect the pilot again.');
  // A link carrying someone else's session must not silently replace a working one (login CSRF): a pilot who is
  // already connected here is replaced only by a redirect this tab asked for with connect().
  const mark=this.tab(t=>{const v=t.getItem(this.connectKey);t.removeItem(this.connectKey);return v;});
  let asked=null;try{asked=JSON.parse(mark);}catch{/* No mark. */}
  this.reload();
  if(this.has(id)&&!(asked?.id===id&&Date.now()-asked.at<1800000))throw new Error('This pilot is already connected in this browser; ignored a connection link it did not start. Use Reconnect to replace the session.');
  this.change(id,()=>({token,expires}));return true;
 }
 tab(fn){try{return globalThis.sessionStorage?fn(globalThis.sessionStorage):null;}catch{return null;}}
 // The EVE login URL for a pilot; remembers in this tab that a redirect back for them is expected.
 connect(id){this.tab(t=>t.setItem(this.connectKey,JSON.stringify({id,at:Date.now()})));return this.authURL(id);}
 async call(path,{id,method='GET',body}={}){
  const headers={Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})};const token=id?this.sessions.get(id)?.token:undefined;if(id){if(!this.has(id))throw new Error('Connect this pilot again.');headers.Authorization=`Bearer ${token}`;}
  const response=await this.fetch(`${this.url}${path}`,{method,headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  // A proxy or Cloudflare error page is HTML, not JSON: report the status rather than a parse error.
  const data=/json/i.test(response.headers.get('Content-Type')||'')?await response.json().catch(()=>null):null;
  if(!response.ok){if(response.status===401&&id)this.drop(id,token);throw new Error(data?.error||`Backend returned ${response.status}.`);}
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
 async market(){const id=[...this.sessions.keys()].find(id=>this.has(id));return this.call('/api/market',id?{id}:{});}
 async waypoints(id,systems){return this.call('/api/waypoints',{id,method:'POST',body:{systems}});}
 async disconnect(id){await this.call('/api/disconnect',{id,method:'POST'});this.drop(id);}
 expire(){this.reload();const ids=[...this.sessions].filter(([,s])=>s.expires<=Date.now()).map(([id])=>id);for(const id of ids)this.change(id,s=>s&&s.expires<=Date.now()?null:s);return ids;}
}
