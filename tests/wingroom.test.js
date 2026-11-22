// The wing room's coordination messages (worker/wingroom.js): live status, acknowledgements and shared sessions. The Durable
// Object is tested directly over SQLite, as in worker.test.js; these tests cover only the types added after timers, plans and pings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync} from 'node:crypto';
import {WingRoom,cleanStatus,cleanSession,cleanContrib,sessionTotals,STATUS_TTL,DAY,MAX_SESSIONS,MAX_ROUTE} from '../worker/wingroom.js';

const FIO=2124810474,DEC=2124815118,JITA=30000142,PERIMETER=30000144,AMARR=30002187;
function fakeState(){
 const raw=new DatabaseSync(':memory:'),sockets=[],alarms=[];
 return {raw,sockets,alarms,storage:{sql:{exec(text,...bind){const st=raw.prepare(text);return {toArray:()=>st.columns().length?st.all(...bind):(st.run(...bind),[])};}},setAlarm:async at=>{alarms.push(at);}},
  acceptWebSocket(ws){sockets.push(ws);},getWebSockets:()=>sockets.filter(w=>!w.closed)};
}
function fakeSocket(){return {sent:[],closed:false,att:null,send(m){this.sent.push(JSON.parse(m));},serializeAttachment(a){this.att=a;},deserializeAttachment(){return this.att;},close(){this.closed=true;},all(type){return this.sent.filter(m=>m.type===type);},last(type){return [...this.sent].reverse().find(m=>m.type===type);}};}
function room(env={},extra={}){const state=fakeState(),r=new WingRoom(state,env,extra);return {state,r,join(pilot,name){const ws=fakeSocket();r.attach(ws,pilot,name);return ws;}};}
const send=(r,ws,msg)=>r.webSocketMessage(ws,typeof msg==='string'?msg:JSON.stringify(msg));
// A D1 stand-in with only the push_tokens table (worker/migrations/0013_push_tokens.sql).
async function pushDb(){
 const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../worker/migrations/0013_push_tokens.sql',import.meta.url),'utf8'));
 return {raw:db,prepare(sql){return {bind(...v){const st=db.prepare(sql);return {all:async()=>({results:st.all(...v)}),run:async()=>st.run(...v),first:async()=>st.get(...v)||null};}};}};
}
async function pushRoom(){
 const calls=[],fetchImpl=async(url,init)=>{calls.push({url:String(url),init});return String(url).includes('oauth2')?new Response(JSON.stringify({access_token:'at',expires_in:3600})):new Response('{}');};
 const DB=await pushDb();DB.raw.prepare('INSERT INTO push_tokens (token, character_id, updated_at) VALUES (?, ?, ?), (?, ?, ?)').run('t-dec',DEC,1,'t-fio',FIO,2);
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
 const r=room({DB,FCM_SERVICE_ACCOUNT:JSON.stringify({client_email:'svc@x',private_key:key}),FCM_PROJECT_ID:'p'},{fetchImpl});
 return {...r,pushes:()=>calls.filter(c=>c.url.includes('messages:send')).map(c=>JSON.parse(c.init.body).message.data),calls};
}

