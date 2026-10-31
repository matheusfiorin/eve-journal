import test from 'node:test';
import assert from 'node:assert/strict';
import {skillLevels,isAlpha,slots,materialsFor,researchTarget,researchTime,researchCost,buildSeconds,evaluate,rank,portfolio,confidence,stage,nextSkills,RESEARCH_SECONDS,SCC,NPC_FACILITY_TAX,ALPHA_TAX} from '../industry.js';
import {book} from '../market.js';
const ids={industry:1,massProduction:2,metallurgy:3,advancedIndustry:4,labOperation:5};
test('skill levels, alpha detection and job slots',()=>{
 const skills={skills:[{skill_id:1,trained_skill_level:5,active_skill_level:5},{skill_id:2,trained_skill_level:3,active_skill_level:3}]};
 const l=skillLevels(skills,ids);assert.deepEqual(l,{industry:5,massProduction:3,metallurgy:0,advancedIndustry:0,labOperation:0});
 assert.equal(isAlpha(skills),false);assert.equal(isAlpha({skills:[{skill_id:1,trained_skill_level:5,active_skill_level:3}]}),true);
 assert.deepEqual(slots(l),{build:4,science:1});assert.deepEqual(slots({massProduction:5,advancedMassProduction:5,labOperation:5,advancedLabOperation:5}),{build:11,science:11});
});
test('ME rounding happens per job and never drops below one unit per run',()=>{
 // EVE University example: 31 Tritanium per run at ME 2 is 30.38 for one run but 3,038 for 100.
 assert.equal(materialsFor(31,1,2),31);assert.equal(materialsFor(31,100,2),3038);
 assert.equal(materialsFor(1,10,10),10);assert.equal(materialsFor(1000,1,10),900);
});
test('research targets, time and cost follow the rank table',()=>{
 assert.equal(researchTarget(1),10);assert.equal(researchTarget(5),8);assert.equal(researchTarget(20),6);
 const total=RESEARCH_SECONDS.reduce((a,b)=>a+b,0);
 assert.equal(researchTime(1,0,10),total);assert.ok(Math.abs(total/86400-5.1)<0.05,'rank 1 to ME 10 takes about 5.1 days');
 assert.equal(researchTime(20,0,5),20*(105+250+595+1414+3360));
 assert.ok(Math.abs(researchTime(1,0,10,{metallurgy:3,advancedIndustry:2})-total*0.85*0.94)<1e-6);
 assert.ok(Math.abs(researchCost(1000,9,10,0.01)-1000*0.02*(256000/105)*(0.01+NPC_FACILITY_TAX+SCC.research))<1e-6);
 assert.ok(researchCost(1000,0,1,0,true)>researchCost(1000,0,1,0));
 assert.equal(buildSeconds(300,{industry:5,advancedIndustry:5}),300*0.8*0.85);
});
const market=book([{data:{name:'The Forge',stations:{1:[30000142,'Jita']},types:{
 2454:{d:2000,s:[[1,10000,500]],b:[[1,8000,100]]},
 34:{d:1e7,s:[[1,5,1e7]],b:[]},
 587:{d:30,s:[[1,400000,5]],b:[]}
}}}]);
const hob={type:2454,bp:2456,n:'Hobgoblin I',cat:'Drone',q:1,t:300,rank:1,limit:300,price:250000,m:[[34,1000]]};
const fees={salesTax:0.075,brokerFee:0.03};
test('evaluate prices a starter blueprint at its research target with live asks',()=>{
 const r=evaluate(hob,{book:market,adjusted:new Map([[34,4]]),fees,index:0.01,researchIndex:0.01,levels:{massProduction:3}});
 assert.equal(r.me,10);assert.equal(r.unitsPerDay,100,'5% of 2,000 daily volume');
 assert.equal(r.materialCost,4500);assert.ok(Math.abs(r.jobFee-4000*(0.01+NPC_FACILITY_TAX+SCC.manufacturing))<1e-9);
 assert.ok(Math.abs(r.profit-(10000*0.895-4500-r.jobFee))<1e-9);assert.ok(r.profitAtZero<r.profit,'research pays off');
 assert.ok(Math.abs(r.payback-((250000+r.research.cost)/r.profitDay+r.research.seconds/86400))<1e-9);
 assert.equal(evaluate({...hob,m:[[99,1]]},{book:market,adjusted:new Map(),fees}),null,'unknown material price');
 const alpha=evaluate(hob,{book:market,adjusted:new Map([[34,4]]),fees,alpha:true});assert.ok(Math.abs(alpha.jobFee-4000*(NPC_FACILITY_TAX+SCC.manufacturing+ALPHA_TAX))<1e-9);
});
test('slots cap output when the market would take more',()=>{
 const r=evaluate({...hob,type:2454},{book:book([{data:{name:'x',stations:{},types:{2454:{d:1e6,s:[[1,10000,1]],b:[]},34:{d:1,s:[[1,5,1]],b:[]}}}}]),adjusted:new Map(),fees,levels:{}});
 assert.equal(r.unitsPerDay,288,'one slot, 5 minutes per unit');
});
test('rank drops losers and slow paybacks and puts affordable picks first',()=>{
 const a={profit:10,payback:5,profitDay:100,invest:50},b={profit:10,payback:2,profitDay:1000,invest:5000},c={profit:-1,payback:1,profitDay:-1,invest:1},d={profit:5,payback:90,profitDay:1,invest:1};
 assert.deepEqual(rank([a,b,c,d,null],100).map(x=>x.invest),[50,5000]);
 assert.deepEqual(rank([a,b],undefined).map(x=>x.invest),[5000,50]);
});
test('stage and next skills follow the wallet and alpha limits',()=>{
 assert.match(stage(5e6).name,/Week 1/);assert.match(stage(undefined).name,/Week 1/);assert.match(stage(50e6).name,/Weeks 2/);assert.match(stage(2e8).name,/Months/);
 assert.deepEqual(nextSkills({},false,3).map(s=>[s.key,s.level]),[['industry',3],['massProduction',3],['science',3]]);
 const alpha=nextSkills({industry:3,massProduction:3,science:3,brokerRelations:2},true);
 assert.ok(alpha.every(s=>!s.omega));assert.deepEqual(alpha.map(s=>s.key),['industry','science']);
});
test('sells at the hub with the most volume and fetches materials where the main input is cheapest',()=>{
 const twoHubs=book([{data:{name:'The Forge',stations:{1:[30000142,'Jita']},types:{2454:{d:100,s:[[1,9000,5]],b:[]},34:{d:1e6,s:[[1,5,1e7]],b:[]}}}},
  {data:{name:'Domain',stations:{2:[30002187,'Amarr']},types:{2454:{d:5000,s:[[2,11000,50]],b:[]},34:{d:1e6,s:[[2,6,1e7]],b:[]}}}}]);
 const r=evaluate(hob,{book:twoHubs,adjusted:new Map(),fees});
 assert.equal(r.sell.loc,2);assert.ok(Math.abs(r.revenue-11000*0.895)<1e-9);assert.equal(r.materialsAt,1);assert.equal(r.materialsRegion,'The Forge');
});
test('trend compares the hub ask with its 7-day average',()=>{
 const m=book([{data:{name:'The Forge',stations:{1:[30000142,'Jita']},types:{2454:{d:2000,p:8000,s:[[1,10000,500]],b:[]},34:{d:1e6,s:[[1,5,1e7]],b:[]}}}}]);
 const r=evaluate(hob,{book:m,adjusted:new Map(),fees});assert.ok(Math.abs(r.trend-0.25)<1e-9);assert.equal(r.listings,1);assert.equal(r.daily,2000);
 assert.equal(evaluate(hob,{book:market,adjusted:new Map(),fees}).trend,null);
});
test('a thin market is priced at most 15% over its 7-day average and not padded to one sale a day',()=>{
 const m=book([{data:{name:'The Forge',stations:{1:[30000142,'Jita']},types:{2454:{d:3,p:10000,s:[[1,150000,1]],b:[]},34:{d:1e6,s:[[1,5,1e7]],b:[]}}}}]);
 const r=evaluate(hob,{book:m,adjusted:new Map(),fees});
 assert.equal(r.sellPrice,11500);assert.equal(r.price,250000,'the blueprint price is untouched');assert.ok(Math.abs(r.unitsPerDay-0.15)<1e-9);assert.equal(r.runs,1);assert.deepEqual(r.flags,['thin','spike','slow']);
 assert.ok(confidence(r)<0.25);
});
test('the material bill comes from one region, even when another region is cheaper for one input',()=>{
 const m=book([{data:{name:'The Forge',stations:{1:[30000142,'Jita']},types:{2454:{d:2000,s:[[1,10000,500]],b:[]},34:{d:1e6,s:[[1,5,1e7]],b:[]},35:{d:1e6,s:[[1,10,1e7]],b:[]}}}},
  {data:{name:'Domain',stations:{2:[30002187,'Amarr']},types:{34:{d:1e6,s:[[2,4,1e7]],b:[]}}}}]);
 const r=evaluate({...hob,m:[[34,1000],[35,10]]},{book:m,adjusted:new Map(),fees});
 assert.equal(r.materialsRegion,'The Forge');assert.deepEqual(r.bill.map(b=>[b.type,b.price,b.loc]),[[34,5,1],[35,10,1]]);
});
test('required skills the pilot lacks are flagged and ranked after buildable picks',()=>{
 const r=evaluate({...hob,sk:[[3436,3]]},{book:market,adjusted:new Map(),fees,skillOf:id=>id===3436?1:0});
 assert.deepEqual(r.missing,[[3436,3]]);assert.ok(r.flags.includes('skills'));
 assert.deepEqual(evaluate({...hob,sk:[[3436,3]]},{book:market,adjusted:new Map(),fees}).missing,[],'unknown skills are not held against the pick');
 const ok=evaluate(hob,{book:market,adjusted:new Map(),fees});
 assert.deepEqual(rank([{...ok,profitDay:ok.profitDay*0.1},r]).map(x=>x.missing.length),[0,1]);
});
test('the portfolio fills build slots with affordable, buildable picks within budget',()=>{
 const pick=(invest,profitDay,flags=[])=>({invest,profitDay,flags,affordable:true});
 const plan=portfolio([pick(10,5),pick(100,50,['skills']),pick(80,40),pick(20,3),pick(5,1)],{slots:2,budget:60});
 assert.deepEqual(plan.chosen.map(x=>x.invest),[10,20]);assert.equal(plan.spent,30);assert.equal(plan.profitDay,8);
});
