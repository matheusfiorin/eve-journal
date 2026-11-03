import test from 'node:test';
import assert from 'node:assert/strict';
import {jobState,wingJobs,slotKind,ACTIVITIES} from '../jobs.js';
const now=Date.UTC(2026,10,2,12),h=n=>new Date(now+n*3600000).toISOString();
const job=(id,activity,start,end,status='active',extra={})=>({job_id:id,activity_id:activity,start_date:h(start),end_date:h(end),status,runs:1,...extra});
test('a job reports progress, time left, and counts as ready once its end has passed',()=>{
 const s=jobState(job(1,1,-1,1),now);assert.equal(s.progress,0.5);assert.equal(s.remaining,3600000);assert.equal(s.active,true);assert.equal(s.ready,false);
 const late=jobState(job(2,5,-5,-1),now);assert.equal(late.ready,true,'ESI can still say active after the end');assert.equal(late.progress,1);assert.equal(late.active,false);
 assert.equal(jobState(job(3,1,-1,5,'paused'),now).paused,true);assert.equal(jobState({status:'ready'},now).progress,1);
});
test('wing jobs list ready first then soonest, and count slots per pilot by kind',()=>{
 const pilots=[{name:'Fiofka',levels:{massProduction:3,labOperation:1},jobs:[job(1,1,-1,10),job(2,5,-24,-1,'active'),job(3,4,-1,2)]},
  {name:'Decxus',jobs:[job(4,1,-1,5),job(5,1,-9,-2,'delivered'),job(6,1,-1,20,'paused')]}];
 const w=wingJobs(pilots,now);
 assert.deepEqual(w.list.map(x=>x.job.job_id),[2,3,4,1,6]);assert.equal(w.ready,1);assert.equal(w.running,3);assert.equal(w.next.job.job_id,3);
 assert.deepEqual(w.usage[0],{pilot:'Fiofka',build:1,science:1,total:{build:4,science:2}});assert.equal(w.usage[1].total,null,'skills unknown');assert.equal(w.usage[1].build,2,'paused jobs still hold a slot');
 assert.equal(slotKind(8),'science');assert.equal(slotKind(9),'build');assert.equal(ACTIVITIES[5],'Copying');
});
