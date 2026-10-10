// Real committed GLB + runtime adapter; no GPU, DCC or synthesized clip substitutes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeMPXModel, MPXAnimation, MPX_URL, MPX_EJECT_DELAY } from '../../src/weapons/mpx.js';
import { WEAPON_DEFS } from '../../src/weapons/defs.js';
import { Arm } from '../../src/weapons/hands.js';
import { Viewmodel } from '../../src/weapons/viewmodel.js';
import { Rng } from '../../src/core/rng.ts';
import manifest from '../../assets/weapons/sig-mpx/manifest.json' with { type: 'json' };
import ref from '../../assets/weapons/sig-mpx/hand-reference.json' with { type: 'json' };
const bytes = readFileSync(new URL(MPX_URL));
const loader = new GLTFLoader().register(() => ({ name: 'SMOKE_TEXTURE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const model = makeMPXModel(gltf), anim = new MPXAnimation(model), def = WEAPON_DEFS.smg;
assert([...model.materials].every(m => m.isMeshPhysicalNodeMaterial), 'authored weapons must use native PBR node materials');
assert.equal(model.id, 'smg'); assert.equal(model.reactiveFire, true);
assert(model.materials.size <= 16, 'runtime material budget includes any glTF fallback');
for (const prefix of ['11 |','12 |']) {
  const material = [...model.materials].find(m => m.name.startsWith(prefix));
  assert(material && material.transparent && material.forceSinglePass && !material.depthWrite);
  assert(material.opacity <= .02 && material.transmission === 0 && material.envMapIntensity <= .05, 'optical sheets must not wash out the world');
}
const interior = [...model.materials].find(m => m.name.startsWith('15 |'));
assert(interior && !interior.transparent && interior.metalness === 0 && interior.roughness > .9);
assert(interior.envMapIntensity <= .03 && interior.specularIntensity <= .02);
assert.equal(Object.keys(anim.actions).length, 8);
assert.equal(def.magSize, 30); assert.equal(def.reserve, 224); assert.equal(def.rpm, 950);
assert.equal(def.eyeRelief, .28); assert.equal(def.viewFov, .145, 'screen size decoupled from eye distance');
assert.equal(def.firingShoulderZ, .12); assert.equal(def.adsFiringShoulderZ, .28, 'ADS-only body anchor; hip/native clips unchanged');
assert.equal(def.damage, 24); assert.equal(def.muzzleVelocity, 400); assert.equal(def.penetration, .45);
assert.equal(def.spreadAds, .4);
assert.deepEqual(def.recoil, { pitch: .0085, yaw: .0031, kickBack: .015, kickUp: .006, roll: .026, punch: .27,
  freq: 10.5, damping: .4, adsScale: .74, crouchScale: .86, patternLength: 32, patternSeed: 0x9ac31f,
  climbShape: [1.3, 1.18, 1.08, 1.0], drift: .8 }, 'reticle/framing work must not change recoil');
assert.equal(def.suppressed, true); assert.equal(def.audio, 'suppressed');
// Shared glTF accessors must be converted once per track, not mutated again
// through another clip. Check known game-space idle wrists and finger curls.
for (const side of ['left', 'right']) {
  assert(anim.hands[side].wrist.position.distanceTo(new THREE.Vector3(...ref.grips[side].pos)) < 1e-6);
  const expectedQ = new THREE.Quaternion(...ref.sides[side].quaternion);
  assert(Math.abs(anim.hands[side].wrist.quaternion.dot(expectedQ)) > 1 - 1e-6);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    assert(Math.abs(anim.hands[side].fingers[i].joints[j].quaternion.x + Math.sin(ref.sides[side].grip.fingers[i][j] / 2)) < 1e-6, 'native curl axes preserve shared-hand convention');
  }
}
const clips = anim.clips();
for (const [name, duration] of [['reloadTac', def.reloadTac], ['reloadEmpty', def.reloadEmpty], ['inspect', def.inspectTime], ['draw', def.drawTime], ['holster', def.holsterTime]]) assert.equal(clips[name].duration, duration);
assert.equal(manifest.clips.Fire.duration, 60 / 950);
assert(!clips.reloadTac.events.some(e => e.name === 'magdrop'), 'partial magazine is retained');
assert.equal(clips.reloadEmpty.events.filter(e => e.name === 'magdrop').length, 1);
assert(Math.abs(model.nodes.muzzle[2] + manifest.dimensions.muzzle) < 1e-6, 'forward is game -Z, muzzle at suppressor exit');
assert(Math.abs(model.nodes.sight[0]) < 1e-6 && model.nodes.sight[1] > .079, 'optic is on axis');
assert(model.nodes.eject[0] > .026, 'right-handed ejection basis');
const point = new THREE.Vector3(), q = new THREE.Quaternion(), expected = new THREE.Vector3();
anim.fire(); anim.update(MPX_EJECT_DELAY, null, 0, false);
assert.equal(anim.name, 'Fire'); assert(anim.bolt.position.z > .03);
assert(model.root.getObjectByName('charging_handle').position.length() < 1e-6, 'non-reciprocating handle');
anim.update(.07, null, 0, false); assert(Math.abs(anim.bolt.position.z) < 1e-6);
anim.fire(); anim.update(.05, null, 0, true); assert.equal(anim.name, 'Last_Shot');
anim.update(.1, null, 0, true); assert(Math.abs(anim.bolt.position.z - .038) < 1e-6);
anim.update(0, 'inspect', 1, true); assert(Math.abs(anim.bolt.position.z - .038) < 1e-6, 'inspect preserves lockback');
const arms = [new Arm(-1, { scale: .97 }), new Arm(1)];
const hipInverse = new THREE.Matrix4().compose(new THREE.Vector3(...def.hipPos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.hipRot)), new THREE.Vector3(1, 1, 1)).invert();
arms[0].shoulder.set(-.2, -.22, .02).applyMatrix4(hipInverse);
arms[1].shoulder.set(.205, -.2, def.firingShoulderZ).applyMatrix4(hipInverse);
function poseArms() {
  for (const [i, side] of ['left', 'right'].entries()) {
    anim.handTarget(side, point, q); arms[i].solve(point, q);
    assert(arms[i].hand.position.distanceTo(point) < .002, `${anim.name}: ${side} wrist exceeds actual arm reach`);
  }
  anim.applyHands(...arms); for (const arm of arms) arm.root.updateMatrixWorld(true);
}
for (const [name, source] of [['reloadTac', 'Reload_Tactical'], ['reloadEmpty', 'Reload_Empty']]) {
  const info = manifest.clips[source];
  anim.update(0, name, info.duration * .55, name === 'reloadEmpty');
  assert(anim.spare.visible && !anim.magazine.visible);
  let meshes = 0;
  anim.spare.traverse(o => { if (o.isMesh) { meshes++; assert(Math.abs(o.matrixWorld.determinant() - 1) < 1e-5, 'spare descendants never baked at zero scale'); } });
  assert(meshes > 0);
  // Authoring sampled these actual evaluated magazine paths, including root
  // gestures. The native GLB and one-time basis conversion must preserve them.
  for (const [first, last, part] of info.contactWindows) {
    for (let i = 0; i <= 20; i++) {
      const t = first + (last - first) * i / 20;
      anim.update(0, name, t, name === 'reloadEmpty');
      const mag = model.root.getObjectByName(part);
      const matrix = new THREE.Matrix4().compose(mag.position, mag.quaternion, new THREE.Vector3(1, 1, 1));
      expected.fromArray(ref.magazine.pos).applyMatrix4(matrix).applyMatrix4(model.root.matrix);
      anim.handTarget('left', point, q);
      assert(point.distanceTo(expected) < .002, `${name}: hand detached at ${t} (${point.distanceTo(expected)})`);
      poseArms();
      for (let digit = 0; digit < 4; digit++) {
        const arm = arms[0];
        point.set(0, -arm._segRadius[digit][3] * 1.05, -arm._segLength[digit][2] * .5).applyMatrix4(arm.fingers[digit].joints[2].matrixWorld);
        expected.fromArray(ref.magazine.pads[digit]).applyMatrix4(matrix).applyMatrix4(model.root.matrix);
        assert(point.distanceTo(expected) < .002, `${name}: actual finger ${digit} misses magazine at ${t}`);
      }
    }
  }
  anim.reset(); assert(anim.magazine.visible && !anim.spare.visible);
  assert(model.root.position.length() < 1e-6, 'interrupt restores root');
}
anim.reset();
const release = model.root.getObjectByName('bolt_release'); release.updateMatrix();
const releaseRestInverse = release.matrix.clone().invert();
for (let i = 0; i <= 20; i++) {
  const [first, last] = manifest.clips.Reload_Empty.boltContactWindow;
  anim.update(0, 'reloadEmpty', first + (last - first) * i / 20, true); poseArms();
  release.updateMatrix();
  expected.fromArray(ref.boltRelease.thumb).applyMatrix4(releaseRestInverse).applyMatrix4(release.matrix).applyMatrix4(model.root.matrix);
  point.set(0, 0, -.026 * arms[0].scale).applyMatrix4(arms[0].thumb.joints[1].matrixWorld);
  assert(point.distanceTo(expected) < .002, 'posed thumb must follow the actual moving bolt catch');
}
anim.update(0, 'reloadEmpty', 2.3, false); assert(Math.abs(anim.bolt.position.z) < 1e-6, 'release closes carrier');
for (const name of Object.keys(clips)) {
  for (let i = 0; i <= 120; i++) {
    anim.update(0, name, clips[name].duration * i / 120, false);
    for (const side of ['left', 'right']) {
      anim.handTarget(side, point, q); assert(point.toArray().every(Number.isFinite)); assert(q.toArray().every(Number.isFinite));
    }
    poseArms();
    assert(arms[0].fingers[0].joints[0].quaternion.equals(anim.hands.left.fingers[0].joints[0].quaternion));
  }
  anim.reset(); assert(!anim.spare.visible && anim.magazine.visible);
}
anim.update(0, null, 0, false, false); assert(!anim.rounds.visible, 'no cartridges in an empty magazine, including chamber/+1');
anim.update(0, null, 0, false, true); assert(anim.rounds.visible);
// Evaluate the real shared reticle method with MPX optical data, including
// resolution/FOV changes and switching back to the legacy presentation.
assert.equal(model.nodes.opticGlass.reticle, 'dot'); assert.equal(model.nodes.opticGlass.dotMoa, 2);
const vm = Object.create(Viewmodel.prototype), screenSize = { height: 720 };
vm.ctx = { camera: new THREE.PerspectiveCamera(49.6, 16 / 9), viewCamera: new THREE.PerspectiveCamera(52.8, 16 / 9), get: () => ({ screenSize }) };
vm.anchor = new THREE.Object3D(); vm.rig = new THREE.Object3D(); vm.reticle = new THREE.Object3D();
for (const key of ['dotCore','dotHalo','dotRim','dotRing']) vm[key] = new THREE.Mesh(new THREE.CircleGeometry(1), new THREE.MeshBasicMaterial());
const optical = { optic: model.nodes.opticGlass };
for (const height of [720, 1080, 2160, 12000]) for (const worldFov of [40, 49.6, 70]) for (const fov of [8.7, 14, 36, 60]) {
  screenSize.height = height; vm.ctx.camera.fov = worldFov; vm.ctx.viewCamera.fov = fov;
  for (const distance of [.09, .11, .18, .24, .28]) for (const ads of [0, 1]) {
    vm.rig.position.set(-optical.optic.center[0], -optical.optic.center[1], -distance - optical.optic.center[2]);
    vm._updateReticle(optical, ads);
    assert(vm.reticle.visible && vm.dotCore.visible && !vm.dotRing.visible && !vm.dotHalo.visible && !vm.dotRim.visible);
    const radius = vm.dotCore.scale.x / distance;
    const expectedRadius = Math.tan(fov * Math.PI / 360) * Math.max(Math.tan(2 * Math.PI / (180 * 120)) / Math.tan(worldFov * Math.PI / 360), 1.5 / height);
    assert(Math.abs(radius - expectedRadius) < 1e-12, 'dot target-angle/pixel footprint independent of weapon framing, stance and eye distance');
  }
}
vm.ctx.get = () => null; vm.ctx.canvas = { height: 720 };
vm._updateReticle(optical, 1);
assert(Math.abs(vm.dotCore.scale.x / .28 - Math.tan(Math.PI / 6) * 1.5 / 720) < 1e-12, 'standalone preview uses its own framebuffer height');
vm.rig.position.x += .02; vm._updateReticle(optical, 1); assert(!vm.reticle.visible, 'off-aperture dot is hidden');
vm.rig.position.x -= .02;
vm._updateReticle({ optic: { ...optical.optic, reticle: undefined } }, 1);
assert(vm.dotRing.visible && vm.dotHalo.visible && vm.dotRim.visible, 'other reflex optics restore their existing presentation');
assert(Math.abs(vm.dotCore.scale.x / .28 - .0016) < 1e-12);
vm._updateReticle({ optic: null }, 1); assert(!vm.reticle.visible, 'stock irons have no floating dot');
for (const key of ['dotCore','dotHalo','dotRim','dotRing']) { vm[key].geometry.dispose(); vm[key].material.dispose(); }
// Complete playable update path with shared arm skins and independent cameras.
anim.reset();
const camera = new THREE.PerspectiveCamera(49.6, 16 / 9, .005, 60), viewCamera = camera.clone();
const posedVM = new Viewmodel({ camera, viewCamera, viewScene: new THREE.Scene(), rng: new Rng(704),
  get: () => null, canvas: { height: 720 } }, { get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(), reticleOutline: () => new THREE.MeshBasicMaterial() });
const armBytes = readFileSync(new URL('../../public/models/player/arms.glb', import.meta.url));
const skin = await loader.parseAsync(armBytes.buffer.slice(armBytes.byteOffset, armBytes.byteOffset + armBytes.byteLength), '');
skin.scene.updateMatrixWorld(true);
const meshes = []; skin.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
posedVM.armL.attachAsset({ meshes }); posedVM.armR.attachAsset({ meshes });
posedVM.addWeapon(model, { ...def, cycleTime: 60 / def.rpm }); posedVM.setActive('smg');
let maxHip = 0, maxAim = 0, maxDraw = 0, maxGripError = 0;
const inverseArm = new THREE.Matrix4();
function checkPose(ads, dt = 1 / 60) {
  posedVM.update(dt, { ads, speed: 0, empty: false });
  for (const [arm, target] of [[posedVM.armR, posedVM._handPos], [posedVM.armL, posedVM._handPosL]]) {
    assert(arm.hand.position.distanceTo(target) < .002, 'playable wrist reaches the authored target');
    expected.copy(arm.hand.position).sub(arm.forePivot.position).normalize();
    point.set(0, 0, -1).applyQuaternion(arm.hand.quaternion);
    const angle = Math.acos(THREE.MathUtils.clamp(point.dot(expected), -1, 1)) * 180 / Math.PI;
    const hip = posedVM.adsT === 0 && !posedVM.clipName;
    assert(angle < (hip ? 60 : 85), `MPX ${posedVM.clipName ?? 'idle'}/${posedVM.adsT}: wrist ${angle}`);
    if (hip) maxHip = Math.max(maxHip, angle);
    else if (posedVM.clipName === 'draw') maxDraw = Math.max(maxDraw, angle);
    else maxAim = Math.max(maxAim, angle);
    assert(arm.forePivot.scale.z < 1.05, 'playable forearm does not stretch');
  }
  if (!posedVM.clipName) {
    posedVM.anchor.updateMatrixWorld(true);
    const arm = posedVM.armR; inverseArm.copy(arm.root.matrixWorld).invert();
    for (let digit = 0; digit < 4; digit++) {
      if (digit === 0) point.set(0, -.006 * arm.scale, -.013 * arm.scale);
      else point.set(0, -arm._segRadius[digit][3] * 1.05, -arm._segLength[digit][2] * .5);
      point.applyMatrix4(arm.fingers[digit].joints[2].matrixWorld).applyMatrix4(inverseArm);
      expected.fromArray(ref.sides.right.pads[digit]).applyMatrix4(model.root.matrix);
      const error = point.distanceTo(expected); maxGripError = Math.max(maxGripError, error);
      assert(error < .002, `refitted firing finger ${digit} must preserve its actual grip patch: ${error}`);
    }
  }
  if (posedVM.reticle.visible) {
    const depth = -posedVM.reticle.position.z;
    const pixels = posedVM.dotCore.scale.x * 720 / (depth * Math.tan(viewCamera.fov * Math.PI / 360));
    assert(Math.abs(pixels - 1.5) < .001, `current-frame FOV must preserve the dot during aim/draw: ${pixels}`);
  }
}
for (let i = 0; i < 120; i++) checkPose(false);
for (const ads of [true, false, true]) {
  for (let i = 0; i < 90; i++) checkPose(ads);
  assert(Math.abs(posedVM.shoulderR.z - (ads ? .28 : .12)) < 1e-6);
}
// Actual native draw while the shared ADS request is held, not separate tests
// of clip reach and idle aim. Sample at several gameplay update rates.
for (const fps of [30, 60, 120]) {
  posedVM.stopClip(); posedVM.adsT = 0; posedVM.play('draw');
  for (let i = 0; i < fps; i++) checkPose(true, 1 / fps);
}
console.log(`MPX actual skins: max hip ${maxHip.toFixed(2)}°, aim ${maxAim.toFixed(2)}°, held-aim draw ${maxDraw.toFixed(2)}°, grip patches ${(maxGripError * 1000).toFixed(3)}mm; constant 1.5px dot`);
posedVM.dispose();
anim.dispose(); assert.equal(model.materials.size, 0); assert.equal(model.textures.size, 0);
for (const arm of arms) arm.dispose();
console.log('MPX: eight native clips, exact timings, preserved balance/reactive recoil, game basis, suppressed sockets, lockback, non-reciprocating handle, retained/empty reloads, evaluated hand contacts, interruption, shared fingers and cleanup passed');
