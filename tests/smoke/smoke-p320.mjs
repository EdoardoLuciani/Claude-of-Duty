import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { resolveProfile, WEAPON_PROFILES } from '../../src/audio/weapons.ts';
import { Rng } from '../../src/core/rng.ts';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { makeM4Model, M4_URL } from '../../src/weapons/m4.ts';
import { makeP320Model, P320_URL } from '../../src/weapons/p320.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/p320-compact/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
const handReference = JSON.parse(readFileSync(new URL('hand-reference.json', dir)));
const blend = readFileSync(new URL('p320-compact.blend', dir));
assert(
  blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528,
  'editable Blender source'
);
const bytes = readFileSync(new URL(P320_URL));
const { json } = inspectGLB(bytes);
const nativeBytes = readFileSync(new URL('p320-compact.glb', dir));
const native = inspectGLB(nativeBytes);
assert.equal(json.animations.length, 8);
assert.equal(json.images.length, 4, 'shared base/ORM/normal/emission atlas, no arm textures');
assert.equal(json.materials.length, 1, 'all finishes, lettering and sights share one material');
assert.equal(json.meshes.length, 1);
assert.equal(json.meshes[0].primitives.length, 1, 'one complete animated weapon submission');
assert(json.meshes[0].primitives[0].attributes.TEXCOORD_1 !== undefined);
assert.equal(json.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord, 1);
assert.equal(json.materials[0].normalTexture.texCoord ?? 0, 0, 'normal detail keeps UV0');
assert.equal(
  json.materials[0].pbrMetallicRoughness.metallicRoughnessTexture.texCoord ?? 0,
  0,
  'roughness/metalness keep UV0'
);
assert.equal(json.materials[0].emissiveTexture.texCoord ?? 0, 0, 'sight emission keeps UV0');
assert.equal(json.skins.length, 1);
assert.equal(json.skins[0].joints.length, 9, 'rigid mechanical parts, not duplicate hands');
assert(
  !json.nodes.some((node) => node.name?.startsWith('Mark |')),
  'lettering is baked, not drawn'
);
// Blender's editable source retains its lossless PNGs; the cooked runtime uses KTX2.
for (const image of native.json.images) {
  const png = native.imagePNG(image);
  const kind = image.name.replace('p320-', '');
  const resolution = 1024;
  assert.equal(manifest.textureResolutions[kind], resolution);
  assert.equal(png.width, resolution);
  assert.equal(png.height, resolution);
  if (image.name.includes('emission')) {
    let lit = 0;
    for (let i = 0; i < png.data.length; i += 4)
      if (png.data[i] || png.data[i + 1] || png.data[i + 2]) lit++;
    assert(lit > 0 && lit < resolution * resolution * 0.01, 'sight-only emission mask');
  }
}
assert(json.materials[0].emissiveTexture, 'emission survives material consolidation');
assert(
  json.buffers.every((b) => !b.uri) && json.images.every((i) => i.bufferView !== undefined),
  'self-contained offline GLB'
);
assert(manifest.stats.triangles < 30000, 'low surfaces replace the 56862-triangle instance asset');
assert.equal(manifest.stats.primitives, 1);
assert.equal(manifest.stats.bytes, nativeBytes.length);
assert.equal(
  manifest.stats.vertices,
  json.accessors[json.meshes[0].primitives[0].attributes.POSITION].count
);
assert.equal(
  manifest.stats.triangles,
  json.accessors[json.meshes[0].primitives[0].indices].count / 3,
  'manifest counts actual rendered geometry'
);
for (const mesh of json.meshes)
  for (const p of mesh.primitives) {
    const pos = json.accessors[p.attributes.POSITION];
    assert(
      pos.max.some((v, i) => v - pos.min[i] > 0.0001),
      `${mesh.name}: not collapsed by zero-scale merge`
    );
    assert(p.attributes.NORMAL !== undefined && p.attributes.TEXCOORD_0 !== undefined);
  }
