// Actual shared sleeve/pouch and reload stock/head clearance, no GPU.
// Glove contact is intentional; neither olive sleeve nor cuff may enter a pouch.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Viewmodel} from '../../src/weapons/viewmodel.js';
import {WEAPON_DEFS} from '../../src/weapons/defs.js';
import {makeEvolysModel,EVOLYS_URL} from '../../src/weapons/evolys.js';
import {Rng} from '../../src/core/rng.ts';
const loader=new GLTFLoader().register(()=>({name:'TEXTURE_STUB',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
async function load(url){const b=readFileSync(url);return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const skin=await load(new URL('../../public/models/player/arms.glb',import.meta.url));skin.scene.updateMatrixWorld(true);
const meshes=[];skin.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
const camera=new THREE.PerspectiveCamera(80,16/9,.004,60);
const vm=new Viewmodel({camera,viewCamera:camera,viewScene:new THREE.Scene(),rng:new Rng(704)},{get:()=>new THREE.MeshStandardMaterial(),reticle:()=>new THREE.MeshBasicMaterial(),reticleOutline:()=>new THREE.MeshBasicMaterial()});
vm.armL.attachAsset({meshes});vm.armR.attachAsset({meshes});
vm.addWeapon(makeEvolysModel(await load(new URL(EVOLYS_URL))),{...WEAPON_DEFS.lmg,cycleTime:60/700});vm.setActive('lmg');vm.stopClip();
const state={ads:0,sprint:0,speed:0,lowReady:false,crouch:false,airborne:false,trigger:0,empty:false,magazineLoaded:true,remainingRounds:100};
const sleeves=vm.armL.skins.filter(m=>m.material.name.startsWith('Olive'));
assert(sleeves.length>0,'actual sleeve/cuff geometry must be loaded');
const vertices=new Map(sleeves.map(m=>[m,Array.from({length:m.geometry.attributes.position.count},()=>new THREE.Vector3())]));
const inv=new THREE.Matrix4(),transform=new THREE.Matrix4(),box=new THREE.Box3(),point=new THREE.Vector3(),triangle=new THREE.Triangle();
const stock=[];
vm.active.model.root.getObjectByName('stock_mesh').traverse(o=>{if(o.isMesh)stock.push(o);});
assert(stock.length>0,'actual stock geometry must be loaded');
const head=new THREE.Vector3();
let headGap=Infinity,minimum=Infinity,samples=0;
function check(label){
  vm.anchor.updateMatrixWorld(true);vm.armL.skeleton.update();samples++;
  if(label.startsWith('reload')){
    for(const mesh of stock){
      const pos=mesh.geometry.attributes.position,indices=mesh.geometry.index.array;
      for(let i=0;i<indices.length;i+=3){
        triangle.a.fromBufferAttribute(pos,indices[i]).applyMatrix4(mesh.matrixWorld);
        triangle.b.fromBufferAttribute(pos,indices[i+1]).applyMatrix4(mesh.matrixWorld);
        triangle.c.fromBufferAttribute(pos,indices[i+2]).applyMatrix4(mesh.matrixWorld);
        triangle.closestPointToPoint(head,point);
        const gap=point.length();
        assert(gap>=.12,`${label}: stock triangle ${i/3} enters the 120 mm camera/head envelope (${gap} m)`);
        headGap=Math.min(headGap,gap);
      }
    }
  }
  for(const parent of [vm.active.animation.pouch,vm.active.animation.spare]){
    if(!parent.visible)continue;
    inv.copy(parent.matrixWorld).invert();box.makeEmpty();
    parent.traverse(m=>{
      if(!m.isMesh||(!m.material.name.startsWith('06')&&!m.material.name.startsWith('02')))return;
      transform.multiplyMatrices(inv,m.matrixWorld);
      for(const index of m.geometry.index.array){point.fromBufferAttribute(m.geometry.attributes.position,index).applyMatrix4(transform);box.expandByPoint(point);}
    });
    assert(!box.isEmpty(),'pouch fabric/lid bounds must exist');
    for(const mesh of sleeves){
      transform.multiplyMatrices(inv,mesh.matrixWorld);const positions=vertices.get(mesh);
      for(let i=0;i<positions.length;i++){mesh.getVertexPosition(i,positions[i]).applyMatrix4(transform);minimum=Math.min(minimum,box.distanceToPoint(positions[i]));}
      const indices=mesh.geometry.index.array;
      for(let i=0;i<indices.length;i+=3){
        triangle.set(positions[indices[i]],positions[indices[i+1]],positions[indices[i+2]]);
        assert(!box.intersectsTriangle(triangle),`${label}/${parent.name}: sleeve triangle ${i/3} penetrates pouch envelope`);
      }
    }
  }
}
for(const ads of [0,1]){
  vm.stopClip();for(let f=0;f<90;f++)vm.update(1/60,{...state,ads});check(ads?'ADS':'hip');
  assert(vm.armL.forePivot.scale.z<1.05,'forward support grip must stay in reach, not stretch the sleeve');
}
for(const name of ['reloadTac','reloadEmpty','inspect','draw','holster']){
  vm.stopClip();vm.adsT=0;vm.play(name);const frames=Math.ceil(vm.clip.duration*60)+8;
  for(let f=0;f<=frames;f++){vm.update(1/60,state);check(`${name}/${(f/60).toFixed(3)}`);}
}
console.log(`Reload stock/head gap: ${(headGap*1000).toFixed(2)} mm`);
vm.dispose();console.log(`EVOLYS clearance: ${samples} sampled poses; no left sleeve/cuff triangle intersects either pouch envelope; minimum vertex gap ${(minimum*1000).toFixed(2)} mm`);
