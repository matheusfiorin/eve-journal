import test from 'node:test';
import assert from 'node:assert/strict';
import {BackendClient} from '../backend.js';
function storage(){const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};}
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
