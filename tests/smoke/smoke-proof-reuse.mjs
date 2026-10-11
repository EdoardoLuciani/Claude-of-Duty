import assert from 'node:assert/strict';
import * as THREE from 'three';
import { captureProofReuse, replayProofReuse } from '../../tools/lib/proof-reuse.js';
import { AttachmentQueries, NAV_PENDING } from '../../src/ai/attachment-queries.js';
import { checkAttachment, WALK_STEP } from '../../src/ai/attachment.js';
import { INFANTRY } from '../../src/ai/capabilities.ts';
import { analyzeProofReuse } from '../../tools/analyze-proof-reuse.mjs';

// A deterministic step fixture also exposes why original from.y belongs in a
// cross-query continuation key: a later rise can violate the original y bound.
class Probe {
  constructor(world){this.world=world;this.position={x:0,y:0,z:0};this.velocity={x:0,y:0,z:0};this.grounded=true;this.enabled=true;this.mask=259;}
  setPosition(x,y,z){Object.assign(this.position,{x,y,z});}
  probeGround(){this.grounded=true;}
  move(dx,_dy,dz){this.position.x+=dx;this.position.z+=dz;this.position.y=this.position.x>.5?.3:.008;}
}
const world={version:0,dirty:false,nodeCount:0,triCount:0,_stackNode:new Int32Array(1)};
for(const name of ['pos','nrm','surface','mask','object','triIndex','nodeBounds','nodeMeta','_taabb'])world[name]=new Float32Array(0);
const physics={staticWorld:world,gravity:-20,MASK:{CHARACTER:259}};
const nav={physics,_probe:new Probe(world),_p0:new THREE.Vector3(),_p1:new THREE.Vector3(),canStand:()=>true,stats:{endpointChecks:0,cacheHits:0}};
const keys=[[0,.008,0,1,.3,0,.32,1.78,80],[0,.008,0,1,.3,0,.32,1.78,80],
  [.025,.008,0,1,.3,0,.32,1.78,80],[.025,.008,0,1,.3,0,.32,1.78,1],[0,-.3,0,1,.3,0,.32,1.78,80]];
const jobs=keys.map((key,i)=>{
  let moves=0;const c=new Probe(world),move=c.move;c.move=function(...a){moves++;move.apply(this,a);};
  const ctx={...nav,_probe:c,stats:{endpointChecks:0}};
  const value=checkAttachment.call(ctx,{x:key[0],y:key[1],z:key[2]},{x:key[3],y:key[4],z:key[5]},...key.slice(6));
  return {id:i,key,result:{value,moves,trace:{started:i}}};
});
assert.equal(jobs[4].result.value,false);
nav.worker={valid:true,generation:1,signature:()=> 'fixture'};
const engine={ctx:{get:()=>({grid:nav})},time:{frame:0}};
const capture={signature:'fixture',generation:1,controller:{enabled:true},gravity:-20,mask:259,jobs};
const result=replayProofReuse(engine,capture,checkAttachment.toString(),INFANTRY,WALK_STEP,1);
assert.equal(result.timed.find(t=>t.mode==='whole512').wholeHits,1);
assert(result.timed.find(t=>t.mode==='whole512-suffix4096').suffixCrossKey>0);
const unsafe=replayProofReuse.toString().replace('keyOf([k[1],...k.slice(3,8)])','keyOf(k.slice(3,8))');
assert.notEqual(unsafe,replayProofReuse.toString());
assert.throws(()=>new Function(`return (${unsafe});`)()(engine,capture,checkAttachment.toString(),INFANTRY,WALK_STEP,1),/reuse boolean mismatch/);
const noBudget=replayProofReuse.toString().replace('known && known.remaining < current.key[8]-i','known');
assert.notEqual(noBudget,replayProofReuse.toString());
assert.throws(()=>new Function(`return (${noBudget});`)()(engine,capture,checkAttachment.toString(),INFANTRY,WALK_STEP,1),/reuse boolean mismatch/);
assert.throws(()=>replayProofReuse(engine,capture,'function changed(){}',INFANTRY,WALK_STEP,1),/anchor changed/);

