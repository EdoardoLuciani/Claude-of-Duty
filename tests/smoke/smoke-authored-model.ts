import assert from 'node:assert/strict';

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { PhysicsSystem } from '../../src/physics/index.ts';
import { LAYER } from '../../src/physics/surfaces.ts';
import { CameraRig } from '../../src/player/camera.ts';
import type { RenderSystem } from '../../src/render/index-webgpu.ts';
import {
  BASE_ATTACHMENTS,
  configureWeaponAttachments,
  makeOpticModel,
  makeLaserModel,
  isAttachmentConfig,
  type AttachmentConfig,
} from '../../src/weapons/attachments.ts';
import { authoredModel, checkAuthoredDuration } from '../../src/weapons/authored-model.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { WeaponLaser } from '../../src/weapons/laser.ts';
import { ReticleMaterials } from '../../src/weapons/materials-tsl.ts';
import type { WeaponEntry, WeaponModelRecord } from '../../src/weapons/runtime-types.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';

// Real three clips; duration is inferred from the keys, as GLTFLoader does.
const track = (times: number[]): THREE.VectorKeyframeTrack =>
  new THREE.VectorKeyframeTrack(
    'bone.position',
    times,
    times.flatMap((t): number[] => [t, 0, 0])
  );
const clip = (name: string, ...tracks: THREE.KeyframeTrack[]): THREE.AnimationClip =>
  new THREE.AnimationClip(name, undefined, tracks);
// gltfpack 1.3 with -af 0: every constant track is one key at t=0.
const collapsed = (name: string): THREE.AnimationClip => clip(name, track([0]), track([0]));
const authored = {
  Idle: { duration: 0 },
  Fire: { duration: 0.06315789473684211 },
  Inspect: { duration: 40.1 },
};
const check = (c: THREE.AnimationClip): void => checkAuthoredDuration(c, authored, 'TEST_RIG');

// Idle is a single pose: the cook's one key at t=0 is exactly its authored 0 s.
check(collapsed('Idle'));

// Cooked key times are float32, so authored lengths round by ~1e-7.
const fire = clip('Fire', track([0, Math.fround(authored.Fire.duration)]));
check(fire);
assert.equal(fire.duration, Math.fround(authored.Fire.duration));
// Float32 rounding grows with length: 40.1 s stores as 40.0999985 s, 1.5e-6 off.
const long = clip('Inspect', track([0, Math.fround(authored.Inspect.duration)]));
check(long);
assert.equal(long.duration, Math.fround(authored.Inspect.duration));

for (const [bad, message] of [
  [clip('Fire', track([0, 0.07])), /Fire lasts 0\.07\d* s, authored 0\.0631/],
  [collapsed('Fire'), /Fire lasts 0 s/],
  [clip('Idle', track([0]), track([0, 2])), /Idle lasts 2 s, authored 0 s/],
  [clip('Idle'), /Idle has no tracks/],
  [clip('Inspect', track([0, 40.11])), /Inspect lasts 40\.11\d* s, authored 40\.1 s/],
  [clip('Reload', track([0, 1])), /no authored duration for Reload/],
] as const)
  assert.throws((): void => check(bad), message);

const nan = clip('Fire', track([0, 0.06]));
nan.duration = NaN;
assert.throws((): void => check(nan), /Fire lasts NaN s/, 'NaN never passes the tolerance check');
for (const duration of [-1, NaN])
  assert.throws(
    (): void => checkAuthoredDuration(collapsed('Idle'), { Idle: { duration } }, 'TEST_RIG'),
    /no authored duration for Idle/
  );
assert.throws(
  (): void => checkAuthoredDuration(collapsed('Fire'), { Fire: { duration: 0 } }, 'TEST_RIG'),
  /no authored duration for Fire/,
  'only Idle may be a 0 s pose'
);

