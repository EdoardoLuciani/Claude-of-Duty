import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { isTexture } from '../core/three-guards.ts';
import { createArmBlood, addArmBloodCoordinates } from './arm-blood.ts';
import { createArmSurfaceMaterial } from './arm-surfaces.ts';

function isCloseableImage(value: unknown): value is ImageBitmap {
  return (
    typeof value === 'object' &&
    value !== null &&
    'close' in value &&
    typeof value.close === 'function'
  );
}
type ArmSkinnedMesh = THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
export interface ArmAsset {
  meshes: ArmSkinnedMesh[];
  blood: ReturnType<typeof createArmBlood>;
  dispose(): void;
}
export interface ArmRig {
  controls: Record<string, THREE.Bone>;
  pose: string;
  scale: number;
  side: number;
  upperPivot: THREE.Object3D;
  forePivot: THREE.Object3D;
  hand: THREE.Object3D;
  fingers: { joints: THREE.Object3D[] }[];
  thumb: { root: THREE.Object3D; joints: THREE.Object3D[] };
  updateFlex(): void;
  root: THREE.Object3D;
  skeleton: THREE.Skeleton | null;
  skins: THREE.SkinnedMesh[];
  setPose(pose: unknown): void;
}

/** Owned by a Viewmodel, never a global cache: disposal/restart stays local. */
export async function loadArmAsset(): Promise<ArmAsset> {
  const gltf = await new GLTFLoader().loadAsync(
    `${(import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL}models/player/arms.glb`
  );
  gltf.scene.updateMatrixWorld(true);
  const meshes: ArmSkinnedMesh[] = [];
  const blood = createArmBlood();
  gltf.scene.traverse((object): void => {
    if (object instanceof THREE.SkinnedMesh) meshes.push(object as ArmSkinnedMesh);
  });
  if (!meshes.length) throw new Error('Player arms: no deformation meshes in arms.glb');
  const names = meshes[0].skeleton.bones.map((bone): string => bone.name);
  const sources: THREE.MeshPhysicalMaterial[] = [];
  const pieces: THREE.BufferGeometry[] = [];
  for (const mesh of meshes) {
    if (
      mesh.skeleton.bones.some((bone, i): boolean => bone.name !== names[i]) ||
      mesh.skeleton.bones.length !== names.length
    )
      throw new Error('Player arms: inconsistent exported bone order');
    const index = mesh.geometry.index;
    if (!index) throw new Error('Player arms: expected indexed Blender geometry');
    if (!mesh.geometry.getAttribute('skinWeight') || !mesh.geometry.getAttribute('skinIndex'))
      throw new Error(`Player arms: missing skin data on ${mesh.name}`);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Match native submissions: arrays select indexed groups; a single material
    // ignores groups. Both are clipped by the geometry's authored draw range.
    const groups = Array.isArray(mesh.material)
      ? mesh.geometry.groups
      : [{ start: 0, count: index.count, materialIndex: 0 }];
    const range = mesh.geometry.drawRange;
    for (const group of groups) {
      const source = materials[group.materialIndex ?? 0];
      const start = Math.max(0, range.start, group.start);
      const end = Math.min(index.count, range.start + range.count, group.start + group.count);
      if (!source?.visible || end <= start) continue;
      const surface = sources.length;
      if (!(source instanceof THREE.MeshPhysicalMaterial))
        throw new Error('Player arms: expected physical material');
      sources.push(source);
      const geometry = mesh.geometry.clone();
      geometry.setIndex(new THREE.BufferAttribute(index.array.slice(start, end), 1));
      geometry.clearGroups();
      geometry.setDrawRange(0, Infinity);
      geometry.applyMatrix4(mesh.matrixWorld);
      const count = geometry.getAttribute('position').count;
      geometry.setAttribute(
        'armSurface',
        new THREE.Float32BufferAttribute(new Float32Array(count).fill(surface), 1)
      );
      pieces.push(geometry);
    }
  }
  if (!pieces.length) throw new Error('Player arms: no rendered deformation surfaces');
  const material = createArmSurfaceMaterial(sources, blood);
  const geometry = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!geometry) throw new Error('Player arms: incompatible deformation geometry');
  const merged = new THREE.SkinnedMesh(geometry, material);
  merged.name = 'Player_arm';
  merged.skeleton = meshes[0].skeleton;
  const skeletons = new Set(meshes.map((mesh): THREE.Skeleton => mesh.skeleton));
  // The merged source retains just one skeleton for bone-name validation. Each
  // gameplay hand still creates its own skeleton and transformed geometry below.
  skeletons.delete(merged.skeleton);
  for (const skeleton of skeletons) skeleton.dispose();
  const textures = new Set<THREE.Texture>();
  const sourceMaterials = new Set(
    meshes.flatMap((mesh): THREE.Material<THREE.MaterialEventMap>[] =>
      Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    )
  );
  for (const source of sourceMaterials) {
    for (const value of Object.values(source)) if (isTexture(value)) textures.add(value);
    source.dispose();
  }
  const images = new Set<ImageBitmap>();
  for (const texture of textures) {
    if (isCloseableImage(texture.source?.data)) images.add(texture.source.data);
    texture.dispose();
  }
  for (const image of images) image.close();
  for (const mesh of meshes) mesh.geometry.dispose();
  meshes.splice(0, meshes.length, merged);
  return {
    meshes,
    blood,
    dispose(): void {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      const skeletons = new Set<THREE.Skeleton>();
      for (const mesh of meshes) {
        geometries.add(mesh.geometry);
        skeletons.add(mesh.skeleton);
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(mat);
          for (const value of Object.values(mat as object)) {
            if (isTexture(value)) textures.add(value);
          }
        }
      }
      blood.texture.dispose();
      for (const g of geometries) g.dispose();
      for (const s of skeletons) s.dispose();
      for (const m of materials) m.dispose();
      const images = new Set<ImageBitmap>();
      for (const t of textures) {
        if (isCloseableImage(t.source?.data)) images.add(t.source.data);
        t.dispose();
      }
      // Texture clones can share decoded ImageBitmaps. GPU disposal does not
      // release them, and each owned bitmap must be closed only once.
      for (const image of images) image.close();
      meshes.length = 0;
    },
  };
}

