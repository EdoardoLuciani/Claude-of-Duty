import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Viewmodel} from '../src/weapons/viewmodel.js';
import {WEAPON_DEFS,WEAPON_IDS} from '../src/weapons/defs.js';
import {GRIP_CONTACTS} from '../src/weapons/grip-contacts.js';
import {makeMCXModel,MCX_URL} from '../src/weapons/mcx.js';
import {Rng} from '../src/core/rng.js';
import {makeSampleResult} from '../src/weapons/clips.js';
import {easeOutCubic, smootherstep} from '../src/weapons/mathx.js';

const loader=new GLTFLoader().register(()=>({name:'NODE_TEXTURE_STUB',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
async function load(url){const b=readFileSync(url);return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const skin=await load(new URL('../public/models/player/arms.glb',import.meta.url));
skin.scene.updateMatrixWorld(true);
const meshes=[];skin.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
const camera=new THREE.PerspectiveCamera(80,16/9,.004,60);
const vm=new Viewmodel({camera,viewCamera:camera,viewScene:new THREE.Scene(),rng:new Rng(704)}, {
  get:()=>new THREE.MeshStandardMaterial(),reticle:()=>new THREE.MeshBasicMaterial(),reticleOutline:()=>new THREE.MeshBasicMaterial(),
});
vm.armL.attachAsset({meshes});vm.armR.attachAsset({meshes});
for(const id of WEAPON_IDS){
  const model=id==='mcx'?makeMCXModel(await load(new URL(MCX_URL))):Object.values(await import(`../src/weapons/models/${id}.js`))[0]();
  vm.addWeapon(model,{...WEAPON_DEFS[id],cycleTime:60/WEAPON_DEFS[id].rpm});
}
const idle={ads:0,sprint:0,speed:0,lowReady:false,crouch:false,airborne:false,trigger:0,empty:false};
const v=new THREE.Vector3(),dir=new THREE.Vector3(),q=new THREE.Quaternion(),inv=new THREE.Matrix4();
function step(state=idle){vm.update(1/60,state);vm.anchor.updateMatrixWorld(true);}
function contact(arm,joint,offset,target){
  inv.copy(arm.root.matrixWorld).invert();
  v.fromArray(offset).multiplyScalar(arm.scale).applyMatrix4(joint.matrixWorld).applyMatrix4(inv);
  dir.fromArray(target);if(vm.active.animation)dir.applyMatrix4(vm.active.animation.poseMatrix);
  return v.distanceTo(dir);
}
let maxHip=0,maxAds=0,maxContact=0;
for(const id of WEAPON_IDS){
  vm.setActive(id);vm.stopClip();
  for(const ads of [0,1]){
    for(let i=0;i<90;i++)step({...idle,ads});
    const data=GRIP_CONTACTS[id];
    const errors=[
      contact(vm.armL,vm.armL.thumb.joints[1],[0,0,-.026],data.leftThumb),
      contact(vm.armR,vm.armR.thumb.joints[1],[0,0,-.026],data.rightThumb),
      contact(vm.armR,vm.armR.fingers[0].joints[2],[0,-.006,-.013],data.trigger),
    ];
    for(const e of errors){maxContact=Math.max(maxContact,e);assert(e<.003,`${id}/${ads}: pad errors (left thumb, right thumb, trigger) ${errors.map(v=>(v*1000).toFixed(2)).join(', ')} mm`);}
    for(const arm of [vm.armL,vm.armR]){
      dir.copy(arm.hand.position).sub(arm.forePivot.position).normalize();
      v.set(0,0,-1).applyQuaternion(arm.hand.quaternion);
      const angle=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v.dot(dir),-1,1)));
      if(ads)maxAds=Math.max(maxAds,angle);else maxHip=Math.max(maxHip,angle);
      assert(angle<(ads?85:60),`${id}/${ads}: ${arm.side} wrist ${angle.toFixed(1)} degrees`);
      assert(arm.forePivot.scale.z<1.05,`${id}/${ads}: ${arm.side} stretched forearm ${arm.forePivot.scale.z.toFixed(4)}; shoulder ${arm.shoulder.toArray()}, wrist ${arm.hand.position.toArray()}`);
      // Both elbow frames must agree after parallel transport, rather than
      // crushing the sleeve with opposing rolls at the same bend.
      const upper=arm.forePivot.position.clone().sub(arm.shoulder).normalize();
      q.setFromUnitVectors(dir,upper);
      v.set(0,1,0).applyQuaternion(arm.forePivot.quaternion).applyQuaternion(q);
      dir.set(0,1,0).applyQuaternion(arm.upperPivot.quaternion);
      assert(v.dot(dir)>.999,`${id}: elbow roll seam`);
    }
  }
  for(const name of ['reloadTac','reloadEmpty','inspect','draw','holster']){
    vm.stopClip();vm.adsT=0;vm.play(name);
    const frames=Math.ceil((vm.clip?.duration??3)*60)+12;
    for(let frame=0;frame<frames;frame++){
      step();
      if(frame%12)continue;
      for(const arm of [vm.armL,vm.armR]){
        arm.skeleton.update();
        assert(arm.skeleton.boneMatrices.every(Number.isFinite),`${id}/${name}: nonfinite skin`);
        for(const mesh of arm.skins)for(let i=0;i<mesh.geometry.attributes.position.count;i+=97){
          mesh.getVertexPosition(i,v);
          assert(Number.isFinite(v.length())&&v.length()<1.5,`${id}/${name}: exploded mesh`);
        }
      }
    }
    for(let i=0;i<10;i++)step();
    assert.equal(vm.armR.pose,`grip:${id}`,`${id}/${name}: firing grip restored`);
  }
}
// Bolt-cycle entry AND exit: inactive keys resolve to the grip, not the origin,
// and sampled targets/directions must reach the wrist without a second blend.
vm.setActive('sniper'); vm.stopClip();
const cycle = vm.active.clips.cycle;
const sample = makeSampleResult();
const grip = vm.active.gripR;
const bolt = cycle.rhand[1];
const expected = new THREE.Vector3();
const endpoint = new THREE.Vector3();
for (const [start, end, entering] of [[0,.16,true],[.72,.88,false]]) {
  const span = (end-start)*cycle.duration;
  for (let frame=0; frame<=Math.ceil(span*60); frame++) {
    const elapsed = Math.min(span,frame/60);
    const u = elapsed/span;
    const blend = entering ? easeOutCubic(u) : 1-smootherstep(0,1,u);
    cycle.sample(start*cycle.duration+elapsed,sample);
    vm._solveHands(vm.active,sample);
    expected.fromArray(grip.pos).lerp(endpoint.fromArray(bolt.p),blend);
    assert(vm.armR.hand.position.distanceTo(expected)<1e-9, `sniper cycle ${entering?'entry':'exit'} frame ${frame}: wrist detour`);
    expected.fromArray(grip.finger).lerp(endpoint.fromArray(bolt.finger),blend).normalize();
    dir.set(0,0,-1).applyQuaternion(vm.armR.hand.quaternion);
    assert(dir.distanceTo(expected)<1e-9, 'cycle direction interpolated only once');
    expected.fromArray(grip.back).lerp(endpoint.fromArray(bolt.back),blend);
    expected.addScaledVector(dir,-expected.dot(dir)).normalize();
    v.set(0,1,0).applyQuaternion(vm.armR.hand.quaternion);
    assert(v.distanceTo(expected)<1e-9, 'cycle roll interpolated only once');
  }
}
assert.equal(vm.armR.pose,'grip:sniper','cycle exit restores the fitted firing grip');

// A fitted trigger-finger spread must never leak into grenade/radio poses.
vm.setActive('rifle');vm.holdRadio();step();
for(let i=0;i<4;i++)assert(Math.abs(vm.armR.fingers[i].root.rotation.y-vm.armR.fingerSpread[i])<1e-7);
vm.endRadio();for(let i=0;i<12;i++)step();assert.equal(vm.armR.pose,'grip:rifle');
vm.dispose();
console.log(`grips: all ${WEAPON_IDS.length} weapons; max hip wrist ${maxHip.toFixed(1)}°, ADS ${maxAds.toFixed(1)}°, pad error ${(maxContact*1000).toFixed(2)} mm; reload/inspect/draw/holster skins, return poses and cycle entry/exit verified`);