// authoredModel normalizes every required clip before an adapter sees it.
const scene = new THREE.Group();
const rig = new THREE.Object3D();
rig.name = 'TEST_RIG';
scene.add(rig);
const gltf = fixture<GLTF>({
  scene,
  animations: [collapsed('Idle'), clip('Fire', track([0, Math.fround(authored.Fire.duration)]))],
});
const { animations, opticMountRest } = authoredModel(gltf, 'TEST_RIG', ['Idle', 'Fire'], authored);
assert.equal(opticMountRest, null, 'no MOUNT_optic, no optic datum');
// The optic datum is rig-local: a posed rig never bakes into it.
rig.position.set(0, 0.2, 0.1);
rig.rotation.set(0.3, 0.4, 0);
const opticMount = new THREE.Object3D();
opticMount.name = 'MOUNT_optic';
opticMount.position.set(0, 0.1, -0.07);
rig.add(opticMount);
const rest = authoredModel(gltf, 'TEST_RIG', ['Idle'], authored).opticMountRest;
assert(
  rest?.elements.every((v, i): boolean => Math.abs(v - opticMount.matrix.elements[i]) < 1e-12)
);
assert.deepEqual(
  animations.map((c): [string, number] => [c.name, c.duration]),
  [
    ['Idle', 0],
    ['Fire', Math.fround(authored.Fire.duration)],
  ]
);
assert.throws(
  (): unknown => authoredModel(gltf, 'TEST_RIG', ['Idle', 'Fire', 'Inspect'], authored),
  /missing Inspect clip/
);
// Shared glass remains a single thin-alpha surface, even if source art uses transmission.
for (const id of ['rmr', 'acog', 'scope'] as const) {
  const scene = new THREE.Group();
  for (const name of ['MOUNT_base', 'SOCKET_sight']) {
    const node = new THREE.Object3D();
    node.name = name;
    scene.add(node);
  }
  const source = new THREE.MeshPhysicalMaterial({ transmission: 0.97 });
  source.name = id === 'acog' ? '11 | coated optic lens' : '10 | coated lens';
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(), source);
  scene.add(lens);
  const asset = makeOpticModel(fixture<GLTF>({ scene }), id);
  assert.equal(lens.material.transmission, 0);
  assert.equal(lens.material.opacity, id === 'acog' ? 0.1 : 0.13);
  assert(lens.material.transparent);
  assert.equal(lens.material.depthWrite, false);
  asset.dispose();
}
// Repeated mount/remove borrows one asset, restores base datums/tuning and
// leaves no orphan glass/socket.
{
  const weaponScene = new THREE.Group();
  const root = new THREE.Object3D();
  weaponScene.add(root);
  const socket = new THREE.Object3D();
  socket.name = 'MOUNT_optic';
  socket.position.set(0, 0.1036, -0.067);
  root.add(socket);
  const irons = new THREE.Group();
  irons.name = 'IRON_sights';
  const ironsRemoved = new THREE.Group();
  ironsRemoved.name = 'IRON_sights_removed';
  root.add(irons, ironsRemoved);
  const assetScene = new THREE.Group();
  const base = new THREE.Object3D();
  base.name = 'MOUNT_base';
  const sight = new THREE.Object3D();
  sight.name = 'SOCKET_sight';
  sight.position.set(0, 0.0425072, -0.018);
  const geometry = new THREE.BoxGeometry(0.02, 0.01, 0.001);
  const lens = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  assetScene.add(base, sight, lens);
  const asset = makeOpticModel(fixture<GLTF>({ scene: assetScene }), 'rmr');
  const optics = { rmr: asset, acog: asset, scope: asset };
  let disposed = 0;
  let ownerDisposed = false;
  asset.scene.addEventListener('dispose', (): void => {
    ownerDisposed = true;
  });
  geometry.addEventListener('dispose', (): void => {
    assert(ownerDisposed, 'release retained warm object records before shared geometry');
    disposed++;
  });
  const model = fixture<Extract<WeaponModelRecord, { id: 'rifle' }>>({
    id: 'rifle',
    scene: weaponScene,
    root,
    opticMountRest: new THREE.Matrix4().makeTranslation(socket.position),
    nodes: fixture<Extract<WeaponModelRecord, { id: 'rifle' }>['nodes']>({
      sight: [0, 0.1395, 0.034],
      muzzle: [0, 0.075, -0.5],
    }),
  });
  const entry = fixture<WeaponEntry>({
    id: 'rifle',
    model,
    group: weaponScene,
    def: { ...WEAPON_DEFS.rifle },
    attachments: BASE_ATTACHMENTS,
    attachmentGroup: new THREE.Group(),
    railGroup: new THREE.Group(),
    laserEmitter: null,
    sight: new THREE.Vector3(),
    muzzle: new THREE.Vector3(),
    optic: null,
  });
  const config: AttachmentConfig = { ...BASE_ATTACHMENTS, optic: 'rmr' };
  for (let i = 0; i < 9; i++) {
    const optic = (['rmr', 'acog', 'scope'] as const)[i % 3];
    const config: AttachmentConfig = { ...BASE_ATTACHMENTS, optic, ironSights: optic !== 'scope' };
    // Mounting while the authored root is posed must not bake its current pose.
    root.rotation.x = i * 0.1;
    configureWeaponAttachments(entry, config, optics);
    assert.equal(root.children.length, 4);
    assert.equal(entry.attachmentGroup.parent, socket, 'instance follows its authored mount');
    assert.equal(irons.visible, config.ironSights);
    assert.equal(ironsRemoved.visible, !config.ironSights);
    assert(entry.sight.distanceTo(new THREE.Vector3(0, 0.1461072, -0.085)) < 1e-8);
    assert.deepEqual(entry.optic?.center, entry.sight.toArray());
    assert.equal(entry.def.eyeRelief, WEAPON_DEFS.rifle.opticEyeRelief?.[optic]);
    assert.equal(entry.def.adsFovScale, optic === 'rmr' ? 0.62 : optic === 'acog' ? 0.28 : 0.25);
    assert.equal(entry.def.adsSensScale, entry.def.adsFovScale);
    assert.equal(
      entry.optic?.reticle,
      optic === 'acog' ? 'chevron' : optic === 'scope' ? 'p4fl' : undefined
    );
    const mountedLens = entry.attachmentGroup.children[0].children[2];
    assert(mountedLens instanceof THREE.Mesh);
    assert.equal(mountedLens.geometry, geometry);
    const oldMount = entry.attachmentGroup;
    configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
    assert.equal(oldMount.parent, null);
    assert.equal(oldMount.children.length, 0);
    assert.equal(entry.attachmentGroup.children.length, 0);
    assert.equal(entry.optic, null);
    assert.equal(entry.mountedOptic, null);
    assert(irons.visible);
    assert.equal(ironsRemoved.visible, false);
    assert.deepEqual(entry.sight.toArray(), model.nodes.sight);
    assert.deepEqual(entry.muzzle.toArray(), model.nodes.muzzle);
    assert.equal(entry.def.eyeRelief, WEAPON_DEFS.rifle.eyeRelief);
    assert.equal(entry.def.adsFovScale, undefined);
    assert.equal(entry.def.adsSensScale, undefined);
    assert.equal(entry.def.suppressed, false);
    assert.equal(disposed, 0, 'instances must not dispose borrowed geometry');
  }
  const railMount = new THREE.Object3D();
  railMount.name = 'MOUNT_rail';
  railMount.position.set(0.0285, 0.075, -0.25);
  railMount.rotation.z = Math.PI / 2;
  root.add(railMount);
  const laserScene = new THREE.Group();
  const laserBase = new THREE.Object3D();
  laserBase.name = 'SOCKET_mount';
  const emitter = new THREE.Object3D();
  emitter.name = 'SOCKET_laser';
  emitter.position.set(0, -0.0105, -0.02518);
  laserScene.add(laserBase, emitter);
  const laser = makeLaserModel(fixture<GLTF>({ scene: laserScene }));
  const laserConfig: AttachmentConfig = { ...BASE_ATTACHMENTS, rail: 'laser' };
  assert(isAttachmentConfig(laserConfig, 'rifle'));
  assert.equal(
    isAttachmentConfig(laserConfig, 'pistol'),
    false,
    'unverified rail fits stay disabled'
  );
  for (let i = 0; i < 3; i++) {
    const before = { ...entry.def };
    configureWeaponAttachments(entry, laserConfig, optics, laser);
    assert.deepEqual(entry.def, before, 'rail module changes no weapon stats');
    assert.equal(entry.railGroup.parent, railMount);
    assert(entry.laserEmitter);
    assert.notEqual(entry.laserEmitter, emitter, 'instances borrow art, not transforms');
    const rail = entry.railGroup;
    configureWeaponAttachments(entry, { ...laserConfig, optic: 'rmr' }, optics, laser);
    assert.equal(entry.attachmentGroup.parent, socket);
    assert.equal(entry.railGroup.parent, railMount, 'optic and rail have independent parents');
    assert.equal(rail.parent, null);
    configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics, laser);
    assert.equal(entry.laserEmitter, null);
    assert.equal(railMount.children.length, 0, 'removing the laser leaves no mounted mesh');
    const previousConfig = entry.attachments;
    assert.throws(
      (): void => configureWeaponAttachments(entry, laserConfig, optics),
      /unavailable/
    );
    assert.equal(entry.attachments, previousConfig, 'failed staging preserves the configuration');
  }
  laser.dispose();
  configureWeaponAttachments(entry, { ...BASE_ATTACHMENTS, ironSights: false }, optics);
  assert.equal(entry.optic, null);
  assert.equal(irons.visible, false, 'irons can be removed without mounting an optic');
  assert(ironsRemoved.visible);
  const bareMount = entry.attachmentGroup;
  assert.throws(
    (): void => configureWeaponAttachments(entry, { ...BASE_ATTACHMENTS, optic: 'scope' }, optics),
    /incompatible attachments/
  );
  assert.equal(entry.attachmentGroup, bareMount);
  assert.equal(irons.visible, false, 'rejected optic/irons combination preserves visibility');
  const materials = new ReticleMaterials();
  const viewmodel = new Viewmodel(
    createTestContext({
      providers: { render: fixture<RenderSystem>({ screenSize: { width: 1920, height: 1080 } }) },
    }),
    materials
  );
  root.rotation.set(0, 0, 0);
  for (const optic of ['acog', 'scope'] as const) {
    configureWeaponAttachments(entry, { ...BASE_ATTACHMENTS, optic, ironSights: false }, optics);
    viewmodel._updateScope(entry, 1);
    assert(viewmodel.scopeOverlay.visible, 'mounted scope shows the overlay on a carbine');
    assert.equal(weaponScene.visible, false, 'mounted scope hides the gun at full ADS');
    assert.equal(viewmodel.maskUniforms.uSniper.value, optic === 'scope' ? 1 : 0);
    assert.equal(viewmodel.reticleUniforms.uChevron.value, optic === 'acog' ? 1 : 0);
    const mount = entry.attachmentGroup;
    const liveOptic = entry.mountedOptic;
    assert.throws((): void => configureWeaponAttachments(entry, config, {}), /unavailable/);
    assert.equal(entry.attachmentGroup, mount, 'failed staging preserves the current optic');
    assert.equal(entry.mountedOptic, liveOptic, 'failed staging preserves the live reticle datum');
    configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
    viewmodel._updateScope(entry, 1);
    assert.equal(viewmodel.scopeOverlay.visible, false);
    assert(weaponScene.visible, 'removing the scope restores visible irons even while aiming');
  }
  configureWeaponAttachments(entry, config, optics);
  viewmodel.rig.position.set(0, 0, -entry.def.eyeRelief).sub(entry.sight);
  viewmodel._updateReticle(entry, 1);
  assert(viewmodel.reticle.visible, 'settled mounted optic shows its dot');
  root.position.y = 0.1;
  root.updateMatrix();
  viewmodel._updateReticle(entry, 1);
  assert.equal(
    viewmodel.reticle.visible,
    false,
    'authored draw moving the lens away hides the dot'
  );
  root.rotation.x = 0.2;
  root.updateMatrix();
  const axis = new THREE.Vector3(0, Math.sin(0.2), -Math.cos(0.2));
  const expectedDot = axis.multiplyScalar(entry.def.eyeRelief);
  viewmodel.rig.position.copy(expectedDot).sub(entry.sight.clone().applyMatrix4(root.matrix));
  viewmodel._updateReticle(entry, 1);
  assert(viewmodel.reticle.visible, 'eye aligned with the posed optic sees the dot');
  assert(
    viewmodel.reticle.position.distanceTo(expectedDot) < 1e-10,
    'dot follows the authored optical axis'
  );
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  const slide = new THREE.Object3D();
  root.add(slide);
  slide.add(socket);
  configureWeaponAttachments(entry, config, optics);
  const restSight = entry.sight.clone();
  slide.position.x = 0.025;
  slide.rotation.y = 0.12;
  root.rotation.z = 0.08;
  weaponScene.updateMatrixWorld(true);
  const liveSight = sight.position.clone().applyMatrix4(socket.matrixWorld);
  const liveAxis = new THREE.Vector3(0, 0, -1).transformDirection(socket.matrixWorld);
  const liveDot = liveAxis.clone().multiplyScalar(entry.def.eyeRelief);
  viewmodel.rig.position.copy(liveDot).sub(liveSight);
  viewmodel._updateReticle(entry, 1);
  assert(viewmodel.reticle.visible, 'dot follows the animated slide and rotated rig');
  assert(viewmodel.reticle.position.distanceTo(liveDot) < 1e-10);
  assert(entry.sight.equals(restSight), 'live reticle must not move the rest ADS datum');
  configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
  slide.position.z = 0.027;
  configureWeaponAttachments(entry, config, optics);
  assert(entry.sight.equals(restSight), 'attaching while locked open retains the rest ADS datum');
  slide.position.z = 0;
  weaponScene.updateMatrixWorld(true);
  const instanceSight = entry.attachmentGroup.getObjectByName('SOCKET_sight');
  assert(instanceSight);
  assert(instanceSight.getWorldPosition(new THREE.Vector3()).distanceTo(liveSight) < 1e-10);
  const clone = weaponScene.clone(true);
  const clonedMount = clone.getObjectByName('MOUNT_optic');
  assert(clonedMount?.getObjectByName('attachments'), 'inspection clone retains mount ancestry');
  assert.notEqual(clonedMount, socket);
  configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
  viewmodel.dispose();
  materials.dispose();
  assert.equal(ownerDisposed, false, 'warm source survives mounted-instance disposal');
  asset.dispose();
  assert.equal(disposed, 1, 'asset owner releases shared geometry exactly once');
}
// Laser uses the bullet mask/query without publishing damage; AI wins over the
// wall behind it, moving/disabling that collider immediately moves the spot.
{
  const physics = new PhysicsSystem();
  const scene = new THREE.Scene();
  const laser = new WeaponLaser(scene);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 500);
  const viewCamera = camera.clone();
  const emitter = new THREE.Object3D();
  emitter.position.set(0.04, 0, -0.2);
  const anchor = new THREE.Object3D();
  anchor.add(emitter);
  const context = createTestContext({ camera, viewCamera });
  const rig = new CameraRig(context);
  rig.fov = camera.fov;
  rig.fireVibe = 1;
  rig.fireVibeTime = 0.07;
  const muzzle = new THREE.Vector3(0, 0, -0.3);
  const actor = physics.addCollider({
    shape: 'sphere',
    radius: 0.5,
    center: new THREE.Vector3(0, 0, -5),
    layer: LAYER.ACTOR,
  });
  physics.addCollider({
    shape: 'sphere',
    radius: 1,
    center: new THREE.Vector3(0, 0, -10),
    layer: LAYER.STATIC,
    surface: 'concrete',
  });
  const positions = laser.geometry.getAttribute('position');
  const dot = new THREE.Vector3();
  const update = (firingShake = 0): void => {
    context.config.firingShake = firingShake;
    rig.applyTo(camera);
    viewCamera.position.copy(camera.position);
    viewCamera.quaternion.copy(camera.quaternion);
    anchor.position.copy(camera.position);
    anchor.quaternion.copy(camera.quaternion);
    laser.updateAim(camera, WEAPON_DEFS.rifle, muzzle, physics, null);
    rig.applyFireVibe(camera, viewCamera, anchor);
    laser.update(camera, viewCamera, emitter, physics, null, 1080);
    dot.set(0, 0, 0);
    for (let i = 4; i < 8; i++) dot.add(new THREE.Vector3().fromBufferAttribute(positions, i));
    dot.multiplyScalar(0.25);
  };
  update();
  assert(laser.mesh.visible);
  assert(Math.abs(dot.z + 4.5) < 0.01, 'spot stops on the AI surface');
  const occluder = physics.addCollider({
    shape: 'sphere',
    radius: 0.01,
    center: new THREE.Vector3(0.035, 0, -0.7),
    layer: LAYER.STATIC,
    surface: 'metal',
  });
  update();
  assert(Math.abs(dot.z + 0.69) < 0.02, 'emitter obstruction clips a clear muzzle aim');
  occluder.enabled = false;
  actor.enabled = false;
  update();
  assert(Math.abs(dot.z + 9) < 0.01, 'spot stops on world collision behind the AI');
  const unshakenSpot = dot.clone();
  const unshakenEmitter = emitter.getWorldPosition(new THREE.Vector3());
  update(1);
  assert(
    dot.distanceTo(unshakenSpot) < 1e-5,
    'cosmetic firing shake preserves the ballistic target'
  );
  assert(
    emitter.getWorldPosition(new THREE.Vector3()).distanceTo(unshakenEmitter) > 1e-5,
    'the rendered emitter still follows cosmetic firing shake'
  );
  assert.equal(laser.geometry.getAttribute('position'), positions, 'updates reuse the same buffer');
  physics.colliders.length = 0;
  update();
  assert.equal(laser.geometry.drawRange.count, 6, 'a miss draws only the beam, no floating dot');
  laser.dispose();
  assert.equal(scene.children.length, 0);
}
console.log('authored models: clip durations, attachment lifetime and laser queries OK');