/** Rebind Blender weights to the gameplay contact rig in its neutral pose. */
export function bindArmAsset(arm: ArmRig, asset: ArmAsset): void {
  const controls = arm.controls;
  const oldPose = arm.pose;
  arm.upperPivot.position.set(0, 0, 0.63 * arm.scale);
  arm.forePivot.position.set(0, 0, 0.3 * arm.scale);
  arm.upperPivot.quaternion.identity();
  arm.forePivot.quaternion.identity();
  arm.hand.position.set(0, 0, 0);
  arm.hand.quaternion.identity();
  for (const f of arm.fingers) for (const j of f.joints) j.rotation.set(0, 0, 0);
  arm.thumb.root.rotation.set(0, -0.95, 0);
  for (const j of arm.thumb.joints) j.rotation.set(0, 0, 0);
  arm.updateFlex();
  arm.root.updateWorldMatrix(true, true);
  // Source vertices are in authoring world space. Bring them into the arm's
  // bind space; reflecting positions also requires reversing triangle winding.
  const transform = new THREE.Matrix4();
  const scale = new THREE.Matrix4().makeScale(
    arm.side < 0 ? arm.scale : -arm.scale,
    arm.scale,
    arm.scale
  );
  const names = asset.meshes[0].skeleton.bones.map((b): string => b.name);
  const bones = names.map((name: string): THREE.Bone<THREE.Object3DEventMap> => {
    const control = controls[name];
    if (!control) throw new Error(`Player arms: unknown Blender bone ${name}`);
    return control;
  });
  const skeleton = new THREE.Skeleton(
    bones,
    bones.map((b): THREE.Matrix4 => b.matrixWorld.clone().invert())
  );
  arm.skeleton = skeleton;
  for (const source of asset.meshes) {
    if (
      source.skeleton.bones.length !== names.length ||
      source.skeleton.bones.some((b, i): boolean => b.name !== names[i])
    ) {
      throw new Error('Player arms: inconsistent exported bone order');
    }
    const geometry = source.geometry.clone();
    addArmBloodCoordinates(geometry, source, arm.side);
    transform.multiplyMatrices(scale, source.matrixWorld);
    geometry.applyMatrix4(transform);
    if (arm.side > 0) {
      const index = geometry.index;
      if (!index) throw new Error('Player arms: expected indexed Blender geometry');
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        index.setX(i, index.getX(i + 2));
        index.setX(i + 2, a);
      }
      // Recompute tangents after reflection rather than retain wrong handedness.
      if (geometry.hasAttribute('tangent')) geometry.deleteAttribute('tangent');
    }
    const mesh = new THREE.SkinnedMesh(geometry, source.material);
    mesh.name = `${arm.root.name}-${source.name}`;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.owNoPrepass = true;
    arm.root.add(mesh);
    mesh.updateWorldMatrix(true, false);
    mesh.bind(skeleton, mesh.matrixWorld);
    arm.skins.push(mesh);
  }
  arm.setPose(oldPose);
}
