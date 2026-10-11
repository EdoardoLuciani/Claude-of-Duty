#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function analyzeProofReuse(report) {
  assert.equal(report.failure,null,'failed capture is not evidence');
  const c=report.proofReuse;assert(c?.replay?.timed?.length,'missing completed replay');
  const jobs=new Map(c.jobs.map(j=>[j.id,j]));
  const counts={}, hitUse={ownFirstRead:0,ownLaterRead:0,differentIntent:0,initial:0};
  const proofs=new Map(c.initialProofs.map(([key,value])=>[key,{value,intent:null,reads:0}]));
  const published=new Map(c.initialProofs), geometry=new Map(), goals=new Map();
  const misses={previouslyPublished:0,budgetOnlyPositive:0,sameSuccessfulGoal:0,unseenSuccessfulGoal:0,
    originDistance:{underMicrometre:0,underMillimetre:0,underCentimetre:0,underDecimetre:0,larger:0},yOnly:0};
  let evictions=0,peak=proofs.size,clears=0;
  const add=(name,n=1)=>counts[name]=(counts[name]??0)+n;
  const geomKey=k=>k.slice(0,8).join(','),goalKey=k=>k.slice(3).join(',');
  for(const e of c.events){
    if(e.type==='clear'){proofs.clear();published.clear();geometry.clear();goals.clear();clears++;continue;}
    if(e.type==='remember'){
      if(e.evicted!==null){assert(proofs.has(e.evicted));proofs.delete(e.evicted);evictions++;}
      if(published.has(e.key))assert.equal(published.get(e.key),e.value,'conflicting frozen proof');
      published.set(e.key,e.value);
      if(!proofs.has(e.key))proofs.set(e.key,{value:e.value,intent:e.intent,reads:0});
      peak=Math.max(peak,proofs.size);
      if(e.value){
        const k=e.key.split(',').map(Number), job=jobs.get(e.job);
        const required=job?.result ? job.result.moves+1 : 2; // conservative for zero/one-move prefixes
        const g=geomKey(k);geometry.set(g,Math.min(geometry.get(g)??Infinity,required));
        const goal=goalKey(k),list=goals.get(goal)??[];list.push(k);goals.set(goal,list);
      }
      continue;
    }
    assert.equal(e.type,'request');assert(e.key.every(n=>Number.isFinite(Number(n))));
    const label=e.status+(e.value===null?'':e.value?'True':'False');add(label);
    if(e.status==='hit'){
      const p=proofs.get(e.identity);assert(p,'hit without published proof');assert.equal(p.value,e.value);
      if(e.value){
        if(p.intent===null)hitUse.initial++;
        else if(p.intent!==e.intent)hitUse.differentIntent++;
        else if(p.reads===0)hitUse.ownFirstRead++;
        else hitUse.ownLaterRead++;
      }
      p.reads++;continue;
    }
    if(e.status!=='submitted')continue;
    const k=e.key.map(Number);if(published.has(e.identity))misses.previouslyPublished++;
    if((geometry.get(geomKey(k))??Infinity)<=k[8])misses.budgetOnlyPositive++;
    const prior=goals.get(goalKey(k));
    if(!prior?.length){misses.unseenSuccessfulGoal++;continue;}
    misses.sameSuccessfulGoal++;
    const nearest=prior.reduce((best,p)=>{const d=Math.hypot(k[0]-p[0],k[1]-p[1],k[2]-p[2]);return d<best.d?{d,p}:best;},{d:Infinity,p:null});
    const d=nearest.d,band=d<1e-6?'underMicrometre':d<.001?'underMillimetre':d<.01?'underCentimetre':d<.1?'underDecimetre':'larger';
    misses.originDistance[band]++;if(k[0]===nearest.p[0]&&k[2]===nearest.p[2]&&k[1]!==nearest.p[1])misses.yOnly++;
  }
  assert.equal((counts.hitTrue??0)+(counts.hitFalse??0),c.finalStats.proofHits-c.initialStats.proofHits);
  assert.equal(counts.submitted,c.jobs.length);assert.equal(proofs.size,c.finalProofs);
  const completed=c.jobs.filter(j=>j.result), traces=c.replay.traces;
  assert.equal(completed.length,traces.length);
  for(const t of traces){assert.equal(t.states.length,t.moves);for(const [i,s] of t.states.entries()){
    assert.equal(s.i,i);assert.equal(s.state.length,8);assert(s.state.every(n=>Number.isFinite(Number(n))));
  }}
  const wholeKey=k=>JSON.stringify(k), stateKey=(t,s,strict)=>JSON.stringify([...(strict?[t.key[1]]:[]),...t.key.slice(3,8),...s.state]);
  // Even future donors are admitted in this diagnostic upper bound. If it finds
  // no different-query match, timer-resolution ties cannot conceal a saving.
  const upperBound=strict=>{
    const states=new Map();
    for(const t of traces)if(t.value)for(const s of t.states){const key=stateKey(t,s,strict),list=states.get(key)??[];
      list.push({id:t.id,whole:wholeKey(t.key),remaining:t.moves-s.i});states.set(key,list);}
    let queries=0,moves=0,falseQueries=0;
    for(const t of traces)for(const s of t.states){
      const donor=states.get(stateKey(t,s,strict))?.find(p=>p.id!==t.id&&p.whole!==wholeKey(t.key)&&p.remaining<t.key[8]-s.i);
      if(donor){queries++;if(t.value)moves+=t.moves-s.i;else falseQueries++;break;}
    }
    return {queries,moves,falseQueries,uniqueStates:states.size};
  };
  const median=a=>{a.sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
  const timings=Object.fromEntries([...new Set(c.replay.timed.map(t=>t.mode))].map(mode=>{
    const rows=c.replay.timed.filter(t=>t.mode===mode), first=rows[0];
    for(const r of rows)for(const field of ['moves','wholeHits','suffixHits','suffixCrossKey','savedMoves','peakEntries','peakKeyChars'])assert.equal(r[field],first[field]);
    const work={...first};delete work.ms;delete work.round;
    return [mode,{...work,passes:rows.length,medianMs:median(rows.map(t=>t.ms)),minMs:Math.min(...rows.map(t=>t.ms)),maxMs:Math.max(...rows.map(t=>t.ms))}];
  }));
  const byStart=completed.toSorted((a,b)=>a.result.trace.started-b.result.trace.started);
  const startTies=byStart.filter((j,i)=>i>0&&j.result.trace.started===byStart[i-1].result.trace.started).length;
  return {frames:report.frames,agents:report.combat.aiCount,counts,hitUse,evictions,peak,clears,misses,
    endpointCacheHits:c.finalEndpointCacheHits-c.initialEndpointCacheHits,
    completed:completed.length,unreturned:c.jobs.length-completed.length,stale:completed.filter(j=>j.result.stale).length,
    successful:completed.filter(j=>j.result.value).length,
    workerMs:completed.reduce((n,j)=>n+j.result.ms,0),moves:completed.reduce((n,j)=>n+j.result.moves,0),
    successfulMs:completed.filter(j=>j.result.value).reduce((n,j)=>n+j.result.ms,0),
    successfulMoves:completed.filter(j=>j.result.value).reduce((n,j)=>n+j.result.moves,0),
    stateVisits:traces.reduce((n,t)=>n+t.states.length,0),startTies,
    anyOrderStrict:upperBound(true),anyOrderIgnoringOriginHeight:upperBound(false),timings,
    cpuStepP99:report.summary.cpuStepMs.p99,shots:report.combat.aiShots,
    note:'Cache counts include setup/settling and original-result consumption; ignoring-height/future-donor counts are not valid reusable proofs.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const path of process.argv.slice(2))console.log(JSON.stringify({path,...analyzeProofReuse(JSON.parse(readFileSync(path,'utf8')))},null,2));
}
