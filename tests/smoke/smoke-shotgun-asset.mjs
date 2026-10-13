// Actual committed export/source contract; no shotgun adapter or game-state substitute.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PNG } from 'pngjs';
import { Arm } from '../../src/weapons/hands.ts';
import { discoverAuthoredHands, applyAuthoredHand } from '../../src/weapons/authored-hands.ts';
import { createAuthoredActions, sampleAuthoredAction } from '../../src/weapons/authored-actions.ts';
const dir = new URL('../../assets/weapons/m590/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
const reference = JSON.parse(readFileSync(new URL('hand-reference.json', dir)));
const file = readFileSync(new URL('m590.glb', dir));
assert.equal(file.readUInt32LE(0), 0x46546c67); assert.equal(file.readUInt32LE(4), 2);
assert.equal(file.readUInt32LE(8), file.length); assert.equal(file.readUInt32LE(16), 0x4e4f534a);
const length = file.readUInt32LE(12), gltf = JSON.parse(file.subarray(20, 20 + length));
assert.equal(file.readUInt32LE(24 + length), 0x004e4942);
const bin = file.subarray(28 + length);
const expected = {
  Idle: [2, []], Pump: [.45, [[.32, 'pump'], [.995, 'end']]],
  Reload_Tactical: [.55, [[.02, 'start'], [.82, 'shellin'], [.995, 'end']]],
  Reload_Empty: [.95, [[.02, 'start'], [.68, 'shellin'], [.88, 'pump'], [.93, 'boltrelease'], [.995, 'end']]],
  Inspect: [3, [[.995, 'end']]], Draw: [.7, [[.995, 'end']]], Holster: [.45, [[.995, 'end']]],
};
assert.deepEqual(Object.keys(manifest.clips).sort(), Object.keys(expected).sort());
assert.deepEqual(gltf.animations.map(a => a.name).sort(), Object.keys(expected).sort());
assert.equal(manifest.units, 'metres'); assert.equal(manifest.blenderForward, '+Y');
assert.equal(manifest.blenderUp, '+Z'); assert.match(manifest.runtimeBasis, /no adapter basis transform/);
assert.deepEqual(manifest.shell, { caseLen: .07, rimR: .01105 });
assert.deepEqual(manifest.mechanism.stroke, [0, 0, .038]);
assert.deepEqual(manifest.contactWindows, reference.contactWindows);
assert.deepEqual(reference.contactWindows, {
  Pump: { forend: [0, .45] },
  Reload_Tactical: { shell: [.34 * .55, .58 * .55], release: [.58 * .55, .70 * .55], thumb: [.70 * .55, .82 * .55], insertionClearance: [.58 * .55, .55] },
  Reload_Empty: { shell: [.44 * .95, .50 * .95], release: [.50 * .95, .58 * .95], thumb: [.58 * .95, .68 * .95], insertionClearance: [.50 * .95, .95], forend: [[0, .22 * .95], [.78 * .95, .95]] },
});
assert.deepEqual(manifest.aliases, { pump: 'Pump', reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster' });
assert.equal(manifest.fxClass, 'shotgun'); assert.equal(manifest.opticGlass, null);
assert.ok(!gltf.nodes.some(n => /arm_|spent_case|camera|light/i.test(n.name)), 'no duplicate arms/cases/studio');
assert.ok(!gltf.cameras && !gltf.skins); assert.ok(!gltf.extensionsUsed?.includes('KHR_lights_punctual'));
assert.equal(gltf.buffers.length, 1); assert.equal(gltf.buffers[0].uri, undefined);
const blend = readFileSync(new URL('m590.blend', dir));
assert.ok(blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528);
assert.equal(gltf.images.length, 3);
for (const image of gltf.images) {
  assert.equal(image.uri, undefined); const v = gltf.bufferViews[image.bufferView];
  const png = PNG.sync.read(bin.subarray(v.byteOffset, v.byteOffset + v.byteLength));
  assert.equal(png.width, 1024); assert.equal(png.height, 1024);
}
for (const m of gltf.materials) {
  const pbr = m.pbrMetallicRoughness;
  assert.ok(pbr.baseColorTexture && pbr.metallicRoughnessTexture && m.normalTexture, m.name);
  assert.ok([0, 1].includes(pbr.metallicFactor ?? 1), 'binary metalness');
}
const primitives = gltf.meshes.reduce((n, m) => n + m.primitives.length, 0);
const triangles = gltf.nodes.reduce((n, node) => n + (node.mesh === undefined ? 0 : gltf.meshes[node.mesh].primitives.reduce((n, p) => n + gltf.accessors[p.indices].count / 3, 0)), 0);
assert.deepEqual(manifest.stats, { triangleInstances: triangles, primitives, materials: gltf.materials.length, images: 3, bytes: file.length });
assert.ok(triangles < 110000 && triangles > 10000 && primitives <= 40);
assert.ok(gltf.materials.length + Number(gltf.meshes.some(m => m.primitives.some(p => p.material === undefined))) <= 16);
assert.ok(file.length <= 10 * 1024 * 1024);
function floats(i) {
  const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView]; assert.equal(a.componentType, 5126);
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type], data = [];
  for (let n = 0; n < a.count; n++) for (let k = 0; k < width; k++) {
    const f = bin.readFloatLE((v.byteOffset ?? 0) + (a.byteOffset ?? 0) + n * (v.byteStride ?? width * 4) + k * 4);
    assert.ok(Number.isFinite(f)); data.push(f);
  }
  return data;
}
for (const animation of gltf.animations) {
  const [d, events] = expected[animation.name];
  assert.equal(manifest.clips[animation.name].duration, d);
  assert.deepEqual(manifest.clips[animation.name].events, events.map(([fraction, event]) => ({ time: fraction * d, event })));
  for (const s of animation.samplers) {
    const times = floats(s.input); floats(s.output); assert.equal(times[0], 0);
    assert.ok(Math.abs(times.at(-1) - d) < 1e-7, `${animation.name}: exact endpoint`);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
  }
  for (const c of animation.channels) if (c.target.path === 'scale') assert.equal(animation.samplers[c.sampler].interpolation, 'STEP');
  for (const name of ['M590_RIG', 'receiver', 'forend', 'bolt', 'trigger', 'shell_insert', 'hand_L', 'hand_R', ...['L', 'R'].flatMap(p => [
    ...Array.from({ length: 4 }, (_, i) => [`${p}_finger_${i}_root`, ...Array.from({ length: 3 }, (_, j) => `${p}_finger_${i}_${j}`)]).flat(),
    `${p}_thumb_base`, `${p}_thumb_0`, `${p}_thumb_1`,
  ])]) assert.ok(animation.channels.some(c => gltf.nodes[c.target.node].name === name), `${animation.name}/${name}: native channel`);
}
const loader = new GLTFLoader().register(() => ({ name: 'NODE_TEXTURE_STUB', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const model = await loader.parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
const node = name => { const o = model.scene.getObjectByName(name); assert.ok(o, name); return o; };
const rig = node('M590_RIG'), hands = discoverAuthoredHands(node);
assert.ok(rig.position.length() < 1e-8 && rig.quaternion.angleTo(new THREE.Quaternion()) < 1e-8 && rig.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-8);
const sockets = { muzzle: [0, .068, -.545], ejection: [.0205, .071, -.072], sight: [0, .102, -.137], loading: [0, .041, -.055], chamber: [0, .068, -.072] };
for (const [name, pos] of Object.entries(sockets)) {
  assert.equal(node(`SOCKET_${name}`).parent, rig); assert.deepEqual(manifest.sockets[name], pos);
  assert.ok(node(`SOCKET_${name}`).position.distanceTo(new THREE.Vector3(...pos)) < 1e-7);
}
for (const name of ['receiver', 'forend', 'bolt', 'trigger', 'shell_insert', 'hand_L', 'hand_R']) assert.equal(node(name).parent, rig);
const state = { mixer: new THREE.AnimationMixer(model.scene), name: null };
state.actions = createAuthoredActions(state.mixer, model.animations);
const arms = { left: new Arm(-1, { scale: .97 }), right: new Arm(1) };
const sample = (name, t) => { sampleAuthoredAction(state, name, t); model.scene.updateMatrixWorld(true); };
function pads(side) {
  const arm = arms[side], hand = hands[side];
  arm.hand.position.copy(hand.wrist.position); arm.hand.quaternion.copy(hand.wrist.quaternion); applyAuthoredHand(arm, hand); arm.root.updateMatrixWorld(true);
  return arm.fingers.map((f, i) => new THREE.Vector3(0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * .5).applyMatrix4(f.joints[2].matrixWorld));
}
sample('Idle', 0);
const restPads = pads('left'), shell = node('shell_insert'), forend = node('forend');
for (const side of ['left', 'right']) {
  assert.ok(hands[side].wrist.position.distanceTo(new THREE.Vector3(...reference.grips[side].pos)) < 1e-7);
  assert.ok(hands[side].wrist.quaternion.clone().normalize().angleTo(new THREE.Quaternion(...reference.sides[side].quaternion)) < 1e-6);
}
shell.scale.setScalar(1); model.scene.updateMatrixWorld(true);
assert.ok(new THREE.Box3().setFromObject(shell).getSize(new THREE.Vector3()).z > .069, 'hidden parent must not collapse exported hull descendants');
// Surface contacts and openings on the exported triangles, independent of source claims.
function surface(part) {
  part.updateWorldMatrix(true, true); const inverse = part.matrixWorld.clone().invert(), triangles = [];
  part.traverse(o => {
    if (!o.isMesh) return;
    const matrix = inverse.clone().multiply(o.matrixWorld), p = o.geometry.attributes.position, ix = o.geometry.index;
    for (let i = 0; i < ix.count; i += 3) triangles.push(new THREE.Triangle(...[0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, ix.getX(i + k)).applyMatrix4(matrix))));
  });
  return point => { const closest = new THREE.Vector3(); let best = Infinity;
    for (const t of triangles) best = Math.min(best, t.closestPointToPoint(point, closest).distanceTo(point));
    return best;
  };
}
const supportSurface = surface(forend), hullSurface = surface(shell), gripSurface = surface(node('receiver')), triggerSurface = surface(node('trigger'));
for (const p of [...reference.sides.left.pads, reference.sides.left.thumbPad]) assert.ok(supportSurface(new THREE.Vector3(...p)) < .002, 'actual forend mesh contact');
for (const p of [...reference.shell.pads, reference.shell.thumbPad]) assert.ok(hullSurface(new THREE.Vector3(...p).sub(new THREE.Vector3(...reference.shell.hullPosition))) < .002, 'actual shell mesh contact');
assert.ok(hullSurface(new THREE.Vector3(...reference.insertion.thumbPad).sub(new THREE.Vector3(...reference.shell.hullPosition))) < .002, 'insertion thumb reaches actual rim, not a floating helper');
for (const [i, p] of reference.sides.right.pads.entries()) {
  const target = new THREE.Vector3(...p);
  if (i === 0) target.sub(node('trigger').position);
  assert.ok((i === 0 ? triggerSurface : gripSurface)(target) < .003, 'actual firing grip/trigger contact');
}
assert.ok(gripSurface(new THREE.Vector3(...reference.sides.right.thumbPad)) < .003, 'actual thumb/beavertail contact');
const receiverMeshes = [];
node('receiver').traverse(o => { if (o.isMesh) { receiverMeshes.push(o); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.side = THREE.DoubleSide; } });
function clearRay(origin, direction, length) {
  return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction), 0, length).intersectObjects(receiverMeshes, false).length === 0;
}
assert.ok(clearRay([.05, .071, -.072], [-1, 0, 0], .05), 'real exported ejection opening');
assert.ok(clearRay([0, -.03, -.055], [0, 1, 0], .075), 'real exported loading opening');
assert.ok(clearRay([0, .102, -.10], [0, 0, -1], .06), 'real ghost-ring aperture');
assert.ok(!clearRay([.0055, .102, -.10], [0, 0, -1], .06), 'ghost-ring rim remains real geometry');
assert.ok(!clearRay([0, .1019, -.50], [0, 0, -1], .04), 'front blade tip is aligned with ghost ring');
shell.scale.setScalar(0);
let maxError = 0, maxThumbError = 0, maxWristStep = 0, maxFingerStep = 0, poses = 0;
for (const [name, [d]] of Object.entries(expected)) {
  let previous = null;
  for (let f = 0; f <= Math.ceil(d * 240); f++) {
    const t = Math.min(f / 240, d); sample(name, t); poses++;
    const ps = pads('left');
    const current = { pos: hands.left.wrist.position.clone(), q: [hands.left.wrist, ...hands.left.fingers.flatMap(f => [f.root, ...f.joints]), ...hands.left.thumb].map(j => j.quaternion.clone().normalize()) };
    if (previous) {
      const distance = current.pos.distanceTo(previous.pos), angle = Math.max(...current.q.map((q, i) => q.angleTo(previous.q[i])));
      maxWristStep = Math.max(maxWristStep, distance); maxFingerStep = Math.max(maxFingerStep, angle);
      assert.ok(distance < .020, `${name}/${t}: discontinuous wrist jump ${distance}`);
      assert.ok(angle < .4, `${name}/${t}: discontinuous wrist/finger/thumb rotation ${angle}`);
    }
    previous = current;
    for (const side of ['left', 'right']) {
      const wrist = hands[side].wrist; assert.ok(wrist.position.toArray().every(Number.isFinite));
    }
    if (name === 'Pump' || (name === 'Reload_Empty' && (t <= .22 * d || t >= .78 * d))) {
      for (let i = 0; i < 4; i++) {
        const error = ps[i].distanceTo(restPads[i].clone().add(forend.position)); maxError = Math.max(maxError, error);
        assert.ok(error < .002, `${name}/${t}: planted pump pad ${error}`);
      }
      assert.ok(forend.position.z >= -1e-7 && forend.position.z <= .0380001);
      assert.ok(Math.abs(node('bolt').position.z + .017 - forend.position.z) < 1e-7);
    }
    const window = reference.contactWindows[name]?.shell;
    if (window && t >= window[0] && t <= window[1]) {
      assert.equal(shell.scale.x, 1, 'contact window hull is visible');
      for (let i = 0; i < 4; i++) {
        const target = new THREE.Vector3(...reference.shell.pads[i]).sub(new THREE.Vector3(...reference.shell.hullPosition)).applyQuaternion(shell.quaternion).add(shell.position);
        const error = ps[i].distanceTo(target); maxError = Math.max(maxError, error);
        assert.ok(error < .002, `${name}/${t}: shell contact pad ${i}: ${error}`);
      }
      const arm = arms.left;
      const thumbPad = new THREE.Vector3(0, -.0078 * arm.scale, -.026 * arm.scale).applyMatrix4(arm.thumb.joints[1].matrixWorld);
      const target = new THREE.Vector3(...reference.shell.thumbPad).sub(new THREE.Vector3(...reference.shell.hullPosition)).applyQuaternion(shell.quaternion).add(shell.position);
      assert.ok(thumbPad.distanceTo(target) < .002, 'shell thumb remains planted');
    }
    const thumbWindow = reference.contactWindows[name]?.thumb;
    if (thumbWindow && t >= thumbWindow[0] && t <= thumbWindow[1]) {
      const arm = arms.left;
      const pad = new THREE.Vector3(0, -.0078 * arm.scale, -.026 * arm.scale).applyMatrix4(arm.thumb.joints[1].matrixWorld);
      const target = new THREE.Vector3(...reference.insertion.thumbPad).sub(new THREE.Vector3(...reference.shell.hullPosition)).applyQuaternion(shell.quaternion).add(shell.position);
      const error = pad.distanceTo(target); maxThumbError = Math.max(maxThumbError, error);
      assert.ok(error < .002, `${name}/${t}: rim push thumb drift ${error}`);
      // Withdrawn distal fingers must remain below the receiver's belly. The
      // saved-source BVH additionally sweeps the entire real deformed glove.
      assert.ok(ps.every(p => p.y < .033), `${name}/${t}: fingers did not release outside the receiver`);
    }
    if (!name.startsWith('Reload')) assert.ok(shell.scale.x < .001, `${name}: stray insert shell`);
  }
}
sample('Pump', .144); assert.ok(Math.abs(forend.position.z - .038) < .0001);
sample('Pump', .369); assert.ok(Math.abs(forend.position.z) < .0001);
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  const info = manifest.clips[name], beat = info.events.find(e => e.event === 'shellin').time;
  const [appear] = reference.contactWindows[name].shell, hide = (name === 'Reload_Empty' ? .70 : .84) * info.duration;
  sample(name, appear - .00001); assert.equal(shell.scale.x, 0);
  sample(name, appear + .00001); assert.equal(shell.scale.x, 1);
  sample(name, hide - .00001); assert.equal(shell.scale.x, 1);
  sample(name, hide + .00001); assert.equal(shell.scale.x, 0);
  sample(name, beat); assert.ok(shell.position.distanceTo(new THREE.Vector3(0, .0446, -.055)) < .002, 'accepted hull is inside real loading mouth');
  assert.ok(shell.quaternion.angleTo(new THREE.Quaternion()) < .04, 'hull aligned with tube at acceptance');
  sample(name, info.duration); assert.ok(shell.scale.x < .001);
}
sample('Idle', 0); assert.ok(rig.position.length() < 1e-8); assert.ok(forend.position.length() < 1e-8);
console.log(`M590 actual GLB: ${triangles} triangles / ${primitives} primitives / ${gltf.materials.length} materials / ${file.length} bytes; seven clips, ${poses} 240Hz poses, wrap/pump drift ${(maxError * 1000).toFixed(3)}mm, rim-thumb drift ${(maxThumbError * 1000).toFixed(3)}mm, max wrist step ${(maxWristStep * 1000).toFixed(2)}mm / hand rotation step ${maxFingerStep.toFixed(3)}rad; runtime not integrated`);
