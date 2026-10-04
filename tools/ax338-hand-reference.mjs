#!/usr/bin/env node
// Offline fitting inputs. Blender owns the resulting wrist/finger curves.
import * as THREE from 'three';
import { Arm } from '../src/weapons/hands.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const loader = new GLTFLoader().register(() => ({ name: 'OFFLINE_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const bytes = readFileSync(new URL('../public/models/player/arms.glb', import.meta.url));
const skin = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
skin.scene.updateMatrixWorld(true);
const meshes = []; skin.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
// Refine the initial joint-axis fit against Blender's real glove vertices.
// A finger-centre proxy alone misses the thick suede/knuckle silhouette.
function skinSamples(arm, prefix, distalWeight = .025) {
  const groups = [];
  for (const mesh of arm.skins) {
    const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
    const selected = new Uint8Array(indices.count), distal = new Uint8Array(indices.count);
    for (let v = 0; v < indices.count; v++) for (let k = 0; k < 4; k++) if (weights.getComponent(v,k) > .025) {
      const name = arm.skeleton.bones[indices.getComponent(v,k)].name;
      if (name.startsWith(prefix)) selected[v] = 1;
      if (name.startsWith('thumb_1') && weights.getComponent(v,k) > distalWeight) distal[v] = 1;
    }
    const faces = [], used = new Set();
    const index = mesh.geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i], b = index[i+1], c = index[i+2];
      if (!selected[a] && !selected[b] && !selected[c]) continue;
      faces.push(a,b,c); used.add(a); used.add(b); used.add(c);
    }
    const ids = [...used], points = [];
    for (const id of ids) points[id] = new THREE.Vector3();
    if (ids.length) groups.push({mesh,ids,points,faces,distal});
  }
  return groups;
}
const samplePoint = new THREE.Vector3();
function skinCost(arm, groups, signedGap, contact, tipOnly = false, contactGap = signedGap, contactSide = 0) {
  arm.updateFlex(); arm.root.updateMatrixWorld(true);
  let error = 0, nearest = Infinity;
  function measure(point, distal) {
    const gap = signedGap(point);
    error += Math.max(0,-.0003-gap) ** 2 * 1000;
    if (contact && (!tipOnly || distal) && (!contactSide || point.x * contactSide > .010)) nearest = Math.min(nearest,Math.abs(contactGap(point)));
  }
  for (const g of groups) {
    for (const id of g.ids) { g.mesh.getVertexPosition(id,g.points[id]); measure(g.points[id],g.distal[id]); }
    // Vertices alone miss glove triangles cutting across a corner. Measure
    // actual deformed triangle centroids and all three edge midpoints too.
    for (let i = 0; i < g.faces.length; i += 3) {
      const a = g.faces[i], b = g.faces[i+1], c = g.faces[i+2];
      const distal = contactSide ? g.distal[a] && g.distal[b] && g.distal[c] : g.distal[a] || g.distal[b] || g.distal[c];
      measure(samplePoint.copy(g.points[a]).add(g.points[b]).add(g.points[c]).multiplyScalar(1/3),distal);
      measure(samplePoint.copy(g.points[a]).add(g.points[b]).multiplyScalar(.5),distal);
      measure(samplePoint.copy(g.points[b]).add(g.points[c]).multiplyScalar(.5),distal);
      measure(samplePoint.copy(g.points[c]).add(g.points[a]).multiplyScalar(.5),distal);
    }
  }
  return error + (contact ? Math.max(0,nearest-.001) ** 2 * (contactSide ? 100 : 10) : 0);
}
function refineFingers(arm, pose, signedGap, contact = true, first = 0, last = 4, contactGap = signedGap) {
  for (let i = first; i < last; i++) {
    const groups = skinSamples(arm,`finger_${i}_`), joints = arm.fingers[i].joints;
    const cost = () => skinCost(arm,groups,signedGap,contact,false,contactGap);
    for (let pass = 0; pass < (last===1?8:6); pass++) for (let j = 0; j < (last===1?4:3); j++) {
      const rotation=j===3?arm.fingers[i].root.rotation:joints[j].rotation,axis=j===3?'y':'x';
      const center = rotation[axis], radius = pass < 3 ? .30 : .08;
      let best = center, minimum = cost();
      for (let step = 0; step <= 20; step++) {
        const angle = THREE.MathUtils.clamp(center + (step / 10 - 1) * radius, j===3?-.6:-1.95, j===3?.6:-.025);
        rotation[axis] = angle;
        const value = cost(); if (value < minimum) { minimum = value; best = angle; }
      }
      rotation[axis] = best;
      if(j===3)pose.fingerSpread[i]=best;else pose.fingers[i][j] = -best;
    }
  }
}
function refineThumb(arm, pose, signedGap, contact = true, contactGap = signedGap, contactSide = 0) {
  const groups = skinSamples(arm,'thumb_',contactSide ? .2 : .025);
  const root = arm.thumb.root.rotation, joints = arm.thumb.joints;
  const params = [[root,'x'],[root,'y'],[root,'z'],[joints[0].rotation,'x'],[joints[1].rotation,'x']];
  const cost = () => skinCost(arm,groups,signedGap,contact,true,contactGap,contactSide);
  for (let pass = 0; pass < 6; pass++) for (const [rotation,axis] of params) {
    const center = rotation[axis], radius = pass < 3 ? .25 : .06;
    let best = center, minimum = cost();
    for (let step = 0; step <= 20; step++) {
      rotation[axis] = center + (step/10-1)*radius;
      const value = cost(); if (value < minimum) { minimum = value; best = rotation[axis]; }
    }
    rotation[axis] = best;
  }
  pose.thumbBase = root.toArray().slice(0,3); pose.thumb = joints.map(j => -j.rotation.x);
}
function foreendGap(p) {
  const x = Math.abs(p.x), y = Math.abs(p.y - .075);
  let gap = Math.max(x - .027, y - .026, (x + y - .040) / Math.SQRT2);
  // Conservative real panel/rib/screw envelopes, separate on the two sides.
  // Do not fill the free space below the tube between the grip panels.
  for (const side of [-1,1]) gap = Math.min(gap,Math.max(Math.abs(p.x-side*.02675)-.00475,Math.abs(p.y-.043)-.015,Math.abs(p.z+.242)-.073));
  return gap;
}
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
};
// Generated from the actual curved mesh samples. Export geometry before this
// offline solve after changing grip-profile.json; runtime never evaluates it.
const pistolSections=JSON.parse(readFileSync(new URL('../assets/weapons/ax338/manifest.json',import.meta.url))).contactGeometry.pistolGripSections;
function pistolGap(p){
  let i=0;while(i<pistolSections.length-2&&p.y<pistolSections[i+1][0])i++;
  const a=pistolSections[i],b=pistolSections[i+1],t=THREE.MathUtils.clamp((a[0]-p.y)/(a[0]-b[0]),0,1);
  const z=THREE.MathUtils.lerp(a[1],b[1],t),w=THREE.MathUtils.lerp(a[2],b[2],t),d=THREE.MathUtils.lerp(a[3],b[3],t);
  const wrap=p.z>z?.0007:0;
  return Math.max((Math.hypot(p.x/(w+wrap),(p.z-z)/(d+wrap))-1)*Math.min(w,d),p.y-pistolSections[0][0],pistolSections.at(-1)[0]-p.y);
}
function polygonGap(p,poly,width){
  let inside=false,distance=Infinity;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[j],b=poly[i],dz=b[0]-a[0],dy=b[1]-a[1];
    const t=THREE.MathUtils.clamp(((p.z-a[0])*dz+(p.y-a[1])*dy)/(dz*dz+dy*dy),0,1);
    distance=Math.min(distance,(p.z-a[0]-t*dz)**2+(p.y-a[1]-t*dy)**2);
    if((a[1]>p.y)!==(b[1]>p.y)&&p.z<(b[0]-a[0])*(p.y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return Math.max((inside?-1:1)*Math.sqrt(distance),Math.abs(p.x)-width/2);
}
function roundedGap(p,z0,z1,y0,y1,r){
  const x=Math.abs(p.z-(z0+z1)/2)-(z1-z0)/2+r,y=Math.abs(p.y-(y0+y1)/2)-(y1-y0)/2+r;
  return Math.hypot(Math.max(x,0),Math.max(y,0))+Math.min(Math.max(x,y),0)-r;
}
const housingProfile=[[-.0157,.060],[.098,.060],[.119,.054],[.117,.037],[.079,.025],[-.0157,.025]];
const mountProfile=[[.060,.068],[.094,.068],[.120,.058],[.120,.035],[.096,.035],[.073,.038],[.060,.043]];
const triggerProfile=[[.022,.044],[.028,.044],[.027,.024],[.027,.013],[.023,.001],[.015,-.006],[.008,-.007],[.008,-.003],[.013,-.001],[.019,.006],[.021,.016],[.021,.026]];
function firingClearance(p){
  // Conservative broad phase: all of these obstacles fit inside these bounds.
  // Most distal samples are below the guard or lateral to the entire rifle.
  if(Math.abs(p.x)>.025)return .1;
  if(p.y<-.015)return pistolGap(p);
  const ring=Math.max(roundedGap(p,-.0157,.0522,-.0148,.0293,.010),-roundedGap(p,-.0091,.0469,-.0091,.0218,.008),Math.abs(p.x)-.0155);
  const passage=Math.max(Math.hypot(p.x,p.y-.075)-.013,Math.abs(p.z-.083)-.033);
  const mount=Math.max(polygonGap(p,mountProfile,.027),-passage);
  return Math.min(pistolGap(p),ring,polygonGap(p,housingProfile,.031),mount,polygonGap(p,triggerProfile,.005)-.0015);
}
const grips = {
  right: { pos: [.044, -.021, .114], finger: [.06, .04, -.997], back: [1, .03, .04] },
  // Support under the moulded panels, within actual hip/ADS arm reach.
  left: { pos: [-.069, .002, -.205], finger: [.76, -.10, -.64], back: [-.13, -.985, .001] },
};
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? .97 : 1 });
  arm.attachAsset({ meshes });
  arm.hand.position.fromArray(g.pos); arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left') arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, .075, 0], [0, 0, 1], .030, { clearance: .0015, poseName: 'ax338' });
  arm.fitGrip('ax338', side === 'right'
    ? { thumb: [-.020, .002, .078], index: [.015, .012, .030], spread: [0, .6, .62, .64] }
    : { thumb: [-.041, .055, -.263], thumbPole: [-1, 1, 0] });
  arm.setPose('ax338');
  if (side === 'left') {
    refineFingers(arm, arm.poses.ax338, foreendGap);
    refineThumb(arm, arm.poses.ax338, foreendGap);
  }
  if(side==='right'){
    // Fit the index around the aperture, the holding fingers against the grip,
    // and the thumb around the new housing; account for actual padded skins.
    refineFingers(arm,arm.poses.ax338,firingClearance,false,0,1);
    refineFingers(arm,arm.poses.ax338,firingClearance,true,1,4,pistolGap);
    refineThumb(arm,arm.poses.ax338,firingClearance,true,pistolGap,-1);
  }
  result.sides[side] = { quaternion: arm.hand.quaternion.toArray(), grip: structuredClone(arm.poses.ax338) };
  if(side==='right'){
    // Unhook at MCP first, then unfold the distal joints. Independent linear
    // curl blends sweep the fingertip through the shallow guard's front wall.
    result.rightRelease=[];
    const start=structuredClone(arm.poses.ax338),indexSamples=skinSamples(arm,'finger_0_');
    for(let step=0;step<=20;step++){
      const t=step/20,pose=structuredClone(start),first=THREE.MathUtils.clamp(t*2,0,1),second=THREE.MathUtils.clamp(t*2-1,0,1);
      pose.fingers[0][0]=THREE.MathUtils.lerp(start.fingers[0][0],.025,first);
      for(let j=1;j<3;j++)pose.fingers[0][j]=THREE.MathUtils.lerp(start.fingers[0][j],j===1?.10:.15,second);
      pose.fingerSpread[0]=THREE.MathUtils.lerp(start.fingerSpread[0],.22,t);
      arm.poses.indexRelease=pose;arm.setPose('indexRelease');
      if(step>0&&skinCost(arm,indexSamples,firingClearance,false)>1e-8)refineFingers(arm,pose,firingClearance,false,0,1);
      result.rightRelease.push({t,pose});
    }
    result.rightIndexed=structuredClone(result.rightRelease.at(-1).pose);
    result.rightUnwrap=[];
    const held=structuredClone(result.rightIndexed),holdingSamples=skinSamples(arm,'');
    for(let step=0;step<=12;step++){
      const t=step/12,pose=structuredClone(held),first=THREE.MathUtils.clamp(t*2,0,1),second=THREE.MathUtils.clamp(t*2-1,0,1);
      for(let i=1;i<4;i++)for(let j=0;j<3;j++)pose.fingers[i][j]=THREE.MathUtils.lerp(held.fingers[i][j],j===0?.15:.20,j===0?first:second);
      pose.thumb=held.thumb.map(v=>THREE.MathUtils.lerp(v,.15,t));
      arm.poses.unwrap=pose;arm.setPose('unwrap');
      if(step>0&&skinCost(arm,holdingSamples,firingClearance,false)>1e-8){refineFingers(arm,pose,firingClearance,false,1);refineThumb(arm,pose,firingClearance,false);}
      result.rightUnwrap.push({t,pose});
    }
    result.rightOpen=structuredClone(result.rightUnwrap.at(-1).pose);
  }
  if (side === 'left') {
    result.release = [];
    const start = structuredClone(arm.poses.ax338), end = structuredClone(start);
    end.fingers = [[.15,.25,.18],[.20,.30,.20],[.25,.32,.24],[.32,.36,.27]]; end.thumb = [.12,.20];
    for (let step = 0; step <= 16; step++) {
      const t = step/16, pose = structuredClone(start);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) pose.fingers[i][j] = THREE.MathUtils.lerp(start.fingers[i][j],end.fingers[i][j],t);
      for (let j = 0; j < 2; j++) pose.thumb[j] = THREE.MathUtils.lerp(start.thumb[j],end.thumb[j],t);
      arm.poses.release = pose; arm.setPose('release');
      const pos = g.pos.map((v,i) => v + (i < 2 ? -.060*t : 0)); arm.hand.position.fromArray(pos);
      refineFingers(arm,pose,foreendGap,false); refineThumb(arm,pose,foreendGap,false);
      result.release.push({t,pos,pose});
    }
  }
}
function contact(side, pos, finger, back, target, name) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? .97 : 1 });
  arm.hand.position.fromArray(pos); arm.hand.quaternion.copy(basis(finger, back)); arm.setPose('wrap');
  arm.fitGrip(name, target);
  return { pos, quaternion: arm.hand.quaternion.toArray(), pose: structuredClone(arm.poses[name]) };
}
// Four fingers wrap the exposed lower body; thumb opposes them across the
// short axis. The old wrist put finger roots at the receiver, above the grip.
const magPos = [-.039, -.050, .026];
const magQ = basis([0, -.04, -1], [-1, -.25, 0]);
const magArm = new Arm(-1, { scale: .97 });
magArm.attachAsset({ meshes });
magArm.hand.position.fromArray(magPos); magArm.hand.quaternion.copy(magQ);
magArm.setPose('wrap');
const envelope = new THREE.Box3(new THREE.Vector3(-.017, -.0385, -.127), new THREE.Vector3(.017, .0665, -.023));
const point = new THREE.Vector3(), near = new THREE.Vector3();
function gap(joint, local) {
  joint.updateWorldMatrix(true, false);
  point.fromArray(local).applyMatrix4(joint.matrixWorld);
  envelope.clampPoint(point, near);
  return envelope.containsPoint(point)
    ? -Math.min(point.x + .017, .017 - point.x, point.y + .0385, .0665 - point.y, point.z + .127, -.023 - point.z)
    : point.distanceTo(near);
}
const curls = [];
for (let i = 0; i < 4; i++) {
  const f = magArm.fingers[i], lengths = magArm._segLength[i], radii = magArm._segRadius[i];
  const curl = [];
  for (let j = 0; j < 3; j++) {
    let best = 0, cost = Infinity;
    const local = j < 2 ? [0, 0, -lengths[j]] : [0, -radii[3], -lengths[2] * .5];
    const clearance = j < 2 ? radii[j + 1] + .002 : .002;
    for (let step = 0; step <= 100; step++) {
      const angle = -.05 - step * 1.8 / 100; f.joints[j].rotation.x = angle;
      const g = gap(f.joints[j], local);
      const middle = gap(f.joints[j], [0, 0, -lengths[j] * .5]);
      const c = Math.abs(g - clearance) + Math.max(0, -g) * 12 + Math.max(0, radii[j] - .001 - middle) * 15;
      if (c < cost) { cost = c; best = angle; }
    }
    f.joints[j].rotation.x = best; curl.push(-best);
  }
  curls.push(curl);
}
magArm.fitGrip('magazine', { fingers: curls, thumb: [.029, -.031, -.024], thumbPole: [0, 0, 1] });
magArm.setPose('magazine');
const floor = new THREE.Box3(new THREE.Vector3(-.019, -.0435, -.1285), new THREE.Vector3(.019, -.0385, -.0215));
function boxGap(box, p) {
  box.clampPoint(p, near);
  return box.containsPoint(p)
    ? -Math.min(p.x - box.min.x, box.max.x - p.x, p.y - box.min.y, box.max.y - p.y, p.z - box.min.z, box.max.z - p.z)
    : p.distanceTo(near);
}
const magGap = p => Math.min(boxGap(envelope,p),boxGap(floor,p));
refineFingers(magArm, magArm.poses.magazine, magGap);
const rear = new THREE.Box3(new THREE.Vector3(-.023,-.008,-.023),new THREE.Vector3(.023,.062,.022));
const guard = new THREE.Box3(new THREE.Vector3(-.016,-.025,-.012),new THREE.Vector3(.016,.060,.077));
const magClearance = p => Math.min(magGap(p),boxGap(rear,p),boxGap(guard,p));
refineThumb(magArm, magArm.poses.magazine, magClearance, true, magGap, 1);
result.magazine = { pos: magPos, quaternion: magQ.toArray(), pose: structuredClone(magArm.poses.magazine) };
magArm.setPose('magazine');
magArm.fitGrip('magazineOpen', { fingers: [[.05,.10,.12],[.05,.10,.12],[.08,.12,.15],[.12,.16,.18]], thumb: [-.065,-.035,-.042], thumbPole: [0,0,1] });
magArm.setPose('magazineOpen');
refineFingers(magArm, magArm.poses.magazineOpen, magGap, false);
refineThumb(magArm, magArm.poses.magazineOpen, magClearance, false);
result.magazine.open = structuredClone(magArm.poses.magazineOpen);
result.magazine.grasp = [];
const open = result.magazine.open, closed = result.magazine.pose;
const openQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...open.thumbBase));
const closedQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...closed.thumbBase));
for (let step = 0; step <= 16; step++) {
  const t = step/16, pose = structuredClone(open);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) pose.fingers[i][j] = THREE.MathUtils.lerp(open.fingers[i][j],closed.fingers[i][j],t);
  pose.thumbBase = new THREE.Euler().setFromQuaternion(openQ.clone().slerp(closedQ,t)).toArray().slice(0,3);
  for (let j = 0; j < 2; j++) pose.thumb[j] = THREE.MathUtils.lerp(open.thumb[j],closed.thumb[j],t);
  magArm.poses.squeeze = pose; magArm.setPose('squeeze');
  refineFingers(magArm,pose,magGap,false); refineThumb(magArm,pose,magClearance,false);
  result.magazine.grasp.push({t,pose});
}
result.bolt = contact('right', [.135, .02, .085], [-.30, .50, -.81], [.90, .25, -.18],
  { index: [.069, .049, .057], thumb: [.055, .060, .056], thumbPole: [1, 0, 0] }, 'bolt');
const out = new URL('../assets/weapons/ax338/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('hand-reference.json', out), JSON.stringify(result, null, 2) + '\n');
console.log('AX338 hand reference written; regenerate Blender actions after changes.');
