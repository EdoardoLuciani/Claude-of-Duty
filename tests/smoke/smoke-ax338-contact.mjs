// Actual shared deformed left skins in the real Viewmodel, no GPU or Blender.
// Conservative solid forend envelope + referenced runtime magazine geometry.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Viewmodel} from '../../src/weapons/viewmodel.js';
import {WEAPON_DEFS} from '../../src/weapons/defs.ts';
import {makeAX338Model,AX338_URL} from '../../src/weapons/ax338.ts';
import {Rng} from '../../src/core/rng.ts';
import manifest from '../../assets/weapons/ax338/manifest.json' with {type:'json'};
const loader=new GLTFLoader().register(()=>({name:'TEXTURE_STUB',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
async function load(url){const b=readFileSync(url);return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const skin=await load(new URL('../../public/models/player/arms.glb',import.meta.url));skin.scene.updateMatrixWorld(true);
const meshes=[];skin.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
const camera=new THREE.PerspectiveCamera(80,16/9,.004,60);
const vm=new Viewmodel({camera,viewCamera:camera,viewScene:new THREE.Scene(),rng:new Rng(704)},{get:()=>new THREE.MeshStandardMaterial(),reticle:()=>new THREE.MeshBasicMaterial(),reticleOutline:()=>new THREE.MeshBasicMaterial()});
vm.armL.attachAsset({meshes});vm.armR.attachAsset({meshes});
vm.addWeapon(makeAX338Model(await load(new URL(AX338_URL))),{...WEAPON_DEFS.sniper,cycleTime:60/WEAPON_DEFS.sniper.rpm});vm.setActive('sniper');vm.stopClip();
const state={ads:0,sprint:0,speed:0,lowReady:false,crouch:false,airborne:false,trigger:0,empty:false,magazineLoaded:true,remainingRounds:10};
const skins=vm.armL.skins;
const referenced=new Map(skins.map(m=>[m,[...new Set(m.geometry.index.array)]]));
const vertices=new Map(skins.map(m=>{
  const points=[];for(const id of referenced.get(m))points[id]=new THREE.Vector3();return [m,points];
}));
const magVertices=new Map(skins.map(m=>{
  const points=[];for(const id of referenced.get(m))points[id]=new THREE.Vector3();return [m,points];
}));
const tipFlags=new Map(skins.map(mesh=>{
  const index=mesh.geometry.attributes.skinIndex,weight=mesh.geometry.attributes.skinWeight;
  const finger=new Uint8Array(index.count),thumb=new Uint8Array(index.count);
  for(const i of referenced.get(mesh))for(let k=0;k<4;k++)if(weight.getComponent(i,k)>.2){
    const bone=vm.armL.skeleton.bones[index.getComponent(i,k)].name;
    if(/^finger_[0-3]_2/.test(bone))finger[i]=1;if(bone.startsWith('thumb_1'))thumb[i]=1;
  }
  return [mesh,{finger,thumb}];
}));
const inv=new THREE.Matrix4(),transform=new THREE.Matrix4(),point=new THREE.Vector3(),centroid=new THREE.Vector3(),triangle=new THREE.Triangle();
const magBoxes=[],magParts=new Map();
for(const name of ['magazine','magazine_spare']){
  const parent=vm.active.animation.root.getObjectByName(name);
  for(const component of manifest.contactGeometry.magazine){
    const box=new THREE.Box3(new THREE.Vector3(...component.min),new THREE.Vector3(...component.max));
    // These bounds are measured from each saved component, not the coalesced
    // steel primitive (whose ribs/lips enlarge empty space around the body).
    box.min.addScalar(.001);box.max.addScalar(-.001);
    if(!box.isEmpty())magBoxes.push({parent,box,part:component.part});
  }
  magParts.set(parent,magBoxes.filter(b=>b.parent===parent));
}
let cachedMagParent=null;
let samples=0,maximumTubeDepth=0,heldSamples=0,minimumFingerGap=Infinity,maximumFingerGap=0,maximumThumbGap=0;
function tube(point,label){
  if(point.z>-.175||point.z<-.581)return;
  const x=Math.abs(point.x),y=Math.abs(point.y-.075);
  const gap=Math.max(x-.027,y-.026,(x+y-.040)/Math.SQRT2);
  maximumTubeDepth=Math.max(maximumTubeDepth,-gap);
  if(gap<-.001)assert.fail(`${label}: actual left skin enters conservative forend envelope by ${(-gap*1000).toFixed(3)} mm`);
}
function check(label){
  vm.anchor.updateMatrixWorld(true);vm.armL.skeleton.update();samples++;
  inv.copy(vm.active.animation.root.matrixWorld).invert();
  for(const mesh of skins){
    transform.multiplyMatrices(inv,mesh.matrixWorld);const positions=vertices.get(mesh);
    for(const i of referenced.get(mesh)){mesh.getVertexPosition(i,positions[i]).applyMatrix4(transform);tube(positions[i],label);}
    const indices=mesh.geometry.index.array;
    for(let i=0;i<indices.length;i+=3){
      const a=positions[indices[i]],b=positions[indices[i+1]],c=positions[indices[i+2]];
      tube(centroid.copy(a).add(b).add(c).multiplyScalar(1/3),label);
      tube(centroid.copy(a).add(b).multiplyScalar(.5),label);tube(centroid.copy(b).add(c).multiplyScalar(.5),label);tube(centroid.copy(c).add(a).multiplyScalar(.5),label);
    }
  }
  cachedMagParent=null;
  for(const [parent,parts] of magParts){
    if(!parent.visible)continue;
    inv.copy(parent.matrixWorld).invert();transform.multiplyMatrices(inv,vm.active.animation.root.matrixWorld);
    cachedMagParent=parent;
    for(const mesh of skins){
      const source=vertices.get(mesh),positions=magVertices.get(mesh);
      // Skin once per pose, then transform those same actual vertices into each
      // magazine frame; do not repeat four-bone deformation for every component.
      for(const i of referenced.get(mesh))positions[i].copy(source[i]).applyMatrix4(transform);
      const indices=mesh.geometry.index.array;
      for(let i=0;i<indices.length;i+=3){
        triangle.set(positions[indices[i]],positions[indices[i+1]],positions[indices[i+2]]);
        for(const {box,part} of parts)if(box.intersectsTriangle(triangle))assert.fail(`${label}/${parent.name}/${part}/${mesh.name}: actual left skin triangle ${i/3} enters magazine envelope beyond 1 mm; box ${box.min.toArray()}..${box.max.toArray()}; triangle ${triangle.a.toArray()} / ${triangle.b.toArray()} / ${triangle.c.toArray()}`);
      }
    }
  }
}
// Actual runtime grip triangles, not a wrist/MCP proxy. The three holding
// fingers must wrap against the grip with their distal glove skin.
const gripTriangles=[],gripBounds=new THREE.Box3(new THREE.Vector3(-.032,-.087,.036),new THREE.Vector3(.032,-.019,.14));
vm.anchor.updateMatrixWorld(true);inv.copy(vm.active.animation.root.matrixWorld).invert();
vm.active.animation.root.getObjectByName('receiver').traverse(mesh=>{
  if(!mesh.isMesh)return;
  transform.multiplyMatrices(inv,mesh.matrixWorld);
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let i=0;i<index.count;i+=3){
    const tri=new THREE.Triangle(...[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+k)).applyMatrix4(transform)));
    if([tri.a,tri.b,tri.c].every(v=>gripBounds.containsPoint(v)))gripTriangles.push({tri,box:new THREE.Box3().setFromPoints([tri.a,tri.b,tri.c])});
  }
});
assert(gripTriangles.length>100,'actual lower curved-grip triangles present');
let maximumRightGripGap=0;
function checkRightGrip(label){
  inv.copy(vm.active.animation.root.matrixWorld).invert();const gaps=[Infinity,Infinity,Infinity],closest=new THREE.Vector3();
  for(const mesh of vm.armR.skins){
    transform.multiplyMatrices(inv,mesh.matrixWorld);const index=mesh.geometry.attributes.skinIndex,weight=mesh.geometry.attributes.skinWeight;
    for(let i=0;i<index.count;i++){
      let finger=-1;
      for(let k=0;k<4;k++)if(weight.getComponent(i,k)>.2){
        const match=/^finger_([123])_2/.exec(vm.armR.skeleton.bones[index.getComponent(i,k)].name);if(match)finger=Number(match[1])-1;
      }
      if(finger<0)continue;mesh.getVertexPosition(i,point).applyMatrix4(transform);
      for(const {tri,box} of gripTriangles){
        if(box.distanceToPoint(point)>=gaps[finger])continue;
        tri.closestPointToPoint(point,closest);gaps[finger]=Math.min(gaps[finger],point.distanceTo(closest));
      }
    }
  }
  assert(Math.max(...gaps)<.004,`${label}: middle/ring/little distal skin loses actual grip contact: ${gaps}`);
  maximumRightGripGap=Math.max(maximumRightGripGap,...gaps);
}
for(const ads of [0,1]){
  vm.stopClip();for(let f=0;f<90;f++)vm.update(1/60,{...state,ads});check(ads?'ADS':'hip');checkRightGrip(ads?'ADS':'hip');
  assert(vm.armL.forePivot.scale.z<1.05,`forward grip must remain in reach without stretching sleeve: ${vm.armL.forePivot.scale.z}, shoulder ${vm.armL.shoulder.toArray()}, wrist ${vm.armL.hand.position.toArray()}`);
}
for(const name of ['cycle','reloadTac','reloadEmpty','inspect','draw','holster']){
  vm.stopClip();vm.adsT=0;vm.play(name);const duration=vm.clip.duration,frames=Math.ceil(duration*60);
  for(let f=0;f<=frames;f++){
    vm.update(1/60,state);check(`${name}/${(f/60).toFixed(3)}`);
    const ratio=vm.clipT/duration;
    // Fully carried spare magazine, away from the rifle; require skin contact
    // on BOTH opposing sides, not just a mathematically matching wrist.
    if(!name.startsWith('reload')||ratio<.40||ratio>.65)continue;
    const parent=vm.active.animation.spare;if(!parent.visible)continue;heldSamples++;
    const boxes=magBoxes.filter(b=>b.parent===parent).map(b=>b.box.clone().expandByScalar(.001));
    assert.equal(cachedMagParent,parent,'contact probes must use this pose/visible spare frame');
    let finger=Infinity,thumb=Infinity;
    function contact(p,isFinger,isThumb){
      for(const box of boxes){
        if(isFinger&&p.x<-.01)finger=Math.min(finger,box.distanceToPoint(p));
        if(isThumb&&p.x>.01)thumb=Math.min(thumb,box.distanceToPoint(p));
      }
    }
    for(const mesh of skins){
      const positions=magVertices.get(mesh),flags=tipFlags.get(mesh);
      for(const i of referenced.get(mesh))contact(positions[i],flags.finger[i],flags.thumb[i]);
      // A padded skin face can contact while its vertices stand off a corner.
      // Require all its vertices to be distal-weighted, not a palm/web triangle.
      const index=mesh.geometry.index.array;
      for(let i=0;i<index.length;i+=3){
        const a=index[i],b=index[i+1],c=index[i+2];
        const f=flags.finger[a]&&flags.finger[b]&&flags.finger[c],t=flags.thumb[a]&&flags.thumb[b]&&flags.thumb[c];
        if(!f&&!t)continue;
        contact(point.copy(positions[a]).add(positions[b]).add(positions[c]).multiplyScalar(1/3),f,t);
        contact(point.copy(positions[a]).add(positions[b]).multiplyScalar(.5),f,t);
        contact(point.copy(positions[b]).add(positions[c]).multiplyScalar(.5),f,t);
        contact(point.copy(positions[c]).add(positions[a]).multiplyScalar(.5),f,t);
      }
    }
    minimumFingerGap=Math.min(minimumFingerGap,finger);maximumFingerGap=Math.max(maximumFingerGap,finger);maximumThumbGap=Math.max(maximumThumbGap,thumb);
    assert(finger<.004&&thumb<.004,`${name}: actual distal finger/thumb skin fails opposing magazine contact (${finger}, ${thumb})`);
  }
}
assert(heldSamples>20,'both reloads must exercise real carried-magazine skin contact');
console.log(`AX338 actual right holding fingers: hip/ADS maximum distal grip gap ${(maximumRightGripGap*1000).toFixed(3)} mm`);
vm.dispose();console.log(`AX338 actual skins: ${samples} poses, conservative tube depth ${(maximumTubeDepth*1000).toFixed(3)} mm; ${heldSamples} carried-magazine poses, finger gap ${(minimumFingerGap*1000).toFixed(3)}–${(maximumFingerGap*1000).toFixed(3)} mm, thumb max ${(maximumThumbGap*1000).toFixed(3)} mm; no magazine triangle exceeds 1 mm allowance`);
