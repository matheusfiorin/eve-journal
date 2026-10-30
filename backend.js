export class BackendClient {
 constructor(url,storage=globalThis.sessionStorage,fetchImpl=globalThis.fetch){
  const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error('The backend URL must use HTTPS.');
  this.url=parsed.origin;this.storage=storage;this.fetch=(...args)=>fetchImpl(...args);this.key=`eve-backend-sessions:${this.url}`;
  try{this.sessions=new Map(JSON.parse(storage.getItem(this.key)||'[]').filter(([id,s])=>Number.isSafeInteger(id)&&/^[\w-]{43}$/.test(s?.token)&&s.expires>Date.now()));}catch{this.sessions=new Map();}
 }
 save(){this.storage.setItem(this.key,JSON.stringify([...this.sessions]));}
 has(id){return this.sessions.get(id)?.expires>Date.now();}
 expires(id){return this.sessions.get(id)?.expires;}
 acceptRedirect(hash){
  const params=new URLSearchParams(hash.replace(/^#/,''));if(!params.has('backend_session'))return false;
  const token=params.get('backend_session'),id=Number(params.get('pilot')),expires=Number(params.get('expires'));
  if(![2124810474,2124815118].includes(id)||!token||!/^[\w-]{43}$/.test(token)||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+25*3600000)throw new Error('Backend session response was invalid. Connect the pilot again.');
  this.sessions.set(id,{token,expires});this.save();return true;
 }
 async call(path,{id,method='GET'}={}){
  const headers={Accept:'application/json'};if(id){if(!this.has(id))throw new Error('Connect this pilot again.');headers.Authorization=`Bearer ${this.sessions.get(id).token}`;}
  const response=await this.fetch(`${this.url}${path}`,{method,headers,signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  if(!response.ok){if(response.status===401&&id){this.sessions.delete(id);this.save();}throw new Error(body.error||`Backend returned ${response.status}.`);}
  return body;
 }
 async publicPilots(){const data=await this.call('/api/public/pilots');if(!Array.isArray(data.pilots))throw new Error('Backend returned an invalid public snapshot.');return data.pilots;}
 async privatePilot(id,force=false){
  const data=await this.call(force?'/api/sync':'/api/session',{id,method:force?'POST':'GET'});
  if(data.characterId!==id){this.sessions.delete(id);this.save();throw new Error('Backend returned a different pilot. Connect again.');}
  return data;
 }
 authURL(id){return `${this.url}/auth/start?pilot=${encodeURIComponent(id)}`;}
 async wing(id){const data=await this.call('/api/wing',{id});if(!Array.isArray(data.pilots))throw new Error('Backend returned an invalid wing summary.');return data.pilots;}
 async market(){return this.call('/api/market');}
 async disconnect(id){await this.call('/api/disconnect',{id,method:'POST'});this.sessions.delete(id);this.save();}
 expire(){const ids=[];for(const[id,s]of this.sessions)if(s.expires<=Date.now()){ids.push(id);this.sessions.delete(id);}if(ids.length)this.save();return ids;}
}