test('status: a pilot\'s live status reaches the wingmate, is kept for a rejoin, and sharing off clears it',async()=>{
 const {r,join}=room(),a=join(FIO,'Fiofka'),b=join(DEC,'Decxus');
 assert.deepEqual(a.sent[0].statuses,[],'the snapshot names statuses');
 await send(r,a,{type:'status',status:{system:JITA,docked:false,shipType:17478,ship:'Retriever',activity:'mining',destination:AMARR,route:[JITA,PERIMETER,AMARR]}});
 const got=b.last('status');assert.equal(got.from,FIO);
 assert.deepEqual({...got.status,at:0},{share:true,activity:'mining',system:JITA,docked:false,shipType:17478,ship:'Retriever',destination:AMARR,route:[JITA,PERIMETER,AMARR],pilot:FIO,name:'Fiofka',at:0});
 assert.ok(!a.sent.some(m=>m.type==='status'),'not echoed');
 // The wingmate's phone reconnects later and still sees it.
 const c=join(DEC,'Decxus');assert.equal(c.sent[0].statuses[0].system,JITA);assert.equal(c.sent[0].statuses[0].route.length,3);
 // A newer status replaces the old one: one per pilot.
 await send(r,a,{type:'status',status:{system:PERIMETER,docked:true}});assert.deepEqual(r.snapshot().statuses.map(s=>[s.pilot,s.system,s.docked,s.activity,s.route]),[[FIO,PERIMETER,true,'idle',undefined]]);
 await send(r,a,{type:'status',status:{share:false,system:JITA}});assert.equal(b.last('status').status,null);assert.deepEqual(r.snapshot().statuses,[]);
});
test('status: old statuses expire; every field is validated',()=>{
 const {r}=room(),now=Date.now();
 r.apply({type:'status',status:{system:JITA}},FIO,'Fiofka',now-STATUS_TTL-1);r.apply({type:'status',status:{system:AMARR}},DEC,'Decxus',now-60000);
 assert.deepEqual(r.snapshot(now).statuses.map(s=>s.pilot),[DEC]);
 for(const bad of [null,[],'x',{system:5},{system:'30000142'},{docked:'yes'},{shipType:-1},{shipType:1.5},{ship:'x'.repeat(65)},{activity:'afk'},{destination:1},{route:[JITA,'x']},{route:Array(MAX_ROUTE+1).fill(JITA)},{route:'x'}])
  assert.equal(cleanStatus(bad),null,JSON.stringify(bad));
 assert.deepEqual(cleanStatus({}),{share:true,activity:'idle'});assert.deepEqual(cleanStatus({ship:'',system:null,route:[]}),{share:true,activity:'idle'});
 assert.equal(r.apply({type:'status',status:{system:1}},FIO,'Fiofka').error,'invalid status');
});
test('ack: the wingmate answers a ping seen / on it / can\'t; the answer is kept on the item and only an answer pushes',async()=>{
 const {r,join,pushes}=await pushRoom(),a=join(FIO,'Fiofka');
 await send(r,a,{type:'ping',id:'p1',kind:'help',text:'tackled'});
 const b=join(DEC,'Decxus'),n0=pushes().length;a.sent.length=0;
 await send(r,b,{type:'ack',ref:'p1',kind:'seen'});
 assert.deepEqual([a.last('ack').ref,a.last('ack').kind,a.last('ack').from],['p1','seen',DEC]);
 assert.equal(pushes().length,n0,'a seen never pushes');
 r.webSocketClose(a);a.closed=true;
 await send(r,b,{type:'ack',ref:'p1',kind:'onit'});
 assert.deepEqual(r.snapshot().items.find(i=>i.id==='p1').acks[DEC].kind,'onit');
 const push=pushes().at(-1);assert.deepEqual([push.type,push.kind,push.ack,push.from,push.pilot],['ack','ack','onit','Decxus',String(DEC)]);
 // A later "seen" does not undo "on it", and a repeat sends nothing.
 const before=b.sent.length,n=pushes().length;await send(r,b,{type:'ack',ref:'p1',kind:'seen'});await send(r,b,{type:'ack',ref:'p1',kind:'onit'});
 assert.equal(b.sent.length,before,'no error, nothing to say');assert.equal(pushes().length,n);assert.equal(r.snapshot().items[0].acks[DEC].kind,'onit');
 await send(r,b,{type:'ack',ref:'p1',kind:'cant'});assert.equal(r.snapshot().items[0].acks[DEC].kind,'cant','an answer can change');
 // Plans can be acknowledged too; your own items, unknown refs and odd kinds cannot.
 const a2=join(FIO,'Fiofka');await send(r,a2,{type:'plan.share',id:'pl',plan:{kind:'haul',title:'Jita run'}});await send(r,b,{type:'ack',ref:'pl',kind:'onit'});assert.equal(pushes().length,n+1,'the pinger reconnected: the cant pushed, this one did not');
 await send(r,a2,{type:'ack',ref:'pl',kind:'seen'});assert.equal(a2.last('error').code,'own_item');
 await send(r,b,{type:'ack',ref:'nope',kind:'seen'});assert.equal(b.last('error').code,'unknown_ref');
 await send(r,b,{type:'ack',ref:'p1',kind:'maybe'});assert.equal(b.last('error').code,'invalid_ack');
 await send(r,b,{type:'ack',kind:'seen'});assert.equal(b.last('error').code,'invalid_ack');
});
test('session: start together, both contributions add up (timers, systems, ISK), end with a summary both phones keep',async()=>{
 const {r,join}=room(),a=join(FIO,'Fiofka'),b=join(DEC,'Decxus');
 assert.equal(a.sent[0].session,null);assert.deepEqual(a.sent[0].sessions,[]);
 await send(r,a,{type:'session.start',session:{activity:'mining',goal:500e6,where:JITA,title:'Ore run'}});
 const started=b.last('session.start').session;assert.equal(a.last('session.start').session.id,started.id,'the starter gets it too');
 assert.deepEqual([started.activity,started.goal,started.where,started.title,started.startedBy,started.contrib],['mining',500e6,JITA,'Ore run',FIO,{}]);
 await send(r,b,{type:'session.start',session:{activity:'hauling'}});assert.equal(b.last('error').code,'session_active');
 // Timers started during the session count for their owner; a status in a new system counts as visited.
 await send(r,a,{type:'timer.upsert',timer:{id:'t1',kind:'mining',startedAt:Date.now(),durationMs:60000}});
 assert.equal(b.last('session.update').session.contrib[FIO].timers,1);
 await send(r,a,{type:'timer.upsert',timer:{id:'t1',kind:'mining',startedAt:Date.now(),durationMs:90000}});assert.equal(r.snapshot().session.contrib[FIO].timers,1,'an edit is not a new timer');
 await send(r,a,{type:'status',status:{system:JITA}});await send(r,a,{type:'status',status:{system:JITA}});await send(r,b,{type:'status',status:{system:PERIMETER}});await send(r,b,{type:'status',status:{system:JITA}});
 assert.deepEqual(r.snapshot().session.contrib[FIO].systems,[JITA]);assert.deepEqual(r.snapshot().session.contrib[DEC].systems,[PERIMETER,JITA]);
 await send(r,b,{type:'session.contrib',contrib:{isk:120e6,units:9000}});await send(r,a,{type:'session.contrib',contrib:{isk:80.4e6}});await send(r,a,{type:'session.contrib',contrib:{isk:90e6}});
 assert.equal(a.last('session.update').session.contrib[DEC].isk,120e6,'everyone hears a contribution');assert.equal(b.last('session.update').session.contrib[FIO].isk,90e6,'a report replaces the last');
 // A phone that rejoins mid-session gets it in the snapshot.
 const again=join(DEC,'Decxus');assert.equal(again.sent[0].session.id,started.id);
 await send(r,b,{type:'session.end'});
 const ended=a.last('session.end').session;assert.equal(b.last('session.end').session.id,started.id);
 assert.deepEqual(ended.totals,{isk:210e6,units:9000,timers:1,systems:2});assert.equal(ended.endedBy,DEC);assert.ok(ended.endedAt>=ended.startedAt);
 const snap=r.snapshot();assert.equal(snap.session,null);assert.equal(snap.sessions[0].id,started.id);
 await send(r,a,{type:'session.end'});assert.equal(a.last('error').code,'no_session');
 await send(r,a,{type:'session.contrib',contrib:{isk:1}});assert.equal(a.last('error').code,'no_session');
 await send(r,a,{type:'timer.upsert',timer:{id:'t2',kind:'gas',startedAt:Date.now(),durationMs:60000}});assert.ok(!a.sent.some(m=>m.type==='session.update'&&m.session.contrib[FIO].timers===2),'no session, nothing counted');
});
test('session: a forgotten session ends when a new one starts; ten ended sessions are kept; ending names the session',async()=>{
 const {r,join}=room(),a=join(FIO,'Fiofka'),now=Date.now();
 r.apply({type:'session.start',session:{activity:'exploring'}},DEC,'Decxus',now-DAY-1);
 await send(r,a,{type:'session.start',session:{activity:'ratting'}});
 assert.equal(a.last('session.start').session.activity,'ratting');const old=a.last('session.end').session;assert.equal(old.activity,'exploring');assert.equal(old.endedBy,0,'ended by the room');
 const current=r.snapshot().session.id;await send(r,a,{type:'session.end',session:{id:'someone-else'}});assert.equal(a.last('error').code,'no_session');assert.equal(r.snapshot().session.id,current);
 for(let i=0;i<MAX_SESSIONS+3;i++){r.apply({type:'session.end'},FIO,'Fiofka',now+i*2);r.apply({type:'session.start',session:{activity:'pvp'}},FIO,'Fiofka',now+i*2+1);}
 assert.equal(r.snapshot().sessions.length,MAX_SESSIONS);assert.equal(r.state.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE active = 0').get().n,MAX_SESSIONS,'older ones are deleted');
});
test('session: inputs are validated',()=>{
 for(const bad of [null,{},{activity:'idle'},{activity:'afk'},{activity:'mining',goal:-1},{activity:'mining',goal:2e13},{activity:'mining',where:5},{activity:'mining',title:'x'.repeat(81)}])assert.equal(cleanSession(bad),null,JSON.stringify(bad));
 assert.deepEqual(cleanSession({activity:'hauling',goal:0,title:''}),{activity:'hauling'});
 for(const bad of [null,{},{isk:'1'},{isk:Infinity},{isk:2e13},{units:-1},{units:1.5}])assert.equal(cleanContrib(bad),null,JSON.stringify(bad));
 assert.deepEqual(cleanContrib({isk:-5.6}),{isk:-6},'a wallet can go down');
 assert.deepEqual(sessionTotals({contrib:{}}),{isk:0,units:0,timers:0,systems:0});
 const {r}=room();assert.equal(r.apply({type:'session.start',session:{activity:'nap'}},FIO,'F').error,'invalid session');assert.equal(r.apply({type:'session.contrib',contrib:{}},FIO,'F').error,'invalid contrib');
});
test('session and timer pushes say what happened in a shape the app reads (type, the sender\'s id and name), never where',async()=>{
 const {r,join,pushes}=await pushRoom(),a=join(FIO,'Fiofka');
 await send(r,a,{type:'session.start',session:{activity:'mining',where:JITA}});
 const p=pushes().at(-1);assert.deepEqual([p.type,p.kind,p.activity,p.from,p.pilot],['session.start','session.start','mining','Fiofka',String(FIO)]);assert.ok(!JSON.stringify(p).includes(String(JITA)));
 await send(r,a,{type:'status',status:{system:JITA,activity:'mining'}});assert.equal(pushes().length,1,'a status never pushes');
 await send(r,a,{type:'session.end'});assert.equal(pushes().at(-1).type,'session.end');
 await send(r,a,{type:'ping',kind:'help'});assert.deepEqual([pushes().at(-1).type,pushes().at(-1).ping],['ping','help']);
});
test('the new types obey the size cap and the rate limit like the old ones',async()=>{
 const {r,join}=room(),a=join(FIO,'Fiofka');
 await send(r,a,JSON.stringify({type:'status',status:{ship:'x'.repeat(9000)}}));assert.equal(a.last('error').code,'too_large');
 let limited=false;for(let i=0;i<45;i++){await send(r,a,{type:'status',status:{system:JITA}});if(a.last('error')?.code==='rate_limited')limited=true;}assert.ok(limited);
});
