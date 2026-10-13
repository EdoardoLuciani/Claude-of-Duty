#!/usr/bin/env node
// Offline seed for Blender wrist/finger authoring; never runs in the game.
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.ts';
import { writeFileSync } from 'node:fs';
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y,z),y,z));
};
const grips = {
  right: {pos:[.0351,-.012,.1228],finger:[.15,.35,-.92],back:[1,.03,.04]},
  left: {pos:[-.067358,.048661,-.193517],finger:[.70,-.10,-.71],back:[-.14,-.985,.001]},
};
const result = {grips,sides:{}};
for (const [side,g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1,{scale:side === 'left' ? .97 : 1});
  arm.hand.position.fromArray(g.pos);arm.hand.quaternion.copy(basis(g.finger,g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left') arm.fitToCylinder(arm.hand.position,arm.hand.quaternion,[0,.075,0],[0,0,1],.0285,{clearance:.0015,poseName:'m4'});
  arm.fitGrip('m4',side === 'right'
    ? {thumb:[-.025,.048,.046],index:[0,.0235,.004],spread:[0,.60,.62,.64]}
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
// Overhand hook on the left latch; the palm stays above/outboard of the stock.
const charging = {pos:[-.158,.130,.070],finger:[.900,0,-.436],back:[0,1,0]};
arm.hand.position.fromArray(charging.pos);arm.hand.quaternion.copy(basis(charging.finger,charging.back));
arm.setPose('pinch');
arm.fitGrip('charging',{index:[-.027,.104,.062],thumb:[-.035,.105,.079],thumbPole:[-1,0,0],
  fingers:[[.5,.9,.8],[1.1,1.2,.8],[1.1,1.2,.8],[1.1,1.2,.8]],spread:[0,0,0,0]});
result.charging={pos:charging.pos,quaternion:arm.hand.quaternion.toArray(),pose:arm.poses.charging};
writeFileSync(new URL('../assets/weapons/m4a1-block-ii/hand-reference.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log('M4 hand control seed written; rebuild Blender actions after editing.');
