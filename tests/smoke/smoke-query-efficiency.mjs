import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterController } from '../../src/physics/character.js';
import { StaticWorld } from '../../src/physics/bvh.js';
import { checkAttachment, canStand } from '../../src/ai/attachment.js';
import { AttachmentQueries, NAV_PENDING } from '../../src/ai/attachment-queries.js';
import { SurfaceNav, CoverMap } from '../../src/ai/nav.ts';

const world = new StaticWorld();
for (const [x,y,z,w,h,d] of [[0,-.2,0,8,.4,8],[.8,1.5,0,.2,3,4]]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d)); mesh.position.set(x,y,z); mesh.updateMatrixWorld();
  world.addMesh(mesh,'concrete'); mesh.geometry.dispose();
}
world.build();
const physics = { staticWorld:world, gravity:-20, MASK:{CHARACTER:259},
  checkCapsule:(a,b,r,m)=>world.overlapCapsule(a.x,a.y,a.z,b.x,b.y,b.z,r,m,0)===0 };
const nav = { physics, _probe:new CharacterController(world), _p0:new THREE.Vector3(),_p1:new THREE.Vector3(),canStand,stats:{endpointChecks:0} };
const a = new THREE.Vector3(0,.008,0), b = new THREE.Vector3(1.5,.008,0);
let moves=0;const move=nav._probe.move;nav._probe.move=function(...args){moves++;return move.apply(this,args);};
nav.repeatState=false; const original=checkAttachment.call(nav,a,b,.32,1.78,80), originalMoves=moves;
nav.repeatState=true;moves=0;assert.equal(checkAttachment.call(nav,a,b,.32,1.78,80),original);
assert.equal(original,false);assert(moves<originalMoves);assert.equal(originalMoves-moves,nav.stats.savedMoves);
for (const variant of ['tiny-progress','falling','velocity-change']) {
  let count=0;
  const c={ position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},grounded:variant!=='falling',
    setPosition(x,y,z){Object.assign(this.position,{x,y,z});},probeGround(){},
    move(){count++;if(variant==='tiny-progress')this.position.x+=1e-12;
      if(variant==='velocity-change')this.velocity.y++;} };
  const fake={physics:{gravity:-20},_probe:c,stats:{endpointChecks:0},canStand:()=>true};
  assert.equal(checkAttachment.call(fake,{x:0,y:0,z:0},{x:1,y:0,z:0},.32,1.78,80),false);
  assert.equal(count,80,`${variant} is not a repeated full state`);
}
// A two-state grounded/airborne oscillation is a real repeated cycle, not
// progress. The local requested vertical velocity repeats with it.
let cycleMoves=0;
const cycle={position:{},velocity:{},grounded:true,setPosition(x,y,z){Object.assign(this.position,{x,y,z});},probeGround(){},
  move(){cycleMoves++;this.grounded=!this.grounded;} };
assert.equal(checkAttachment.call({physics:{gravity:-20},_probe:cycle,stats:{endpointChecks:0},canStand:()=>true},
  {x:0,y:0,z:0},{x:1,y:0,z:0},.32,1.78,80),false);
assert(cycleMoves>=2 && cycleMoves<80,'exact oscillation terminates without changing the failed result');
// Initial overlap has a special arrival gate; it must not become early failure.
const c={position:{},velocity:{},grounded:true,setPosition(x,y,z){Object.assign(this.position,{x,y,z});},probeGround(){},move(){}};
assert.equal(checkAttachment.call({physics:{gravity:-20},_probe:c,stats:{endpointChecks:0},canStand:()=>false},
  {x:0,y:0,z:0},{x:.05,y:0,z:0},.32,1.78,80),true);

