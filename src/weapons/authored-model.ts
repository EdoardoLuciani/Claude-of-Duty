import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { hasOwn } from '../core/guards.ts';
import { isMesh, isSkinnedMesh } from '../core/three-guards.ts';
import type { WeaponSceneMaterials } from './asset-material.ts';
import type { WeaponId } from './defs.ts';

/** Required authored nodes, never a procedural fallback. */
export function requiredNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`[${root.name}] missing ${name}`);
  return node;
}

/** Authored clip lengths from a weapon manifest; glTF itself stores none. */
type AuthoredClips = Readonly<Record<string, { readonly duration: number }>>;

/**
 * three infers a clip's duration from its last key, which must match the authored length
 * so lost or drifted animation fails at load instead of playing wrong. Idle is a single
 * pose authored as 0 s.
 */
export function checkAuthoredDuration(
  clip: THREE.AnimationClip,
  authored: AuthoredClips,
  rigName: string
): void {
  const expected = hasOwn(authored, clip.name) ? authored[clip.name]?.duration : undefined;
  // Only the Idle pose may be 0 s; a 0 s gesture would load as a clip that never plays.
  if (expected === undefined || !(expected > 0 || (expected === 0 && clip.name === 'Idle')))
    throw new Error(`[${rigName}] no authored duration for ${clip.name}`);
  if (clip.tracks.length === 0) throw new Error(`[${rigName}] ${clip.name} has no tracks`);
  // Key times are float32: allow one float32 step of rounding (it grows with the length),
  // never less than 1e-6. The inverted comparison also rejects NaN.
  if (!(Math.abs(clip.duration - expected) <= Math.max(1e-6, expected * 2 ** -23)))
    throw new Error(`[${rigName}] ${clip.name} lasts ${clip.duration} s, authored ${expected} s`);
}

/**
 * Rebase a source +X-forward/+Y-up GLB into game -Z forward once on load: nodes,
 * geometry, skins and curves. `origin` is the source origin's game-space position.
 * Attachment mounts keep their canonical game-basis locals.
 */
export function rebaseNativeWeapon(
  gltf: GLTF,
  origin: readonly [number, number, number] = [0, 0, 0]
): void {
  const scene = gltf.scene;
  const basis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const inverse = basis.clone().invert(),
    offset = new THREE.Vector3(...origin),
    roots = new Set(scene.children),
    geometries = new Set<THREE.BufferGeometry>(),
    skeletons = new Set<THREE.Skeleton>();
  // Skin matrices follow the same change of frame: bone/mesh world W becomes
  // frame * W * rotation^-1, so bind matrices and bone inverses are conjugated too.
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(basis),
    frame = new THREE.Matrix4().compose(offset, basis, new THREE.Vector3(1, 1, 1)),
    rotationInverse = rotation.clone().invert(),
    frameInverse = frame.clone().invert();
  scene.traverse((o): void => {
    o.position.applyQuaternion(basis);
    if (roots.has(o)) o.position.add(offset);
    o.quaternion.premultiply(basis).multiply(inverse);
    const x = o.scale.x;
    o.scale.x = o.scale.z;
    o.scale.z = x;
    if (isMesh(o) && !geometries.has(o.geometry)) {
      o.geometry.applyQuaternion(basis);
      geometries.add(o.geometry);
    }
    if (isSkinnedMesh(o)) {
      o.bindMatrix.premultiply(frame).multiply(rotationInverse);
      o.bindMatrixInverse.copy(o.bindMatrix).invert();
      if (!skeletons.has(o.skeleton))
        for (const bone of o.skeleton.boneInverses)
          bone.premultiply(rotation).multiply(frameInverse);
      skeletons.add(o.skeleton);
    }
    o.updateMatrix();
  });
  // Geometry/control locals were rebased above; attachment locals are shared
  // canonical assets, not weapon geometry. Preserve that frame at the slot boundary.
  for (const name of ['MOUNT_optic', 'MOUNT_muzzle', 'MOUNT_rail']) {
    const mount = scene.getObjectByName(name);
    if (mount) {
      mount.quaternion.multiply(basis);
      mount.updateMatrix();
    }
  }
  const rootNames = new Set([...roots].map((o): string => o.name));
  for (const clip of gltf.animations)
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
      if (propertyName !== 'position' && propertyName !== 'quaternion' && propertyName !== 'scale')
        continue;
      // GLTFLoader shares accessor arrays across clips/constant controls. Never
      // transform that shared storage repeatedly (it rotates idle hands twice).
      const v = track.values.slice(),
        width = track.getValueSize();
      track.values = v;
      const root = propertyName === 'position' && rootNames.has(nodeName);
      for (let i = 0; i < v.length; i += width) {
        const x = v[i];
        v[i] = v[i + 2];
        v[i + 2] = propertyName === 'scale' ? x : -x;
        if (root) {
          v[i] += offset.x;
          v[i + 1] += offset.y;
          v[i + 2] += offset.z;
        }
      }
    }
}

export function authoredModel(
  gltf: GLTF,
  rigName: string,
  required: readonly string[],
  authored: AuthoredClips
): {
  root: THREE.Object3D;
  opticMountRest: THREE.Matrix4 | null;
  animations: THREE.AnimationClip[];
  point: (name: string) => [number, number, number];
} {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const root = requiredNode(scene, rigName);
  // Capture the optic mount before any clip poses a slide, cover or bolt under it,
  // in the same weapon frame as point().
  const opticMountRest = root.getObjectByName('MOUNT_optic')?.matrixWorld.clone() ?? null;
  const animations = required.map((name): THREE.AnimationClip => {
    const clip = gltf.animations.find((clip): boolean => clip.name === name);
    if (!clip) throw new Error(`[${rigName}] missing ${name} clip`);
    checkAuthoredDuration(clip, authored, rigName);
    return clip;
  });
  const point = (name: string): [number, number, number] => {
    const p = requiredNode(root, name).getWorldPosition(new THREE.Vector3());
    return [p.x, p.y, p.z];
  };
  return { root, opticMountRest, animations, point };
}

/** Common adapter product; each weapon retains its exact nodes and hand poses. */
export interface AuthoredModelData<
  Id extends WeaponId,
  Nodes extends AuthoredNodes,
> extends WeaponSceneMaterials {
  id: Id;
  scene: THREE.Group;
  root: THREE.Object3D;
  /** Weapon-frame `MOUNT_optic` at load (rest pose), like `point()`; null without a mount. */
  readonly opticMountRest: THREE.Matrix4 | null;
  animations: THREE.AnimationClip[];
  nodes: Nodes;
  shell: { caseLen: number; rimR: number };
  magSize: { len: number };
}

export interface AuthoredNodes {
  muzzle: [number, number, number];
  eject: [number, number, number];
  sight: [number, number, number];
  ejectDir: number[];
  magSeat: { pos: number[]; rot: number[] };
}
