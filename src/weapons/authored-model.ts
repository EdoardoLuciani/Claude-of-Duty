import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { hasOwn } from '../core/guards.ts';
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
 * three infers a clip's duration from its last key. gltfpack 1.3 with `-af 0` reduces a
 * wholly constant clip to one key at t=0, so a still Idle loads as 0 s. Restore only that
 * collapsed hold; every other clip must keep its authored length, so lost or drifted
 * animation fails at load instead of playing wrong (or dividing by zero).
 */
export function applyAuthoredDuration(
  clip: THREE.AnimationClip,
  authored: AuthoredClips,
  rigName: string
): void {
  const expected = hasOwn(authored, clip.name) ? authored[clip.name].duration : 0;
  if (!(expected > 0)) throw new Error(`[${rigName}] no authored duration for ${clip.name}`);
  if (
    clip.name === 'Idle' &&
    clip.tracks.length > 0 &&
    clip.tracks.every((track): boolean => track.times.length === 1 && track.times[0] === 0)
  )
    clip.duration = expected;
  // Key times are float32: allow one float32 step of rounding (it grows with the length),
  // never less than 1e-6. The inverted comparison also rejects NaN.
  else if (!(Math.abs(clip.duration - expected) <= Math.max(1e-6, expected * 2 ** -23)))
    throw new Error(`[${rigName}] ${clip.name} lasts ${clip.duration} s, authored ${expected} s`);
}

export function authoredModel(
  gltf: GLTF,
  rigName: string,
  required: readonly string[],
  authored: AuthoredClips,
  scene: THREE.Object3D = gltf.scene
): {
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  point: (name: string) => [number, number, number];
} {
  scene.updateMatrixWorld(true);
  const root = requiredNode(scene, rigName);
  const animations = required.map((name): THREE.AnimationClip => {
    const clip = gltf.animations.find((clip): boolean => clip.name === name);
    if (!clip) throw new Error(`[${rigName}] missing ${name} clip`);
    applyAuthoredDuration(clip, authored, rigName);
    return clip;
  });
  const point = (name: string): [number, number, number] => {
    const p = requiredNode(root, name).getWorldPosition(new THREE.Vector3());
    return [p.x, p.y, p.z];
  };
  return { root, animations, point };
}

/** Common adapter product; each weapon retains its exact nodes and hand poses. */
export interface AuthoredModelData<
  Id extends WeaponId,
  Nodes extends AuthoredNodes,
> extends WeaponSceneMaterials {
  id: Id;
  scene: THREE.Group;
  root: THREE.Object3D;
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
  gripR: { pos: number[]; finger: number[]; back: number[] };
  gripL: { pos: number[]; finger: number[]; back: number[] };
  magSeat: { pos: number[]; rot: number[] };
}