for (const clip of json.animations) {
  const names = clip.channels.map((c) => json.nodes[c.target.node].name);
  for (const name of ['hand_L', 'hand_R', 'L_thumb_base', 'R_finger_0_0'])
    assert(names.includes(name), `${clip.name}: authored ${name}`);
  for (const c of clip.channels)
    if (c.target.path === 'scale') {
      assert.equal(
        clip.samplers[c.sampler].interpolation,
        'STEP',
        'magazines never shrink across subframes'
      );
    }
}
const gltf = await parseGLB(bytes);
const model = makeP320Model(gltf);
for (const m of model.materials) {
  const source = json.materials.find((a) => a.name === m.name).pbrMetallicRoughness;
  assert(m.isMeshPhysicalNodeMaterial, 'authored weapon enters native indirect hook');
  assert.equal(m.map.channel, 1, 'lettering-focused color UV survives material conversion');
  assert.equal(m.normalMap.channel, 0, 'normal mapping is independent of color UV allocation');
  assert.equal(m.roughnessMap.channel, 0, 'roughness keeps surface UV0');
  assert.equal(m.metalnessMap.channel, 0, 'metalness keeps surface UV0');
  assert.equal(m.emissiveMap.channel, 0, 'sight emission keeps surface UV0');
  assert.deepEqual(m.color.toArray(), (source.baseColorFactor ?? [1, 1, 1]).slice(0, 3));
  assert.equal(m.metalness, source.metallicFactor ?? 1);
  assert.equal(m.roughness, source.roughnessFactor ?? 1);
  assert.equal(m.specularIntensity, 1, 'no loader specular/exposure compensation');
}
assert(model.nodes.muzzle[2] < -0.12 && Math.abs(model.nodes.muzzle[0]) < 1e-6);
assert(model.nodes.eject[0] > 0.01);
assert.equal(model.nodes.opticGlass, undefined, 'stock iron sights, no reflex');
assert.equal(WEAPON_DEFS.pistol.magSize, 15);
assert.equal(WEAPON_DEFS.pistol.reserve, 60);
assert.equal(WEAPON_DEFS.pistol.rpm, 460);
assert.equal(WEAPON_DEFS.pistol.damage, 28);
assert.equal(resolveProfile(WEAPON_DEFS.pistol.audio), WEAPON_PROFILES.pistol);
const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.004, 60);
const messages = [];
const ctx = {
  viewScene: new THREE.Scene(),
  camera,
  viewCamera: camera,
  rng: new Rng(320),
  time: { elapsed: 0, scale: 1 },
  events: { emit: (name, data) => messages.push({ name, ...data }) },
};
const vm = new Viewmodel(ctx, {
  get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(),
  reticleOutline: () => new THREE.MeshBasicMaterial(),
});
const rifleBytes = readFileSync(new URL(M4_URL));
const rifle = makeM4Model(await parseGLB(rifleBytes));
vm.addWeapon(rifle, { ...WEAPON_DEFS.rifle, cycleTime: 60 / WEAPON_DEFS.rifle.rpm });
const entry = vm.addWeapon(model, { ...WEAPON_DEFS.pistol, cycleTime: 60 / 460 });
const anim = entry.animation;
assert(anim.skin.isSkinnedMesh);
const weights = anim.skin.geometry.getAttribute('skinWeight');
const joints = anim.skin.geometry.getAttribute('skinIndex');
const verticesByPart = new Map(
  [
    'frame',
    'slide',
    'barrel',
    'trigger',
    'slide_catch',
    'magazine',
    'magazine_spare',
    'magazine_round',
    'magazine_spare_round',
  ].map((name) => [name, []])
);
assert.deepEqual(
  new Set(anim.skin.skeleton.bones.map((bone) => bone.name)),
  new Set(verticesByPart.keys())
);
for (let i = 0; i < weights.count; i++) {
  assert.equal(weights.getX(i), 1, 'one rigid influence per vertex');
  assert.equal(weights.getY(i) + weights.getZ(i) + weights.getW(i), 0);
  const part = anim.skin.skeleton.bones[joints.getX(i)]?.name;
  assert(verticesByPart.has(part), `vertex ${i}: expected mechanical joint`);
  verticesByPart.get(part).push(i);
}
for (const [part, vertices] of verticesByPart)
  assert(vertices.length > 0, `${part}: joint must own rendered geometry`);
