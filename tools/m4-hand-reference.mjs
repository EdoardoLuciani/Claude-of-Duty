#!/usr/bin/env node
// Offline seed for Blender wrist/finger authoring; never runs in the game.
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.js';
import { writeFileSync } from 'node:fs';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y,z),y,z));
};
const grips = {
  right: {pos:[.0351,-.007,.1223],finger:[.15,.35,-.92],back:[1,.03,.04]},
  left: {pos:[-.067358,.048661,-.193517],finger:[.70,-.10,-.71],back:[-.14,-.985,.001]},
};
const result = {grips,sides:{}};
for (const [side,g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1,{scale:side === 'left' ? .97 : 1});
  arm.hand.position.fromArray(g.pos);arm.hand.quaternion.copy(basis(g.finger,g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left') arm.fitToCylinder(arm.hand.position,arm.hand.quaternion,[0,.075,0],[0,0,1],.0285,{clearance:.0015,poseName:'m4'});
  arm.fitGrip('m4',side === 'right'
    ? {thumb:[-.025,.048,.046],index:[0,.037,-.005],spread:[0,.60,.62,.64]}
    : {thumb:[-.0134,.1065,-.252],thumbPole:[0,0,-1]});
  result.sides[side] = {quaternion:arm.hand.quaternion.toArray(),grip:structuredClone(arm.poses.m4)};
  if (side === 'right') {
    arm.setPose('m4');arm.fitGrip('release',{index:[.025,.0505,-.0295]});
    result.sides.right.release=structuredClone(arm.poses.release);
  }
}
const arm = new Arm(-1,{scale:.97});
const magGrip = {pos:[-.038,-.121,-.016],finger:[.10,.98,-.15],back:[-1,0,0]};
arm.hand.position.fromArray(magGrip.pos);arm.hand.quaternion.copy(basis(magGrip.finger,magGrip.back));
arm.setPose('wrap');
arm.fitToCylinder(arm.hand.position,arm.hand.quaternion,[0,-.035,-.069],[0,1,-.11],.020,{clearance:.0015,poseName:'magazine'});
arm.fitGrip('magazine',{thumb:[.017,-.040,-.061],thumbPole:[0,0,1]});
result.magazine={pos:magGrip.pos,quaternion:arm.hand.quaternion.toArray(),pose:arm.poses.magazine};
writeFileSync(new URL('../assets/weapons/m4a1-block-ii/hand-reference.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log('M4 hand control seed written; rebuild Blender actions after editing.');
