import {
  type Group,
  type Object3D,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Texture,
} from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import { isSingleMaterialMesh, isTexture } from '../core/three-guards.ts';

const URL = 'models/props/intel-case.runtime.glb';

export async function loadIntelScene(): Promise<Group> {
  const model = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(URL);
  return model.scene;
}

function node(parent: Object3D, name: string): Object3D {
  const found = parent.children.find((child): boolean => child.name === name);
  if (!found) throw new Error(`[intel] missing ${name} under ${parent.name}`);
  return found;
}

function mesh(parent: Object3D, name: string): Mesh<BufferGeometry, Material> {
  const object = node(parent, name);
  if (!isSingleMaterialMesh(object)) throw new Error(`[intel] expected mesh ${object.name}`);
  return object;
}

interface IntelKit {
  root: Object3D;
  beacon: MeshBasicNodeMaterial;
  dispose(): void;
}

/** Own one GLB's resources; pooled clones share all geometry and finishes. */
export function makeKit(scene: Group): IntelKit {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  scene.traverse((object): void => {
    if (!isSingleMaterialMesh(object)) return;
    geometries.add(object.geometry);
    materials.add(object.material);
    for (const value of Object.values(object.material)) if (isTexture(value)) textures.add(value);
  });
  const dispose = (): void => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    // GLTFLoader may share an ImageBitmap between multiple texture objects.
    const images = new Set(Array.from(textures, (texture): unknown => texture.image));
    if (typeof ImageBitmap !== 'undefined') {
      for (const image of images) if (image instanceof ImageBitmap) image.close();
    }
    geometries.clear();
    materials.clear();
    textures.clear();
  };
  try {
    const root = node(scene, 'INTEL_CASE');
    const lid = node(root, 'INTEL_HINGE');
    node(root, 'INTEL_SPARK');
    for (const solid of [mesh(root, 'INTEL_BODY'), mesh(lid, 'INTEL_LID')]) {
      solid.castShadow = solid.receiveShadow = true;
    }
    const lens = mesh(lid, 'INTEL_BEACON');
    const leds = mesh(root, 'INTEL_LEDS');
    const beacon = new MeshBasicNodeMaterial({ color: 0xff0802 });
    const status = new MeshBasicNodeMaterial({ color: 0x53ffb1 });
    beacon.name = 'Intel beacon pulse';
    status.name = 'Intel status LEDs';
    materials.add(beacon).add(status);
    lens.material = beacon;
    leds.material = status;
    lens.userData.owNoPrepass = leds.userData.owNoPrepass = true;
    return { root, beacon, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function makeCrate(kit: IntelKit): Object3D & { lid: Object3D; spark: Object3D } {
  const root = kit.root.clone(true);
  const lid = node(root, 'INTEL_HINGE');
  const spark = node(root, 'INTEL_SPARK');
  root.visible = false;
  root.name = 'intel-cache';
  return Object.assign(root, { lid, spark });
}
