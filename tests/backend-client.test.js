import test from 'node:test';
import assert from 'node:assert/strict';
import {BackendClient} from '../backend.js';
function storage(){const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
const id=2124810474;
function client(fetchImpl=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}})){
 return new BackendClient('https://api.example',storage(),fetchImpl);
}
function auth(c){const hash=`#backend_session=${'a'.repeat(43)}&pilot=${id}&expires=${Date.now()+3600000}`;assert.equal(c.acceptRedirect(hash),true);}
test('accepts only a valid opaque backend redirect for an allowed pilot',()=>{
 const c=client();auth(c);assert.equal(c.has(id),true);assert.throws(()=>c.acceptRedirect('#backend_session=invalid&pilot=2124810474&expires=9999999999999'));
});
test('backend sessions are namespaced to their configured API origin',()=>{
 const s=storage(),a=new BackendClient('https://one.example',s),b=new BackendClient('https://two.example',s);auth(a);assert.equal(b.has(id),false);
});
test('private requests send opaque authorization to the backend and validate returned pilot',async()=>{
 let called;const c=client(async(url,options)=>{called={url,options};return Response.json({characterId:id,skills:{total_sp:100}});});auth(c);assert.equal((await c.privatePilot(id)).skills.total_sp,100);assert.equal(called.url,'https://api.example/api/session');assert.equal(called.options.headers.Authorization,`Bearer ${'a'.repeat(43)}`);
});
test('unauthorized or wrong-character response clears the local session',async()=>{
 const a=client(async()=>Response.json({error:'Expired'},{status:401}));auth(a);await assert.rejects(a.privatePilot(id),/Expired/);assert.equal(a.has(id),false);
 const b=client(async()=>Response.json({characterId:999}));auth(b);await assert.rejects(b.privatePilot(id),/different pilot/);assert.equal(b.has(id),false);
});
test('public requests never send the private session token',async()=>{
 let headers;const c=client(async(url,options)=>{headers=options.headers;return Response.json({pilots:[]});});auth(c);assert.deepEqual(await c.publicPilots(),[]);assert.equal(headers.Authorization,undefined);
});
test('disconnect removes local session only after backend confirms deletion',async()=>{
 const c=client(async()=>Response.json({disconnected:true}));auth(c);await c.disconnect(id);assert.equal(c.has(id),false);
 const b=client(async()=>Response.json({error:'Unavailable'},{status:503}));auth(b);await assert.rejects(b.disconnect(id));assert.equal(b.has(id),true);
});
test('fetch is called without binding it to the client object',async()=>{
 const c=client(function(){assert.equal(this,undefined);return Promise.resolve(Response.json({pilots:[]}));});await c.publicPilots();
});
test('sessions last up to 31 days and adopt the longer expiry the backend returns',async()=>{
 const later=Date.now()+30*86400000;
 const c=client(async()=>Response.json({characterId:id,expires:later}));auth(c);
 await c.privatePilot(id);assert.equal(c.expires(id),later);
 assert.throws(()=>c.acceptRedirect(`#backend_session=${'b'.repeat(43)}&pilot=${id}&expires=${Date.now()+40*86400000}`));
 const s=storage();const a=new BackendClient('https://api.example',s);a.acceptRedirect(`#backend_session=${'c'.repeat(43)}&pilot=${id}&expires=${later}`);
 assert.equal(new BackendClient('https://api.example',s).has(id),true,'a new page load finds the stored session');
});
test('the market read carries a signed-in session when there is one so pilot regions come back',async()=>{
 const seen=[];const c=client(async(url,options)=>{seen.push(options.headers.Authorization);return Response.json({meta:null,universe:null,regions:[]});});
 await c.market();auth(c);await c.market();
 assert.deepEqual(seen,[undefined,`Bearer ${'a'.repeat(43)}`]);
});
test('an HTML or empty error page reports the HTTP status, not a JSON parse error',async()=>{
 const html=client(async()=>new Response('<!doctype html><h1>502 Bad Gateway</h1>',{status:502,headers:{'Content-Type':'text/html'}}));
 await assert.rejects(html.publicPilots(),{message:'Backend returned 502.'});
 const empty=client(async()=>new Response(null,{status:503}));
 await assert.rejects(empty.publicPilots(),{message:'Backend returned 503.'});
 const json=client(async()=>Response.json({error:'Pilot is syncing.'},{status:409}));
 await assert.rejects(json.publicPilots(),{message:'Pilot is syncing.'});
 const garbled=client(async()=>new Response('<html>',{status:200,headers:{'Content-Type':'text/html'}}));
 await assert.rejects(garbled.publicPilots(),{message:'Backend returned an unreadable response.'});
});
test('a connection link this tab did not start cannot replace a pilot’s valid session',()=>{
 globalThis.sessionStorage=storage();
 try{
  const c=client();auth(c);
  const link=token=>`#backend_session=${token.repeat(43)}&pilot=${id}&expires=${Date.now()+3600000}`;
  assert.throws(()=>c.acceptRedirect(link('z')),/already connected/);assert.equal(c.sessions.get(id).token,'a'.repeat(43));
  assert.equal(c.connect(id),`https://api.example/auth/start?pilot=${id}`,'Reconnect marks this tab as expecting the redirect');
  assert.equal(new BackendClient('https://api.example',c.storage).acceptRedirect(link('z')),true,'the redirect lands on a fresh page load');
  const after=new BackendClient('https://api.example',c.storage);assert.equal(after.sessions.get(id).token,'z'.repeat(43));
  assert.throws(()=>after.acceptRedirect(link('y')),/already connected/,'the mark is used once');
 }finally{delete globalThis.sessionStorage;}
});
