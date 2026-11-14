#!/usr/bin/env bun
/** Offline runtime-to-Blender review bridge. No renderer, IK copy or GLB rewriting. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as THREE from 'three';
import { GLTFLoader, type GLTFLoaderPlugin } from 'three/addons/loaders/GLTFLoader.js';

import manifest from '../../../assets/weapons/mcx-virtus/manifest.json' with { type: 'json' };
import { Rng } from '../../../src/core/rng.ts';
import { isSkinnedMesh } from '../../../src/core/three-guards.ts';
import { WEAPON_DEFS } from '../../../src/weapons/defs.ts';
import { ReticleMaterials } from '../../../src/weapons/materials-tsl.ts';
import { makeMCXModel, MCXAnimation } from '../../../src/weapons/mcx.ts';
import { Viewmodel } from '../../../src/weapons/viewmodel.ts';

interface Track {
  name: string;
  source: string;
  alias: string | undefined;
  duration: number;
  ads: boolean;
}
interface SkinPoint {
  mesh: number;
  name: string;
  vertex: number;
  source: number[];
}
interface Side {
  arm: Viewmodel['armL'];
  basis: THREE.Matrix4;
  inverse: THREE.Matrix4;
  transform: number[];
}
const directory = resolve(process.argv[2] ?? 'assets/weapons/mcx-virtus');
// Textures do not affect contact/IK. Use the normal loader's texture hook to
// avoid browser image decoding; geometry, weights, helpers and clips are intact.
const loader = new GLTFLoader().register((): GLTFLoaderPlugin => ({
  name: 'MCX_review_geometry',
  loadTexture: (): Promise<THREE.Texture> => Promise.resolve(new THREE.Texture()),
}));
const load = async (path: string): ReturnType<GLTFLoader['parseAsync']> =>
  loader.parseAsync(await Bun.file(path).arrayBuffer(), '');
const arms = await load(
  new URL('../../../public/models/player/arms.glb', import.meta.url).pathname
);
arms.scene.updateMatrixWorld(true);
const meshes: THREE.SkinnedMesh[] = [];
arms.scene.traverse((object): void => {
  if (isSkinnedMesh(object)) meshes.push(object);
});
if (!meshes.length) throw new Error('MCX review needs the generated shared arm skins');
const vm = new Viewmodel(
  {
    scene: new THREE.Scene(),
    viewScene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(80, 16 / 9, 0.01, 20),
    viewCamera: new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 20),
    canvas: { height: 1080 },
    rng: new Rng(686),
    get: (): null => null,
  },
  new ReticleMaterials()
);
vm.armL.attachAsset({ meshes });
vm.armR.attachAsset({ meshes });
const entry = vm.addWeapon(makeMCXModel(await load(`${directory}/mcx-virtus.glb`)), {
  ...WEAPON_DEFS.mcx,
  swayScale: 0,
  bobScale: 0,
});
// The freshly exported weapon may contain only its mechanical skin, never
// review-arm deformation bones. Catch accidental export-selection changes.
entry.model.scene.traverse((object): void => {
  if (
    isSkinnedMesh(object) &&
    object.skeleton.bones.some((bone): boolean => !bone.name.startsWith('MECH_'))
  )
    throw new Error('Review skin leaked into the MCX weapon GLB');
});
vm.setActive('mcx');
const animation = entry.animation;
if (!(animation instanceof MCXAnimation)) throw new Error('MCX runtime adapter missing');
const aliases: Partial<Record<string, string>> = {
  Reload_Tactical: 'reloadTac',
  Reload_Empty: 'reloadEmpty',
  Inspect: 'inspect',
};
const native = Object.entries(manifest.clips).map(([name, clip]): Track => ({
  name,
  source: name,
  alias: aliases[name],
  duration: clip.duration,
  ads: false,
}));
const tracks = [
  ...native,
  { name: 'Draw', source: 'Idle', alias: 'draw', duration: entry.clips.draw.duration, ads: false },
  {
    name: 'Holster',
    source: 'Idle',
    alias: 'holster',
    duration: entry.clips.holster.duration,
    ads: false,
  },
  { name: 'Idle_ADS', source: 'Idle', alias: undefined, duration: 0, ads: true },
];
const conversion = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const sourceFromGame = conversion
  .clone()
  .invert()
  .multiply(entry.model.scene.matrix.clone().invert());
const sides = [vm.armL, vm.armR].map((arm): Side => {
  const basis = new THREE.Matrix4()
    .makeScale(arm.side < 0 ? arm.scale : -arm.scale, arm.scale, arm.scale)
    .multiply(conversion);
  return {
    arm,
    basis,
    inverse: basis.clone().invert(),
    transform: sourceFromGame.clone().multiply(basis).toArray(),
  };
});
const points = meshes.flatMap((mesh, meshIndex): SkinPoint[] => {
  const position = mesh.geometry.getAttribute('position');
  return Array.from({ length: 12 }, (_, i): SkinPoint => {
    const vertex = Math.floor((i * (position.count - 1)) / 11);
    return {
      mesh: meshIndex,
      name: mesh.name,
      vertex,
      source: new THREE.Vector3()
        .fromBufferAttribute(position, vertex)
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(conversion.clone().invert())
        .toArray(),
    };
  });
});
const bones = meshes[0]!.skeleton.bones.map((bone): string => bone.name);
const samples: number[] = [];
const inverseRig = new THREE.Matrix4(),
  skin = new THREE.Matrix4(),
  point = new THREE.Vector3();
const metadata = [];
for (const track of tracks) {
  vm.stopClip();
  animation.reset();
  vm.armL.setPose(entry.lhandPose);
  vm.armR.setPose(entry.rhandPose);
  const state = {
    ads: track.ads,
    sprint: false,
    lowReady: false,
    speed: 0,
    crouch: false,
    airborne: false,
    trigger: track.source === 'Fire',
    empty: false,
  };
  vm.adsT = track.ads ? 1 : 0;
  vm.triggerT = 0;
  vm.update(0, state);
  if (track.alias) vm.play(track.alias);
  const times = Array.from({ length: Math.ceil(track.duration * 120) + 1 }, (_, i): number =>
    Math.min(i / 120, track.duration)
  );
  metadata.push({ name: track.name, source: track.source, times, offset: samples.length });
  for (const [index, time] of times.entries()) {
    const dt =
      (index ? time - times[index - 1]! : 0) / (track.source === 'Fire' ? animation.fireSpeed : 1);
    if (track.source === 'Fire') animation.fireTime = time - dt * animation.fireSpeed;
    vm.update(dt, state);
    // Stock_Fold is source-only (no gameplay alias): retain the runtime Idle hold.
    vm.ctx.viewScene.updateMatrixWorld(true);
    inverseRig.copy(vm.rig.matrixWorld).invert();
    for (const { arm, basis, inverse } of sides) {
      const skeleton = arm.skeleton!;
      for (const [i, bone] of skeleton.bones.entries()) {
        skin
          .copy(inverse)
          .multiply(inverseRig)
          .multiply(bone.matrixWorld)
          .multiply(skeleton.boneInverses[i]!)
          .multiply(basis);
        samples.push(...skin.elements);
      }
    }
    for (const { arm } of sides)
      for (const reference of points) {
        const mesh = arm.skins[reference.mesh]!;
        mesh
          .getVertexPosition(reference.vertex, point)
          .applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(inverseRig)
          .applyMatrix4(sourceFromGame);
        samples.push(point.x, point.y, point.z);
      }
  }
}
mkdirSync(`${directory}/review`, { recursive: true });
writeFileSync(
  `${directory}/review/runtime-hands.json`,
  JSON.stringify({
    bones,
    points,
    transforms: sides.map((side): number[] => side.transform),
    tracks: metadata,
  })
);
writeFileSync(
  `${directory}/review/runtime-hands.bin`,
  new Uint8Array(new Float32Array(samples).buffer)
);
console.log(
  `MCX runtime review: ${metadata.length} tracks; ${metadata.reduce((n, t): number => n + t.times.length, 0)} poses at 120 Hz; ${points.length * 2} skin references per pose`
);