class Worker {
  messages=[];
  postMessage(message){this.messages.push(message);if(message.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));}
  terminate(){}
}
const service=new AttachmentQueries(nav,{workerFactory:()=>new Worker()});await service.start();
const target=new THREE.Vector3(2,.008,0);
const chain=()=>service.request(a,b,.32,1.78,80)&&service.request(b,target,.32,1.78,80);
const run=()=>service.run(1,'look-ahead',chain,a,true);
assert.equal(run(),NAV_PENDING);assert.equal(service.jobs.size,2,'both scratch dependencies submitted in one attempt');
let ids=[...service.jobs.keys()];
service.receive({type:'result',id:ids[0],value:true,ms:0,moves:0});
assert.equal(run(),NAV_PENDING,'partial batch cannot publish provisional success');
service.receive({type:'result',id:ids[1],value:true,ms:0,moves:0});assert.equal(run(),true);
service.clear();assert.equal(run(),NAV_PENDING);ids=[...service.jobs.keys()];
service.receive({type:'result',id:ids[0],value:false,ms:0,moves:0});assert.equal(run(),false);
assert.equal(service.jobs.size,0,'known failed prerequisite cancels unused look-ahead');
service.receive({type:'result',id:ids[1],value:true,ms:0,moves:0});assert.equal(service.proofs.size,1,'late cancelled success discarded');
service.clear();service.batchQueries=false;assert.equal(run(),NAV_PENDING);assert.equal(service.jobs.size,1,'control remains serial');
service.clear();service.batchQueries=true;

const points=[0,2].map(x=>({x,y:0,z:0,dx:0,dz:1,high:false,component:1,claimed:-1}));
const grid={worker:service,coverPoints:points,components:new Map([[1,1]]),
  plan:SurfaceNav.prototype.plan,
  project(p,out,_cache,goal){out.copy(p);return !goal||service.request(p,{x:p.x+.2,y:p.y,z:p.z},.36,1.8,80)?1:0;} };
const cover=new CoverMap(grid,{});cover.protects=()=>true;
cover.peekOffset=(p)=>service.request(p,{x:p.x+.4,y:p.y,z:p.z},.36,1.8,80)?0:null;
const pick=()=>cover.pick(new THREE.Vector3(0,0,-1),new THREE.Vector3(0,0,10),{id:1});
assert.equal(pick(),NAV_PENDING);assert.equal(service.jobs.size,2,'top candidate endpoint and peek batched');
assert(points.every(p=>p.claimed===-1),'no speculative cover claim');
ids=[...service.jobs.keys()];service.receive({type:'result',id:ids[0],value:false,ms:0,moves:0});
assert.equal(pick(),NAV_PENDING);assert(points.every(p=>p.claimed===-1));
for(const id of service.jobs.keys())service.receive({type:'result',id,value:true,ms:0,moves:0});
assert.equal(pick(),points[1]);assert.equal(points[1].claimed,1);
service.clear();
const projection = Object.assign(Object.create(SurfaceNav.prototype),nav,{worker:service,
  meta:{},components:new Map([[1,1]]),_a:new THREE.Vector3(),_b:new THREE.Vector3(),_source:new THREE.Vector3(),
  stats:{endpointChecks:0,cacheHits:0,queries:0,queryMs:0},
  query:{findNearestPoly:()=>({success:true,nearestRef:1,nearestPoint:new THREE.Vector3(.5,.008,0)}),
    findPath(){throw new Error('provisional endpoints triggered Detour');}}});
service.nav=projection;
const cache={position:new THREE.Vector3(),point:new THREE.Vector3(),ref:0};
assert.equal(service.run(2,'scratch',()=>projection.project(a,new THREE.Vector3(),cache),a,true),NAV_PENDING);
assert.equal(cache.ref,0);assert.equal(cache.nav,undefined,'provisional endpoint is not cached');
assert.equal(service.run(2,'scratch-path',()=>projection.findPath(a,new THREE.Vector3(.9,.008,0),[]),a,true),NAV_PENDING);
assert.equal(projection.stats.queries,0,'no completed path attempt while endpoints are provisional');
service.dispose();
console.log('runtime query efficiency: exact repeated state, changing state, batched discovery and claim guards: OK');
