import assert from 'node:assert/strict';

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { RenderSystem } from '../../src/render/index-webgpu.ts';
import {
  BASE_ATTACHMENTS,
  configureWeaponAttachments,
  makeOpticModel,
  type AttachmentConfig,
} from '../../src/weapons/attachments.ts';
import { authoredModel, checkAuthoredDuration } from '../../src/weapons/authored-model.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
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
const { animations } = authoredModel(gltf, 'TEST_RIG', ['Idle', 'Fire'], authored);
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
    sight: new THREE.Vector3(),
    muzzle: new THREE.Vector3(),
    optic: null,
  });
  const config: AttachmentConfig = { optic: 'rmr', muzzle: null, rail: null };
  for (let i = 0; i < 9; i++) {
    const optic = (['rmr', 'acog', 'scope'] as const)[i % 3];
    const config: AttachmentConfig = { optic, muzzle: null, rail: null };
    // Mounting while the authored root is posed must not bake its current pose.
    root.rotation.x = i * 0.1;
    configureWeaponAttachments(entry, config, optics);
    assert.equal(root.children.length, 2);
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
    assert.deepEqual(entry.sight.toArray(), model.nodes.sight);
    assert.deepEqual(entry.muzzle.toArray(), model.nodes.muzzle);
    assert.equal(entry.def.eyeRelief, WEAPON_DEFS.rifle.eyeRelief);
    assert.equal(entry.def.adsFovScale, undefined);
    assert.equal(entry.def.adsSensScale, undefined);
    assert.equal(entry.def.suppressed, false);
    assert.equal(disposed, 0, 'instances must not dispose borrowed geometry');
  }
  const materials = new ReticleMaterials();
  const viewmodel = new Viewmodel(
    createTestContext({
      providers: { render: fixture<RenderSystem>({ screenSize: { width: 1920, height: 1080 } }) },
    }),
    materials
  );
  root.rotation.set(0, 0, 0);
  for (const optic of ['acog', 'scope'] as const) {
    configureWeaponAttachments(entry, { optic, muzzle: null, rail: null }, optics);
    viewmodel._updateScope(entry, 1);
    assert(viewmodel.scopeOverlay.visible, 'mounted scope shows the overlay on a carbine');
    assert.equal(weaponScene.visible, false, 'mounted scope hides the gun at full ADS');
    assert.equal(viewmodel.maskUniforms.uSniper.value, optic === 'scope' ? 1 : 0);
    assert.equal(viewmodel.reticleUniforms.uChevron.value, optic === 'acog' ? 1 : 0);
    const mount = entry.attachmentGroup;
    assert.throws((): void => configureWeaponAttachments(entry, config, {}), /unavailable/);
    assert.equal(entry.attachmentGroup, mount, 'failed staging preserves the current optic');
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
  configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
  viewmodel.dispose();
  materials.dispose();
  assert.equal(ownerDisposed, false, 'warm source survives mounted-instance disposal');
  asset.dispose();
  assert.equal(disposed, 1, 'asset owner releases shared geometry exactly once');
}
console.log('authored models: clip durations and shared attachment mount lifetime OK');
