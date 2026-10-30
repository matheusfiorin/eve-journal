import {emptyData, validateBackup, mergeBackups, remaining, escapeHTML as esc} from './model.js';
const $=s=>document.querySelector(s), KEY='eve-flight-journal:v1', SETTINGS='eve-flight-settings:v1';
const callback = new URL('./',location.href).href;
const scope='esi-skills.read_skills.v1 esi-skills.read_skillqueue.v1';
let config={pilots:[],eveClientId:''}, data=emptyData(), pilots=[], sessions=new Map(), busy=false;
const types=new Map();
function notice(message) { $('#notice').textContent=message; $('#notice').hidden=false; }
function persist(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); data=next; renderLocal(); return true; }
  catch { notice('Browser storage is unavailable or full. Your change was not saved. Export your existing journal before clearing storage.'); return false; }
}
async function json(url,options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`EVE API returned ${response.status}${response.status===429 ? ' · rate limit reached; try again later' : ''}.`);
  return response.json();
}
const esi=(path,token,options={})=>json(`https://esi.evetech.net/latest/${path}`,{...options,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers}});
async function typeName(id) {
  if (!types.has(id)) types.set(id,esi(`universe/types/${id}/?language=en`).then(x=>x.name).catch(()=>`Type ${id}`));
  return types.get(id);
}
function pilotOptions() {
  const names=pilots.map(p=>p.name);
  document.querySelectorAll('.pilot-select').forEach(s=>{const prior=s.value;s.innerHTML=['Both pilots',...names].map(n=>`<option>${esc(n)}</option>`).join('');if([...s.options].some(o=>o.value===prior))s.value=prior;});
}
async function loadPilots() {
  if (busy) return; busy=true;$('#refresh').disabled=true;
  try {
    pilots=config.pilots.map(name=>({name}));renderPilots();pilotOptions();
    if (pilots.length) {
      const result=await esi('universe/ids/?language=en',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config.pilots)});
      await Promise.all(pilots.map(async p=>{
        const match=(result.characters||[]).find(c=>c.name.toLowerCase()===p.name.toLowerCase());
        if (!match) {p.error='Character not found. Check the exact name.';return;}
        p.id=match.id;p.name=match.name;
        try {p.profile=await esi(`characters/${p.id}/`);const corp=await esi(`corporations/${p.profile.corporation_id}/`);p.corporation=corp.name;}catch(e){p.error=e.message;}
        const session=sessions.get(p.id);
        if(session && session.expires>Date.now()) {
          try {const [skills,queue]=await Promise.all([esi(`characters/${p.id}/skills/`,session.token),esi(`characters/${p.id}/skillqueue/`,session.token)]);p.skills=skills;p.queue=queue.sort((a,b)=>a.queue_position-b.queue_position);p.synced=new Date();
            await Promise.all(p.queue.map(async q=>q.name=await typeName(q.skill_id)));
          } catch(e){p.error=`Training sync failed: ${e.message}`;}
        } else if(session) {sessions.delete(p.id);sessionStorage.removeItem('eve-sessions');p.error='EVE session expired. Connect again to refresh training.';}
      }));
    }
    renderPilots();pilotOptions();renderTraining();
  } catch(e) {notice(`Could not refresh pilots. ${e.message}`);renderPilots();renderTraining();}
  finally {busy=false;$('#refresh').disabled=false;}
}
function renderPilots() {
  $('#pilots').innerHTML=pilots.length ? pilots.map((p,i)=>`<article class="pilot-card"><div class="pilot-head"><div class="portrait">${p.id?`<img src="https://images.evetech.net/characters/${p.id}/portrait?size=128" alt="Portrait of ${esc(p.name)}">`:'✦'}</div><div><span class="badge">PILOT 0${i+1}</span><h3>${esc(p.name)}</h3><small class="muted">${esc(p.corporation||'Awaiting ESI profile')}</small></div></div><div class="stats"><div><small>TOTAL SKILL POINTS</small><strong>${p.skills?Number(p.skills.total_sp).toLocaleString():'Connect EVE'}</strong></div><div><small>SKILLS IN QUEUE</small><strong>${p.queue?p.queue.length:'—'}</strong></div></div>${p.error?`<p class="muted hint">${esc(p.error)}</p>`:''}<p class="muted hint">${p.synced?`Training synced ${p.synced.toLocaleTimeString()}`:'Read-only skills and training access · session only'}</p><button data-connect="${i}" class="secondary" ${p.id ? '' : 'disabled'}>${sessions.has(p.id)?'Reconnect':'Connect'} with EVE Online</button>${sessions.has(p.id)?` <button data-disconnect="${p.id}" class="secondary">Disconnect</button>`:''}</article>`).join('') : '<div class="empty">Your wing is waiting.<br><br>Use Configure pilots to add your two character names.</div>';
}
function renderTraining() {
  $('#training-content').innerHTML=pilots.length?pilots.map(p=>`<article class="panel"><span class="badge">${esc(p.name)}</span><h3>Training queue</h3>${p.queue?(p.queue.length?p.queue.map(q=>`<div class="queue-row"><span>${esc(q.name)} <small>→ Level ${q.finished_level}</small></span><span>${esc(q.finish_date?remaining(q.finish_date):'Paused / not scheduled')}</span></div>`).join(''):'<p class="muted">Your training queue is empty.</p>'):'<p class="muted">Connect this pilot with EVE Online from Overview to see their training.</p>'}${p.skills?`<details><summary>${p.skills.skills.length} trained skills · View skill list</summary><button data-skills="${p.id}" class="secondary">Load skill names</button><div id="skills-${p.id}"></div></details>`:''}</article>`).join(''):'<div class="empty">Configure your pilots to start tracking training.</div>';
}
function renderLocal() {
  $('#goal-list').innerHTML=data.goals.length?data.goals.map(g=>`<article class="goal ${g.done?'done':''}"><div><label><input type="checkbox" data-goal="${esc(g.id)}" ${g.done?'checked':''}>${esc(g.title)}</label><small>${esc(g.pilot)} · Browser-local goal</small></div><button data-delete-goal="${esc(g.id)}" class="secondary" aria-label="Delete ${esc(g.title)}">Delete</button></article>`).join(''):'<div class="empty">A new ship? A new system? Give your next adventure a goal.</div>';
  $('#entries').innerHTML=data.entries.length?[...data.entries].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<article class="entry"><div class="entry-top"><div><small>${esc(e.date)} / ${esc(e.pilot)} · PRIVATE</small><h3>${esc(e.title)}</h3></div><button data-delete-entry="${esc(e.id)}" class="secondary" aria-label="Delete ${esc(e.title)}">Delete</button></div><p>${esc(e.body)}</p></article>`).join(''):'<div class="empty">Every capsuleer starts somewhere.<br>Write down your first chapter.</div>';
}
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function connect(index) {
  if(!config.eveClientId) {notice('Add your EVE application client ID in Configure pilots first. See README.md for the EVE developer setup.');openSettings();return;}
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(48))),state=base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  sessionStorage.setItem('eve-oauth',JSON.stringify({verifier,state,created:Date.now(),expectedId:pilots[index].id,clientId:config.eveClientId}));
  const url=new URL('https://login.eveonline.com/v2/oauth/authorize/');
  url.search=new URLSearchParams({response_type:'code',redirect_uri:callback,client_id:config.eveClientId,scope,state,code_challenge:challenge,code_challenge_method:'S256'});location.assign(url);
}
async function finishLogin() {
  const params=new URLSearchParams(location.search);
  if(!params.has('code')&&!params.has('error'))return;
  history.replaceState(null,'',callback);
  const raw=sessionStorage.getItem('eve-oauth');sessionStorage.removeItem('eve-oauth');
  const pending=raw?JSON.parse(raw):null;
  if(!pending||params.get('state')!==pending.state||Date.now()-pending.created>600000)throw new Error('EVE login state expired or did not match. Please connect again.');
  if(params.has('error'))throw new Error('EVE login was cancelled or declined.');
  const result=await json('https://login.eveonline.com/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:params.get('code'),client_id:pending.clientId,code_verifier:pending.verifier,redirect_uri:callback})});
  const identity=await json('https://login.eveonline.com/oauth/verify',{headers:{Authorization:`Bearer ${result.access_token}`}});
  if(Number(identity.CharacterID)!==pending.expectedId)throw new Error('You logged in as a different character. Choose the configured pilot when connecting.');
  sessions.set(Number(identity.CharacterID),{token:result.access_token,expires:Date.now()+result.expires_in*1000});
  sessionStorage.setItem('eve-sessions',JSON.stringify([...sessions]));notice(`Connected ${identity.CharacterName}. Training access lasts for this EVE session; reconnect when it expires.`);
}
function openSettings() {const f=$('#settings-form');f.elements.pilot1.value=config.pilots[0]||'';f.elements.pilot2.value=config.pilots[1]||'';f.elements.clientId.value=config.eveClientId;$('#callback-url').textContent=callback;$('#settings').showModal();}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));document.querySelectorAll('.tab').forEach(s=>s.hidden=s.id!==b.dataset.tab);}));
$('#settings-button').onclick=openSettings;$('#close-settings').onclick=()=>$('#settings').close();$('#refresh').onclick=loadPilots;
$('#settings-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const next={pilots:[f.get('pilot1').trim(),f.get('pilot2').trim()].filter(Boolean),eveClientId:f.get('clientId').trim()};if(new Set(next.pilots.map(n=>n.toLowerCase())).size!==next.pilots.length){notice('Please use two different character names.');return;}try{localStorage.setItem(SETTINGS,JSON.stringify(next));}catch{notice('Unable to save browser configuration.');return;}config=next;$('#settings').close();await loadPilots();};
$('#goal-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),title=f.get('title').trim();if(!title)return;if(persist({...data,goals:[...data.goals,{id:crypto.randomUUID(),title,pilot:f.get('pilot'),done:false}]}))e.target.reset();};
$('#journal-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),title=f.get('title').trim(),body=f.get('body').trim();if(!title||!body)return;if(persist({...data,entries:[...data.entries,{id:crypto.randomUUID(),title,body,pilot:f.get('pilot'),date:f.get('date')}]})){e.target.reset();e.target.elements.date.value=new Date().toISOString().slice(0,10);}};
document.addEventListener('change',e=>{if(e.target.matches('[data-goal]'))persist({...data,goals:data.goals.map(g=>g.id===e.target.dataset.goal?{...g,done:e.target.checked}:g)});});
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  try {
    if(b.dataset.connect!==undefined)await connect(Number(b.dataset.connect));
    if(b.dataset.disconnect){sessions.delete(Number(b.dataset.disconnect));sessionStorage.setItem('eve-sessions',JSON.stringify([...sessions]));await loadPilots();}
    if(b.dataset.deleteGoal&&confirm('Delete this local goal?'))persist({...data,goals:data.goals.filter(g=>g.id!==b.dataset.deleteGoal)});
    if(b.dataset.deleteEntry&&confirm('Delete this private entry? Export a backup first if you want to keep it.'))persist({...data,entries:data.entries.filter(x=>x.id!==b.dataset.deleteEntry)});
    if(b.dataset.skills){b.disabled=true;const p=pilots.find(p=>p.id===Number(b.dataset.skills));const rows=[];for(let i=0;i<p.skills.skills.length;i+=8){rows.push(...await Promise.all(p.skills.skills.slice(i,i+8).map(async s=>({name:await typeName(s.skill_id),level:s.trained_skill_level}))));}rows.sort((a,b)=>a.name.localeCompare(b.name));$(`#skills-${p.id}`).innerHTML=rows.map(s=>`<div class="queue-row"><span>${esc(s.name)}</span><span>Level ${s.level}</span></div>`).join('');b.hidden=true;}
  }catch(error){notice(error.message);b.disabled=false;}
});
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`eve-journal-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5000000)throw new Error('Backup must be under 5 MB.');const incoming=validateBackup(JSON.parse(await file.text()));if(confirm(`Merge ${incoming.entries.length} entries and ${incoming.goals.length} goals? Records with matching IDs will be replaced.`))persist(mergeBackups(data,incoming));}catch(error){notice(`Import failed: ${error.message}`);}finally{e.target.value='';}};
async function init(){
  try{const saved=localStorage.getItem(KEY);if(saved)data=validateBackup(JSON.parse(saved));}catch{notice('Could not read the local journal. Existing storage has been left untouched. Export or recover it before saving new records.');document.querySelectorAll('#goal-form button,#journal-form button,#import').forEach(b=>b.disabled=true);}
  try{config=await json('./config.json');const saved=localStorage.getItem(SETTINGS);if(saved)config=JSON.parse(saved);if(!Array.isArray(config.pilots)||config.pilots.length>2||config.pilots.some(p=>typeof p!=='string'))throw new Error('Invalid pilot configuration');config.eveClientId=String(config.eveClientId||'');}catch(e){config={pilots:[],eveClientId:''};notice(`Using empty configuration: ${e.message}`);}
  try{sessions=new Map(JSON.parse(sessionStorage.getItem('eve-sessions')||'[]'));await finishLogin();}catch(e){notice(`EVE connection failed: ${e.message} No credentials were saved to the repository.`);}
  $('#journal-form').elements.date.value=new Date().toISOString().slice(0,10);renderLocal();await loadPilots();
}
await init();