const slideVertex = verticesByPart.get('slide')[0];
function skinPoint(index) {
  anim.root.updateMatrixWorld(true);
  anim.skin.skeleton.update();
  return anim.root.worldToLocal(
    anim.skin.localToWorld(anim.skin.getVertexPosition(index, new THREE.Vector3()))
  );
}
function assertPartGeometry(part, visible, context) {
  anim.root.updateMatrixWorld(true);
  anim.skin.skeleton.update();
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const index of verticesByPart.get(part))
    bounds.expandByPoint(anim.skin.getVertexPosition(index, point));
  const extent = bounds.getSize(point).length();
  assert(
    visible ? extent > 0.001 : extent < 1e-6,
    `${context}: ${part} skinned extent ${extent} must be ${visible ? 'visible' : 'collapsed'}`
  );
}
function assertMagazineGeometry(oldVisible, spareVisible, oldRoundVisible, context) {
  assertPartGeometry('magazine', oldVisible, context);
  assertPartGeometry('magazine_round', oldVisible && oldRoundVisible, context);
  assertPartGeometry('magazine_spare', spareVisible, context);
  assertPartGeometry('magazine_spare_round', spareVisible, context);
}
anim._sample('Idle', 0);
const slidePoint = skinPoint(slideVertex);
anim._sample('Last_Shot', manifest.clips.Last_Shot.duration);
assert(
  skinPoint(slideVertex)
    .sub(slidePoint)
    .distanceTo(new THREE.Vector3(0, 0, 0.027)) < 1e-6,
  'actual slide vertices follow the last-shot bone, not just an animated empty'
);
anim.update(0, 'reloadEmpty', 0.8, true, false);
assertPartGeometry('magazine_round', false, 'empty-magazine override');
// Constant Idle scale channels need explicit restoration before re-sampling;
// Three's PropertyMixer otherwise leaves an external zero-scale override intact.
for (const resetBetween of [false, true]) {
  anim.reset();
  anim.update(1 / 60, null, 0, true, false);
  assertPartGeometry('magazine_round', false, 'empty Idle');
  if (resetBetween) {
    anim.reset();
    assertPartGeometry('magazine_round', true, 'empty Idle -> reset');
  }
  anim.update(1 / 60, null, 0, false, true);
  assert(anim.magazineRound.visible);
  assertPartGeometry('magazine_round', true, `loaded Idle after reset=${resetBetween}`);
}
// Restoring the adapter override must not replace native hidden-round keys.
anim.reset();
anim.fire();
anim.update(2 / 60, null, 0, true, false);
anim._sample('Last_Shot', 2 / 60);
assertPartGeometry('magazine_round', false, 'authored Last_Shot after empty override');
anim.update(0, 'reloadEmpty', 0.8, true, false);
anim.update(0, 'reloadEmpty', 0.8, true, true);
assertPartGeometry('magazine_round', false, 'authored Reload_Empty after loaded update');
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  anim.reset();
  assertMagazineGeometry(true, false, true, `${name}: Idle`);
  const seatedPoint = skinPoint(verticesByPart.get('magazine')[0]);
  anim._sample(name, 0.8);
  assert(
    skinPoint(verticesByPart.get('magazine')[0]).distanceTo(seatedPoint) > 0.01,
    `${name}: old magazine vertices follow the departing bone`
  );
  anim._sample(name, 1 - 1e-6);
  assertMagazineGeometry(true, false, name !== 'Reload_Empty', `${name}: before handoff`);
  anim._sample(name, 1);
  assertMagazineGeometry(false, true, false, `${name}: at handoff`);
  const arrivingPoint = skinPoint(verticesByPart.get('magazine_spare')[0]);
  anim._sample(name, 1.8);
  assertMagazineGeometry(false, true, false, `${name}: fresh magazine seated`);
  assert(
    skinPoint(verticesByPart.get('magazine_spare')[0]).distanceTo(arrivingPoint) > 0.05,
    `${name}: fresh magazine vertices follow the arriving bone`
  );
  // STEP endpoints use the actual float32 clip time, not the rounded manifest duration.
  const nativeDuration = anim.actions[name].getClip().duration;
  anim._sample(name, nativeDuration - 1e-6);
  assertMagazineGeometry(false, true, false, `${name}: before final exchange`);
  anim._sample(name, nativeDuration);
  assertMagazineGeometry(true, false, true, `${name}: final exchange`);
  anim._sample(name, 1.8);
  anim.reset();
  assertMagazineGeometry(true, false, true, `${name}: reset during reload`);
}
anim._sample('Last_Shot', manifest.clips.Last_Shot.duration);
assert(
  anim.slide.position.z > 0.025,
  'authored last-shot endpoint holds open without a runtime override'
);
// The requested reload pose keeps every right-thumb joint fixed at the idle
// grip, including fractional frames and clip boundaries. No release gesture.
anim._sample('Idle', 0);
const thumbGrip = anim.hands.right.thumb.map((node) => node.quaternion.clone().normalize());
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  for (let frame = 0; frame <= manifest.clips[name].duration * 240; frame++) {
    anim._sample(name, frame / 240);
    for (let joint = 0; joint < 3; joint++) {
      const q = anim.hands.right.thumb[joint].quaternion.clone().normalize();
      assert(
        q.angleTo(thumbGrip[joint]) < 1e-4,
        `${name}: right thumb joint ${joint} leaves idle grip at ${(frame / 240).toFixed(4)}s`
      );
    }
  }
}
anim.reset();
for (const [name, key] of [
  ['reloadTac', 'reloadTac'],
  ['reloadEmpty', 'reloadEmpty'],
  ['inspect', 'inspectTime'],
  ['draw', 'drawTime'],
  ['holster', 'holsterTime'],
]) {
  assert.equal(entry.clips[name].duration, WEAPON_DEFS.pistol[key]);
}
// The shared event system owns ammunition; Blender's motion is not another state machine.
const wp = new WeaponSystem();
wp.ctx = ctx;
wp.rng = ctx.rng;
wp.viewmodel = vm;
wp.sim = { spawn() {}, clear() {} };
wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
for (const id of WEAPON_IDS) {
  const d = { ...WEAPON_DEFS[id], cycleTime: 60 / WEAPON_DEFS[id].rpm };
  wp.states.set(id, {
    def: d,
    pattern: buildRecoilPattern(d, Rng),
    mag: d.magSize,
    chambered: true,
    reserve: d.reserve,
    mode: d.modes[0],
    modeIndex: 0,
  });
}
vm.onClipEvent = (name, clip) => wp._onClipEvent(name, clip);
function step(seconds) {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    ctx.time.elapsed += 1 / 120;
    wp._fireTimer = Math.max(0, wp._fireTimer - 1 / 120 - 1e-12);
    wp._state.empty = !wp.state.mag && !wp.state.chambered;
    wp._state.magazineLoaded = wp.state.mag > 0;
    wp.lateUpdate(1 / 120, ctx);
    assert(vm.armL.hand.position.toArray().every(Number.isFinite));
    assert(vm.armR.hand.position.toArray().every(Number.isFinite));
  }
}
wp.setWeaponImmediate('pistol');
step(0.3);
assert(!vm.reticle.visible && !vm.scopeOverlay.visible);
const thumb = vm.armR.thumb.root.quaternion;
assert(
  thumb.angleTo(anim.hands.right.thumb[0].quaternion) < 1e-6,
  'finger curves consumed, not runtime pose substitution'
);
messages.length = 0;
for (let i = 0; i < 6; i++) {
  assert(wp.tryFire());
  step(16 / 120);
  assert(
    Math.abs(anim.slide.position.z - anim.slideRest.z) < 0.001,
    'slide returns before next legal shot'
  );
}
assert.equal(messages.filter((m) => m.name === 'weapon:fire').length, 6);
assert.equal(messages.filter((m) => m.name === 'weapon:shell').length, 6);
assert.equal(wp.state.mag, 9);
assert(wp.reload());
step(1.6);
assert.equal(wp.state.mag, 9, 'no ammo before insertion');
step(0.2);
assert.equal(wp.state.mag, 15);
assert.equal(wp.state.reserve, 54);
step(0.7);
assert(!wp.reloading);
assert(anim.magazine.visible && !anim.spare.visible);
assert(messages.some((m) => m.name === 'weapon:reload' && m.phase === 'magout' && m.retained));
wp.state.mag = 0;
wp.state.chambered = false;
assert(wp.reload());
step(1.8);
assert(anim.slide.position.z > 0.025);
step(1);
assert.equal(wp.state.mag, 14);
assert(wp.state.chambered);
assert.equal(wp.state.reserve, 39);
assert.equal(
  messages.filter((m) => m.name === 'weapon:reload' && m.phase === 'slide').length,
  1,
  'one synchronized slide-release audio beat'
);
assert(Math.abs(anim.slide.position.z - anim.slideRest.z) < 0.001);
wp.state.mag = 0;
wp.state.chambered = true;
assert(wp.tryFire());
step(0.4);
assert(anim.slide.position.z > 0.025, 'last-shot persistent lockback');
assert(!anim.magazineRound.visible, 'empty magazine has no displayed cartridge');
assert(wp.inspect());
step(0.5);
assert(anim.slide.position.z > 0.025, 'inspect preserves empty state');
vm.stopClip();
assert(wp.reload());
step(0.8);
const reserve = wp.state.reserve;
wp.setWeaponImmediate('rifle');
step(0.1);
assert.equal(
  wp.states.get('pistol').reserve,
  reserve,
  'cancel before mag-in does not grant ammunition'
);
assert(anim.magazine.visible && !anim.spare.visible);
wp.setWeaponImmediate('pistol');
wp.state.mag = 8;
wp.state.chambered = true;
step(0.2);
assert(wp.inspect());
step(0.7);
assert(wp.tryFire(), 'fire cancels inspect');
step(0.4);
assert(wp.setWeapon('rifle'));
step(0.45);
assert.equal(wp.activeId, 'rifle');
assert.equal(vm.clipName, 'draw');
step(0.7);
assert(wp.setWeapon('pistol'));
step(1.1);
assert.equal(wp.activeId, 'pistol');
assert.equal(vm.clipName, null);
// Frame-by-frame reload visibility includes fractional samples around handoffs.
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  for (let i = 0; i < 144 * 3; i++) {
    const t = (i / (144 * 3)) * manifest.clips[name].duration;
    anim._sample(name, t);
    // glTF matrix decomposition can perturb unit scale by float32 epsilon.
    assert(
      [anim.magazine.scale.x, anim.spare.scale.x].every(
        (v) => Math.min(Math.abs(v), Math.abs(v - 1)) < 1e-5
      )
    );
    if (t > 1.8)
      assert(!anim.magazine.visible && anim.spare.visible, `${name}: exactly one seated magazine`);
    const frame = t * 60;
    const contact =
      frame >= 61 && frame <= 109
        ? anim.spare
        : name === 'Reload_Tactical' && frame >= 19 && frame <= 58
          ? anim.magazine
          : null;
    if (contact) {
      anim.root.updateMatrixWorld(true);
      const target = contact.localToWorld(
        new THREE.Vector3().fromArray(handReference.magazine.pos)
      );
      const wrist = anim.hands.left.wrist.getWorldPosition(new THREE.Vector3());
      assert(
        wrist.distanceTo(target) < 0.002,
        `${name}/${frame.toFixed(1)}: magazine contact drifts ${(wrist.distanceTo(target) * 1000).toFixed(2)} mm`
      );
    }
  }
}
anim.reset();
wp.state.mag = 0;
wp.state.chambered = false;
assert(wp.reload());
step(0.7);
const beforeDeath = wp.state.reserve;
wp._onPlayerDeath();
step(1);
assert(wp.disabled && !wp.reloading);
assert.equal(wp.state.reserve, beforeDeath);
wp.resetForNewGame();
assert.equal(wp.states.get('pistol').reserve, 60);
assert.equal(wp.states.get('pistol').mag, 15);
vm.dispose();
assert.equal(model.materials.size, 0);
assert.equal(model.textures.size, 0);
console.log(
  `P320: ${manifest.stats.triangles} triangles, ${manifest.stats.primitives} primitives; eight Blender clips, wrists/fingers, magazine visibility, ammo/events, cadence, interruption and cleanup passed`
);