class Worker { postMessage(data){if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));} terminate(){} }
const service=nav.worker=new AttachmentQueries(nav,{workerFactory:()=>new Worker()});await service.start();
nav.repeatState=false;assert.throws(()=>captureProofReuse(engine),/requires repeat-state mode/);nav.repeatState=true;
const observed=captureProofReuse(engine),from=new THREE.Vector3(0,.008,0),to=new THREE.Vector3(1,.008,0);
const run=()=>service.run(1,'walk',()=>service.request(from,to,.32,1.78,80));
assert.equal(run(),NAV_PENDING);assert.equal(run(),NAV_PENDING);
service.receive({type:'result',id:[...service.jobs.keys()][0],value:true,moves:1,ms:1,trace:{started:0}});
assert.equal(run(),true);assert.equal(run(),true);
for(let i=0;i<513;i++)service.remember([i+10,0,0,1,0,0,.32,1.78,80].join(','),i%2===0);
const report=await observed.finish();
assert.deepEqual(report.events.filter(e=>e.type==='request').map(e=>e.status),['submitted','waiting','hit','hit']);
assert(report.events.some(e=>e.type==='remember'&&e.evicted));assert.equal(report.jobs[0].result.value,true);
assert(report.events.some(e=>e.type==='remember'&&e.value===false),'negative proofs are retained');
observed.dispose();observed.dispose();
for(const name of ['request','run','remember','receive','clear'])assert(!Object.hasOwn(service,name),'inherited method ownership restored');
assert(!Object.hasOwn(service.worker,'postMessage'));
service.dispose();
const a=[0,.008,0,.15,.008,0,.32,1.78,80],b=[.025,.008,0,.15,.008,0,.32,1.78,80];
const states=[{i:0,state:[0,.008,0,0,1,0,0,0]},{i:1,state:[.025,.008,0,0,1,0,0,0]}];
const fixture={failure:null,frames:1,combat:{aiCount:1,aiShots:1},summary:{cpuStepMs:{p99:1}},proofReuse:{
  initialProofs:[],initialStats:{proofHits:0},finalStats:{proofHits:2},finalProofs:2,initialEndpointCacheHits:0,finalEndpointCacheHits:0,
  events:[{type:'request',status:'submitted',key:a,identity:a.join(','),value:null,intent:1},
    {type:'remember',key:a.join(','),value:true,intent:1,job:1,evicted:null},
    {type:'request',status:'hit',key:a,identity:a.join(','),value:true,intent:1},
    {type:'request',status:'hit',key:a,identity:a.join(','),value:true,intent:2},
    {type:'request',status:'submitted',key:b,identity:b.join(','),value:null,intent:2},
    {type:'remember',key:b.join(','),value:true,intent:2,job:2,evicted:null}],
  jobs:[{id:1,result:{value:true,moves:2,ms:1,trace:{started:0}}},{id:2,result:{value:true,moves:1,ms:1,trace:{started:1}}}],
  replay:{traces:[{id:1,key:a,value:true,moves:2,states},{id:2,key:b,value:true,moves:1,states:[{...states[1],i:0}]}],
    timed:[{mode:'native',ms:2,moves:3,wholeHits:0,suffixHits:0,suffixCrossKey:0,savedMoves:0,peakEntries:0,peakKeyChars:0}]}}};
const analysis=analyzeProofReuse(fixture);
assert.equal(analysis.hitUse.ownFirstRead,1);assert.equal(analysis.hitUse.differentIntent,1);
assert.equal(analysis.misses.sameSuccessfulGoal,1);assert.equal(analysis.anyOrderStrict.queries,2,'upper bound admits future donors, unlike a real cache');
assert.throws(()=>analyzeProofReuse({...fixture,failure:'failed'}),/failed capture/);
console.log('proof reuse: causal whole/tail replay, budget and origin-height safety, capture, analysis and cleanup: OK');
