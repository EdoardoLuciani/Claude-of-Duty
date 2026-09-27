#!/usr/bin/env node
// Offline contact authoring seed. Blender owns the resulting action curves;
// this does not run in the game or modify the shared arm asset.
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.js';
import { writeFileSync } from 'node:fs';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y,z),y,z));
};
const grips = {
  right: { pos:[.031,-.037,.087], finger:[0,.25,-.968], back:[.98,.01,-.20] },
  left: { pos:[-.037,-.050,.072], finger:[-.15,.18,-.972], back:[-.99,.12,-.13] },
};
const result = {grips, sides:{}};
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, {scale: side === 'left' ? .97 : 1});
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger,g.back));
  arm.setPose(side === 'right' ? 'gripPistol' : 'cup');
  arm.fitGrip('p320', side === 'right' ? {
    thumb:[-.023,.012,.024], index:[0,-.008,-.035], spread:[0,.60,.62,.64],
    fingers:[[.05,.7,1.1],[.78,1.18,.72],[.84,1.24,.75],[.9,1.3,.78]],
  } : {
    thumb:[-.024,.010,-.014], thumbPole:[0,0,-1], spread:[.35,.4,.45,.5],
    fingers:[[.82,1.12,.86],[.85,1.14,.9],[.9,1.18,.9],[.95,1.2,.85]],
  });
  result.sides[side]={quaternion:arm.hand.quaternion.toArray(),grip:structuredClone(arm.poses.p320)};
  arm.fitGrip('release', {thumb: side === 'right' ? [-.022,-.018,.003] : [-.022,.020,.006], thumbPole: side === 'right' ? [0,0,1] : [0,0,-1]});
  result.sides[side].release=structuredClone(arm.poses.release);
}
// Retained/fresh magazine contact in the magazine's local frame. Blender
// keys this contact against the magazine trajectory, not a free-floating path.
const support = new Arm(-1, {scale:.97});
const magGrip = {pos:[-.032,-.146,.035],finger:[.08,.96,-.26],back:[-1,0,0]};
support.hand.position.fromArray(magGrip.pos);
support.hand.quaternion.copy(basis(magGrip.finger,magGrip.back));
support.setPose('wrap');
support.fitToCylinder(support.hand.position,support.hand.quaternion,[0,-.04,.014],[0,1,-.22],.016,{clearance:.0015,poseName:'magazine'});
support.fitGrip('magazine',{thumb:[.012,-.065,.025],thumbPole:[0,0,1]});
result.magazine={pos:magGrip.pos,quaternion:support.hand.quaternion.toArray(),pose:support.poses.magazine};
writeFileSync(new URL('../assets/weapons/p320-compact/hand-reference.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log('P320 contact seed written; rebuild Blender actions after changing this file.');
