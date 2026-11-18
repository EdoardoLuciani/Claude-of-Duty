import assert from 'node:assert/strict';

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import mcxManifest from '../../assets/weapons/mcx-virtus/manifest.json' with { type: 'json' };
import mpxManifest from '../../assets/weapons/sig-mpx/manifest.json' with { type: 'json' };
import { PhysicsSystem } from '../../src/physics/index.ts';
import { LAYER } from '../../src/physics/surfaces.ts';
import { CameraRig } from '../../src/player/camera.ts';
import type { RenderSystem } from '../../src/render/index-webgpu.ts';
import {
  BASE_ATTACHMENTS,
  configureWeaponAttachments,
  hasAttachmentAssets,
  mountAttachments,
  releaseAttachmentMounts,
  isAttachmentConfig,
  type AttachmentConfig,
} from '../../src/weapons/attachments.ts';
import {
  authoredModel,
  checkAuthoredDuration,
  rebaseNativeWeapon,
  requiredNode,
} from '../../src/weapons/authored-model.ts';
import { WEAPON_DEFS, WEAPON_IDS } from '../../src/weapons/defs.ts';
import { Arm } from '../../src/weapons/hands.ts';
import { WeaponLaser } from '../../src/weapons/laser.ts';
import { ReticleMaterials } from '../../src/weapons/materials-tsl.ts';
import { createMCXAnimation, makeMCXModel } from '../../src/weapons/mcx.ts';
import { makeMPXModel } from '../../src/weapons/mpx.ts';
import type { WeaponEntry, WeaponModelRecord } from '../../src/weapons/runtime-types.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';
import {
  datums,
  mountableWeapon,
  opticAsset,
  rigidAsset,
} from '../lib/weapon-attachment-fixture.ts';

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
  const baseDevice = new THREE.Group();
  baseDevice.name = 'MUZZLE_device';
  const baseSocket = new THREE.Object3D();
  baseSocket.name = 'SOCKET_muzzle';
  baseSocket.position.set(0, 0.075, -0.5);
  root.add(irons, ironsRemoved, baseDevice, baseSocket);
  const assetScene = datums('MOUNT_base', 'SOCKET_sight');
  const sight = requiredNode(assetScene, 'SOCKET_sight');
  sight.position.set(0, 0.0425072, -0.018);
  const geometry = new THREE.BoxGeometry(0.02, 0.01, 0.001);
  assetScene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  const asset = opticAsset(assetScene);
  const optics = { rmr: asset, acog: asset, scope: asset, exps3: asset };
  let disposed = 0;
  geometry.addEventListener('dispose', (): void => {
    disposed++;
  });
  const model = fixture<Extract<WeaponModelRecord, { id: 'rifle' }>>({
    id: 'rifle',
    scene: weaponScene,
    root,
    opticMountRest: new THREE.Matrix4().makeTranslation(socket.position),
    nodes: fixture<Extract<WeaponModelRecord, { id: 'rifle' }>['nodes']>({
      sight: [0, 0.1395, 0.034],
    }),
  });
  const entry = fixture<WeaponEntry>({
    ...mountableWeapon('rifle'),
    id: 'rifle',
    model,
    group: weaponScene,
    baseMuzzleSocket: baseSocket,
    muzzleSocket: baseSocket,
    def: { ...WEAPON_DEFS.rifle },
  });
  const config: AttachmentConfig = { ...BASE_ATTACHMENTS, optic: 'rmr' };
  for (let i = 0; i < 9; i++) {
    const optic = (['rmr', 'acog', 'scope'] as const)[i % 3];
    const config: AttachmentConfig = { ...BASE_ATTACHMENTS, optic };
    // Mounting while the authored root is posed must not bake its current pose.
    root.rotation.x = i * 0.1;
    configureWeaponAttachments(entry, config, optics);
    assert.equal(root.children.length, 5, 'empty slot groups stay detached');
    assert.equal(entry.opticGroup.parent, socket, 'instance follows its authored mount');
    assert.equal(irons.visible, false, 'a mounted optic replaces the removable irons');
    assert(ironsRemoved.visible);
    // Rail slots move the optic forward along its mount; the sight datum follows.
    const shift = entry.opticGroup.position.z;
    assert.equal(shift < 0, Boolean(WEAPON_DEFS.rifle.fits?.optic?.[optic]?.railSlots));
    assert(entry.sight.distanceTo(new THREE.Vector3(0, 0.1461072, -0.085 + shift)) < 1e-8);
    assert.equal(entry.eyeRelief, WEAPON_DEFS.rifle.fits?.optic?.[optic]?.eyeRelief);
    const mountedLens = entry.opticGroup.children[0].children[2];
    assert(mountedLens instanceof THREE.Mesh);
    assert.equal(mountedLens.geometry, geometry);
    const oldMount = entry.opticGroup;
    configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
    assert.equal(oldMount.parent, null);
    assert.equal(oldMount.children.length, 0);
    assert.equal(entry.opticGroup.children.length, 0);
    assert.equal(entry.mountedOptic, null);
    assert(irons.visible);
    assert.equal(ironsRemoved.visible, false);
    assert.deepEqual(entry.sight.toArray(), model.nodes.sight);
    assert.equal(entry.eyeRelief, WEAPON_DEFS.rifle.eyeRelief);
    assert.equal(disposed, 0, 'instances must not dispose borrowed geometry');
  }
  const railMount = new THREE.Object3D();
  railMount.name = 'MOUNT_rail';
  railMount.position.set(0.0285, 0.075, -0.25);
  railMount.rotation.z = Math.PI / 2;
  root.add(railMount);
  const laserScene = datums('SOCKET_mount', 'SOCKET_laser');
  requiredNode(laserScene, 'SOCKET_laser').position.set(0, -0.0105, -0.02518);
  const laser = rigidAsset('SOCKET_laser', laserScene);
  const laserConfig: AttachmentConfig = { ...BASE_ATTACHMENTS, rail: 'laser' };
  assert(isAttachmentConfig(laserConfig, 'rifle'));
  configureWeaponAttachments(entry, laserConfig, { ...optics, laser });
  assert.equal(entry.railGroup.parent, railMount);
  assert(entry.laserEmitter);
  const previous = entry.laserEmitter.getWorldPosition(new THREE.Vector3());
  railMount.position.z += 0.089;
  assert(
    Math.abs(
      previous.distanceTo(entry.laserEmitter.getWorldPosition(new THREE.Vector3())) - 0.089
    ) < 1e-8
  );
  railMount.position.z -= 0.089;
  configureWeaponAttachments(entry, { ...laserConfig, optic: 'rmr' }, { ...optics, laser });
  assert.equal(entry.opticGroup.parent, socket, 'optic and rail coexist');
  assert.equal(entry.railGroup.parent, railMount);
  configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
  assert.equal(entry.laserEmitter, null);
  assert.equal(railMount.children.length, 0);
  // A posed native skin deforms exactly as before rebasing, moved into game space.
  {
    const skinRoot = new THREE.Group();
    skinRoot.name = 'SKIN_RIG';
    skinRoot.position.set(0.1, -0.02, 0.03);
    skinRoot.rotation.set(0.2, -0.4, 0.1);
    const bone = new THREE.Bone();
    bone.position.set(0.05, 0.01, -0.02);
    skinRoot.add(bone);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0.08, 0.02, -0.01], 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
    const skin = new THREE.SkinnedMesh(geometry);
    skin.position.set(-0.01, 0.02, 0);
    skinRoot.add(skin);
    const skinScene = new THREE.Group();
    skinScene.add(skinRoot);
    skinScene.updateMatrixWorld(true);
    skin.bind(new THREE.Skeleton([bone]));
    bone.position.x += 0.03;
    bone.rotation.set(0.3, 0.2, -0.5);
    const deformed = (): THREE.Vector3 => {
      skinScene.updateMatrixWorld(true);
      return skin.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(skin.matrixWorld);
    };
    const expected = deformed()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
      .add(new THREE.Vector3(0, 0.07, -0.14));
    rebaseNativeWeapon(fixture<GLTF>({ scene: skinScene, animations: [] }), [0, 0.07, -0.14]);
    assert(deformed().distanceTo(expected) < 1e-7, 'rebased skin matches the source deformation');
  }
  // MCX rebases its native frame and origin on load. Cached ADS must agree
  // with real mounted glass, and remounting during a rig pose must not bake it.
  const mcxScene = new THREE.Group(),
    mcxRoot = new THREE.Group();
  mcxRoot.name = 'MCX_RIG';
  mcxScene.add(mcxRoot);
  for (const name of ['muzzle', 'ejection', 'sight', 'magazine']) {
    const node = new THREE.Object3D();
    node.name = `SOCKET_${name}`;
    mcxRoot.add(node);
  }
  const mcxMount = new THREE.Object3D();
  mcxMount.name = 'MOUNT_optic';
  mcxMount.position.set(-0.036, 0.046, 0);
  mcxMount.rotation.y = -Math.PI / 2;
  mcxRoot.add(mcxMount);
  const mcxIrons = new THREE.Group();
  mcxIrons.name = 'IRON_sights';
  mcxRoot.add(mcxIrons);
  const mcxDevice = new THREE.Group();
  mcxDevice.name = 'MUZZLE_device';
  mcxRoot.add(mcxDevice);
  const handPosition = new THREE.Vector3(0.04, -0.02, -0.25);
  const handRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.3, -0.1));
  const frameRotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2
  );
  const inverseFrame = frameRotation.clone().invert();
  const nativeHandRotation = inverseFrame.clone().multiply(handRotation).multiply(frameRotation);
  for (const prefix of ['L', 'R']) {
    for (const name of [
      `hand_${prefix}`,
      ...Array.from({ length: 4 }, (_, i): string[] =>
        ['root', '0', '1', '2'].map((joint): string => `${prefix}_finger_${i}_${joint}`)
      ).flat(),
      ...['thumb_base', 'thumb_0', 'thumb_1'].map((joint): string => `${prefix}_${joint}`),
    ]) {
      const node = new THREE.Object3D();
      node.name = name;
      if (name.startsWith('hand_')) {
        node.position
          .copy(handPosition)
          .sub(new THREE.Vector3(0, 0.07, -0.14))
          .applyQuaternion(inverseFrame);
        node.quaternion.copy(nativeHandRotation);
      }
      mcxRoot.add(node);
    }
  }
  for (const name of ['magazine', 'magazine_spare', 'bolt', 'MECH_bolt', 'spent_case']) {
    const node = new THREE.Object3D();
    node.name = name;
    mcxRoot.add(node);
  }
  const fingerValues = new Float32Array(nativeHandRotation.toArray());
  const nativeMCX = makeMCXModel(
    fixture<GLTF>({
      scene: mcxScene,
      animations: Object.entries(mcxManifest.clips).map(([name, data]): THREE.AnimationClip => {
        const times = data.duration ? [0, data.duration] : [0];
        return clip(
          name,
          new THREE.VectorKeyframeTrack(
            'MCX_RIG.position',
            times,
            times.flatMap((): number[] => [0, 0, 0])
          ),
          new THREE.QuaternionKeyframeTrack('L_finger_0_root.quaternion', [0], fingerValues)
        );
      }),
    })
  );
  const animation = createMCXAnimation(nativeMCX, WEAPON_DEFS.mcx);
  const target = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  animation.handTarget?.('left', target, rotation);
  assert(
    target.distanceTo(handPosition) < 1e-7,
    'native MCX wrists include frame origin exactly once'
  );
  assert(rotation.angleTo(handRotation) < 1e-7, 'native MCX wrist orientation is in game space');
  const armL = new Arm(-1),
    armR = new Arm(1);
  for (const name of ['draw', 'holster', 'reloadTac', 'reloadEmpty', 'inspect']) {
    animation.update(0, name, 0, false);
    animation.applyHands?.(armL, armR);
    const actual = armL.fingers[0].root.quaternion.toArray();
    assert(
      actual.every((value, i): boolean => Math.abs(value - handRotation.toArray()[i]) < 1e-7),
      'shared accessor finger tracks rebase once across every native clip'
    );
  }
  animation.dispose();
  const mcxMounted = mountAttachments(nativeMCX, config, optics);
  nativeMCX.scene.updateMatrixWorld(true);
  const mcxExpected = asset.sight.clone().applyMatrix4(mcxMount.matrixWorld);
  assert(
    mcxMounted.sight.distanceTo(mcxExpected) < 1e-10,
    'MCX ADS includes the native basis/origin'
  );
  releaseAttachmentMounts(mcxMounted);
  mcxRoot.rotation.y = 0.3;
  const mcxPosed = mountAttachments(nativeMCX, config, optics);
  assert(mcxPosed.sight.distanceTo(mcxExpected) < 1e-10, 'MCX remount preserves rest ADS');
  assert.equal(mcxPosed.opticGroup.parent, mcxMount, 'MCX art still follows the live rig');
  releaseAttachmentMounts(mcxPosed);
  // MPX rebases native +X geometry, but shared attachments keep canonical locals.
  const nativeScene = new THREE.Group(),
    nativeRoot = new THREE.Group();
  nativeRoot.name = 'MPX_RIG';
  nativeScene.add(nativeRoot);
  for (const name of ['muzzle', 'ejection', 'sight', 'magazine']) {
    const node = new THREE.Object3D();
    node.name = `SOCKET_${name}`;
    nativeRoot.add(node);
  }
  const nativeMount = new THREE.Object3D();
  nativeMount.name = 'MOUNT_rail';
  nativeMount.position.set(0.295, 0, 0.037);
  nativeMount.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0)
    )
  );
  nativeRoot.add(nativeMount);
  // Optic/muzzle boundaries share canonical attachment locals after MPX rebasing.
  for (const name of ['MOUNT_optic', 'MOUNT_muzzle']) {
    const mount = new THREE.Object3D();
    mount.name = name;
    mount.position.set(0.04, 0.044, 0);
    mount.rotation.y = -Math.PI / 2;
    nativeRoot.add(mount);
  }
  for (const name of ['IRON_sights', 'IRON_sights_removed', 'MUZZLE_device']) {
    const node = new THREE.Group();
    node.name = name;
    nativeRoot.add(node);
  }
  const mpx = makeMPXModel(
    fixture<GLTF>({
      scene: nativeScene,
      animations: Object.entries(mpxManifest.clips).map(([name, data]): THREE.AnimationClip => {
        const times = data.duration ? [0, data.duration] : [0];
        return clip(
          name,
          new THREE.VectorKeyframeTrack(
            'MPX_RIG.position',
            times,
            new Array<number>(times.length * 3).fill(0)
          )
        );
      }),
    })
  );
  const mounted = mountAttachments(mpx, laserConfig, { laser });
  for (const yaw of [0, 0.3]) {
    nativeRoot.rotation.y = yaw;
    nativeScene.updateMatrixWorld(true);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(
      mounted.laserEmitter!.matrixWorld
    );
    assert(
      direction.distanceTo(new THREE.Vector3(0, 0, -1).applyQuaternion(nativeRoot.quaternion)) <
        1e-10,
      'MPX laser points along the posed bore, not upward'
    );
    assert(
      mounted
        .laserEmitter!.getWorldPosition(new THREE.Vector3())
        .distanceTo(new THREE.Vector3(0.0475, 0, -0.32018).applyQuaternion(nativeRoot.quaternion)) <
        1e-8,
      'MPX attachment keeps its authored side seat'
    );
  }
  for (const name of ['MOUNT_optic', 'MOUNT_muzzle']) {
    const mount = nativeScene.getObjectByName(name)!;
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(mount.matrixWorld);
    assert(
      forward.distanceTo(new THREE.Vector3(0, 0, -1).applyQuaternion(nativeRoot.quaternion)) <
        1e-10,
      `${name}: shared attachment stays bore-forward after MPX basis conversion`
    );
  }
  releaseAttachmentMounts(mounted);
  const materials = new ReticleMaterials();
  const viewmodel = new Viewmodel(
    createTestContext({
      providers: { render: fixture<RenderSystem>({ screenSize: { width: 1920, height: 1080 } }) },
    }),
    materials
  );
  // The active socket follows a transformed/animated mount, not a baked offset.
  const muzzleMount = new THREE.Object3D();
  muzzleMount.name = 'MOUNT_muzzle';
  muzzleMount.position.set(0, 0.075, -0.44);
  muzzleMount.rotation.y = 0.13;
  // Re-append the base socket after MOUNT_muzzle, as authored rigs order them: a by-name
  // lookup on a mounted rig finds the can endcap (same name, under the mount) first.
  root.add(muzzleMount, baseSocket);
  const canScene = datums('SOCKET_mount', 'SOCKET_muzzle');
  const canExit = requiredNode(canScene, 'SOCKET_muzzle');
  canExit.position.z = -0.236;
  const canMesh = new THREE.Mesh(new THREE.CylinderGeometry(), new THREE.MeshStandardMaterial());
  canScene.add(canMesh);
  const can = rigidAsset('SOCKET_muzzle', canScene);
  let canDisposed = 0;
  canMesh.geometry.addEventListener('dispose', (): void => {
    canDisposed++;
  });
  const suppressed: AttachmentConfig = { ...BASE_ATTACHMENTS, muzzle: 'suppressor' };
  viewmodel.active = entry;
  for (let i = 0; i < 3; i++) {
    configureWeaponAttachments(entry, suppressed, { ...optics, srd762ti: can });
    assert.equal(baseDevice.visible, false);
    assert.equal(entry.muzzleGroup.parent, muzzleMount);
    root.rotation.x += 0.1;
    muzzleMount.position.z -= 0.01;
    muzzleMount.updateWorldMatrix(true, false);
    const expected = canExit.position.clone().applyMatrix4(muzzleMount.matrixWorld);
    assert(viewmodel.muzzleWorld(new THREE.Vector3()).distanceTo(expected) < 1e-10);
    assert.notEqual(entry.muzzleSocket, canExit, 'instances own their transforms');
    const installed = entry.muzzleGroup;
    assert.throws((): void => configureWeaponAttachments(entry, suppressed, optics), /unavailable/);
    assert.equal(entry.muzzleGroup, installed, 'failed staging retains the mounted can');
    assert.equal(baseDevice.visible, false);
    configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
    assert.equal(installed.parent, null);
    assert.equal(installed.children.length, 0);
    assert.equal(muzzleMount.children.length, 0);
    assert.equal(entry.muzzleSocket, baseSocket, 'removal restores the weapon bore exit');
    assert(baseDevice.visible);
    assert.equal(canDisposed, 0, 'removal never disposes borrowed geometry');
  }
  // One suppressor id mounts each weapon's own calibre can. Permanent muzzle
  // hardware (M590) stays visible; a removable device swaps for its stand-in.
  const exposed = new THREE.Group();
  exposed.name = 'MUZZLE_device_removed';
  exposed.visible = false;
  root.add(exposed);
  for (const id of WEAPON_IDS) {
    const fit = WEAPON_DEFS[id].fits?.muzzle?.suppressor;
    assert.equal(isAttachmentConfig(suppressed, id), fit !== undefined, `${id}: availability`);
    if (!fit) continue;
    const muzzleModel = fixture<WeaponModelRecord>({ ...model });
    muzzleModel.id = id;
    const weapon = fixture<WeaponEntry>({
      ...entry,
      id,
      model: muzzleModel,
      def: { ...WEAPON_DEFS[id] },
    });
    viewmodel.active = weapon;
    // Only the fitted model is loaded, so mounting must resolve that can.
    const cans = { [fit.model]: can };
    assert(hasAttachmentAssets(id, suppressed, cans), `${id}: ${fit.model} resolves`);
    configureWeaponAttachments(weapon, suppressed, cans);
    const removable = WEAPON_DEFS[id].removableMuzzleDevice === true;
    assert.equal(baseDevice.visible, !removable, `${id}: base device`);
    assert.equal(exposed.visible, removable, `${id}: removed stand-in`);
    const exit = canExit.position.clone().applyMatrix4(muzzleMount.matrixWorld);
    assert(viewmodel.muzzleWorld(new THREE.Vector3()).distanceTo(exit) < 1e-10);
    configureWeaponAttachments(weapon, BASE_ATTACHMENTS, {});
    assert(baseDevice.visible && !exposed.visible);
    assert.equal(muzzleMount.children.length, 0, `${id}: removal leaves no muzzle instance`);
  }
  // A removable device missing from the authored model fails before anything mounts.
  baseDevice.removeFromParent();
  viewmodel.active = entry;
  assert.throws(
    (): void => configureWeaponAttachments(entry, suppressed, { srd762ti: can }),
    /missing MUZZLE_device/
  );
  assert.equal(muzzleMount.children.length, 0);
  root.add(baseDevice);
  viewmodel.active = null;
  root.rotation.set(0, 0, 0);
  for (const optic of ['acog', 'scope'] as const) {
    configureWeaponAttachments(entry, { ...BASE_ATTACHMENTS, optic }, optics);
    viewmodel._updateScope(entry, 1);
    assert(viewmodel.scopeOverlay.visible, 'mounted scope shows the overlay on a carbine');
    assert.equal(weaponScene.visible, false, 'mounted scope hides the gun at full ADS');
    assert.equal(viewmodel.maskUniforms.uSniper.value, optic === 'scope' ? 1 : 0);
    assert.equal(viewmodel.reticleUniforms.uChevron.value, optic === 'acog' ? 1 : 0);
    const mount = entry.opticGroup;
    const liveOptic = entry.mountedOptic;
    assert.throws((): void => configureWeaponAttachments(entry, config, {}), /unavailable/);
    assert.equal(entry.opticGroup, mount, 'failed staging preserves the current optic');
    assert.equal(entry.mountedOptic, liveOptic, 'failed staging preserves the live reticle datum');
    configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
    viewmodel._updateScope(entry, 1);
    assert.equal(viewmodel.scopeOverlay.visible, false);
    assert(weaponScene.visible, 'removing the scope restores visible irons even while aiming');
  }
  // The EXPS3 ring is drawn only while it fits inside the lens.
  configureWeaponAttachments(entry, { ...BASE_ATTACHMENTS, optic: 'exps3' }, optics);
  viewmodel.rig.position.set(0, 0, -entry.eyeRelief).sub(entry.sight);
  viewmodel._updateReticle(entry, 1);
  assert(viewmodel.reticle.visible && viewmodel.reticleRing.visible);
  root.position.x = 0.1;
  root.updateMatrix();
  viewmodel._updateReticle(entry, 1);
  assert.equal(viewmodel.reticle.visible, false, 'no floating EXPS3 ring outside the lens');
  root.position.x = 0;
  root.updateMatrix();
  configureWeaponAttachments(entry, config, optics);
  viewmodel.rig.position.set(0, 0, -entry.eyeRelief).sub(entry.sight);
  viewmodel._updateReticle(entry, 1);
  assert(viewmodel.reticle.visible, 'settled mounted optic shows its dot');
  assert.equal(viewmodel.reticleRing.visible, false, 'a dot-only optic hides the ring');
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
  const liveDot = liveAxis.clone().multiplyScalar(entry.eyeRelief);
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
  const instanceSight = entry.opticGroup.getObjectByName('SOCKET_sight');
  assert(instanceSight);
  assert(instanceSight.getWorldPosition(new THREE.Vector3()).distanceTo(liveSight) < 1e-10);
  const clone = weaponScene.clone(true);
  const clonedMount = clone.getObjectByName('MOUNT_optic');
  assert(
    clonedMount?.getObjectByName('optic_attachment'),
    'inspection clone retains mount ancestry'
  );
  assert.notEqual(clonedMount, socket);
  configureWeaponAttachments(entry, BASE_ATTACHMENTS, optics);
  viewmodel.dispose();
  materials.dispose();
  assert.equal(disposed, 0, 'mounted-instance disposal never releases borrowed geometry');
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
  const beamEnd = new THREE.Vector3();
  const dot = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const update = (firingShake = 0): void => {
    context.config.firingShake = firingShake;
    rig.applyTo(camera);
    viewCamera.position.copy(camera.position);
    viewCamera.quaternion.copy(camera.quaternion);
    anchor.position.copy(camera.position);
    anchor.quaternion.copy(camera.quaternion);
    rig.applyFireVibe(camera, viewCamera, anchor);
    laser.update(camera, viewCamera, emitter, physics, null, 1080, WEAPON_DEFS.rifle.maxRange);
    beamEnd
      .fromBufferAttribute(positions, 2)
      .add(corner.fromBufferAttribute(positions, 3))
      .multiplyScalar(0.5);
    if (laser.geometry.drawRange.count === 12) {
      dot.set(0, 0, 0);
      for (let i = 4; i < 8; i++) dot.add(corner.fromBufferAttribute(positions, i));
      dot.multiplyScalar(0.25).project(camera);
      const hit = corner.copy(beamEnd).project(camera);
      assert(
        Math.hypot(dot.x - hit.x, dot.y - hit.y) < 1e-5,
        'the depth-biased spot projects onto the surface hit'
      );
    }
  };
  update();
  assert(laser.mesh.visible);
  assert.equal(laser.geometry.drawRange.count, 12, 'a hit draws the beam and spot');
  assert(Math.abs(beamEnd.z + 4.5) < 0.01, 'beam stops on the AI surface');
  const occluder = physics.addCollider({
    shape: 'sphere',
    radius: 0.01,
    center: new THREE.Vector3(0.035, 0, -0.7),
    layer: LAYER.STATIC,
    surface: 'metal',
  });
  update();
  assert(Math.abs(beamEnd.z + 0.69) < 0.02, 'emitter obstruction clips a clear muzzle aim');
  occluder.enabled = false;
  actor.enabled = false;
  update();
  assert(Math.abs(beamEnd.z + 9) < 0.01, 'beam stops on world collision behind the AI');
  const unshakenEnd = beamEnd.clone();
  const unshakenEmitter = emitter.getWorldPosition(new THREE.Vector3());
  update(1);
  assert(
    beamEnd.distanceTo(unshakenEnd) > 1e-5,
    'the rigid beam follows firing shake instead of steering back to the ballistic target'
  );
  assert(
    emitter.getWorldPosition(new THREE.Vector3()).distanceTo(unshakenEmitter) > 1e-5,
    'the rendered emitter still follows cosmetic firing shake'
  );
  physics.colliders.length = 0;
  for (const fov of [70, 35]) {
    rig.fov = fov;
    viewCamera.fov = 55;
    viewCamera.updateProjectionMatrix();
    rig.rotation.set(0.1, 0.4, 0.03);
    for (const yaw of [-0.12, 0.12]) {
      emitter.rotation.set(0.08, yaw, 0.02);
      update(1);
      const start = new THREE.Vector3()
        .fromBufferAttribute(positions, 0)
        .add(new THREE.Vector3().fromBufferAttribute(positions, 1))
        .multiplyScalar(0.5);
      assert(Math.abs(start.distanceTo(beamEnd) - WEAPON_DEFS.rifle.maxRange) < 1e-4);
      const lens = emitter.getWorldPosition(new THREE.Vector3()).project(viewCamera);
      const forward = emitter.localToWorld(new THREE.Vector3(0, 0, -1)).project(viewCamera);
      const projectedStart = start.project(camera);
      const projectedEnd = beamEnd.clone().project(camera);
      assert(
        Math.hypot(projectedStart.x - lens.x, projectedStart.y - lens.y) < 1e-5,
        'beam starts on the projected emitter in hip/ADS FOVs'
      );
      const axis = new THREE.Vector2(forward.x - lens.x, forward.y - lens.y).normalize();
      const beam = new THREE.Vector2(projectedEnd.x - lens.x, projectedEnd.y - lens.y).normalize();
      assert(
        axis.dot(beam) > 0.99999,
        'beam follows the posed emitter axis, not the camera crosshair'
      );
    }
  }
  assert.equal(laser.geometry.drawRange.count, 6, 'a miss draws only the beam, no floating dot');
  laser.dispose();
  assert.equal(scene.children.length, 0);
}
console.log('authored models: clip durations, attachment lifetime and laser queries OK');
