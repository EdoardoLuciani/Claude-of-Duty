import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterController } from '../../src/physics/character.js';
import { StaticWorld } from '../../src/physics/bvh.js';
import { checkAttachment, canStand } from '../../src/ai/attachment.js';
import { AttachmentQueries, NAV_PENDING } from '../../src/ai/attachment-queries.js';

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
const run=()=>service.run(1,'dependent-checks',chain,a);
assert.equal(run(),NAV_PENDING);assert.equal(service.jobs.size,1,'unknown prerequisite does not launch a dependent check');
assert.equal(run(),NAV_PENDING);assert.equal(service.jobs.size,1,'pending proof is not provisional success');
const first=[...service.jobs.keys()][0];
service.receive({type:'result',id:first,value:true,ms:0,moves:0});
assert.equal(run(),NAV_PENDING);assert.equal(service.jobs.size,1,'dependent check waits for a real prerequisite success');
const second=[...service.jobs.keys()][0];assert.notEqual(second,first);
service.receive({type:'result',id:second,value:true,ms:0,moves:0});assert.equal(run(),true);
service.clear();assert.equal(run(),NAV_PENDING);
service.receive({type:'result',id:[...service.jobs.keys()][0],value:false,ms:0,moves:0});
assert.equal(run(),false);assert.equal(service.jobs.size,0,'failed prerequisite never submits its dependent check');
service.dispose();
console.log('runtime query efficiency: exact cycles retained; dependent checks require real proofs: OK');
