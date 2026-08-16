/**
 * Print camera-space + NDC of the grenade and both wrists for each pose.
 *   node tools/probe-grenade-pose.mjs
 */
import * as THREE from 'three';
import { Viewmodel } from '../src/weapons/viewmodel.js';
import { WEAPON_DEFS } from '../src/weapons/defs.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { Rng } from '../src/core/rng.js';

const cam = new THREE.PerspectiveCamera(51.6, 16 / 9, 0.004, 60);
const vm = new Viewmodel({
  viewScene: new THREE.Scene(),
  camera: cam,
  viewCamera: cam,
  rng: new Rng(0xbeef1234),
}, {
  get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(),
  reticleOutline: () => new THREE.MeshBasicMaterial(),
});
const def = { ...WEAPON_DEFS.rifle, cycleTime: 60 / WEAPON_DEFS.rifle.rpm };
vm.addWeapon(buildRifle(), def);
vm.setActive('rifle');
vm.trackCamera = true;
cam.position.set(0, 0, 0);
cam.quaternion.identity();
cam.updateMatrixWorld(true);
vm.anchor.position.set(0, 0, 0);
vm.anchor.quaternion.identity();

const IDLE = { ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false };
const ndc = new THREE.Vector3();
const camP = new THREE.Vector3();
function report(label, obj) {
  obj.updateWorldMatrix(true, false);
  camP.setFromMatrixPosition(obj.matrixWorld);
  ndc.copy(camP).project(cam);
  console.log(
    `${label.padEnd(14)} cam=(${camP.x.toFixed(3)}, ${camP.y.toFixed(3)}, ${camP.z.toFixed(3)})  ndc=(${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)})`
  );
}
function dump(name) {
  vm.update(1 / 60, IDLE);
  vm.rig.updateMatrixWorld(true);
  console.log(`--- ${name}  rpose=${vm.armR.pose} lpose=${vm.armL.pose} ---`);
  report('grenade', vm.grenade);
  report('wristR', vm.armR.hand);
  report('wristL', vm.armL.hand);
}

vm.holdGrenade();
dump('idle');

vm.cookGrenade('long');
vm._cookBlend = 1;
dump('cook long');

vm.cookGrenade('short');
vm._cookBlend = 1;
dump('cook short');

vm.throwGrenade('long');
vm._throwT = vm._throwReleaseAt;
dump('throw long');

vm.endGrenade();
vm.holdGrenade();
vm.cookGrenade('short');
vm._cookBlend = 1;
vm.throwGrenade('short');
vm._throwT = vm._throwReleaseAt;
dump('throw short');
