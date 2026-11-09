/** Lossless final encoding of new Blender mesh data; never repairs an existing GLB. */
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { RIG } from '../../../src/ai/rig.ts';
import { MATERIAL_SLOTS, VARIANTS } from '../../../src/ai/soldier.ts';
import { hasOwn, isRecord } from '../../../src/core/guards.ts';
import {
  parseSoldierMetadata,
  type SoldierMetadata,
  type SoldierWeapon,
} from '../../../src/core/model-metadata.ts';

const ATTRIBUTES = { position: 3, normal: 3, uv: 2, color: 3, skinIndex: 4, skinWeight: 4 };
export const SOCKETS: Array<keyof SoldierWeapon> = [
  'muzzle',
  'foregrip',
  'magBottom',
  'ejection',
  'stockTop',
];
type Mesh = Record<keyof typeof ATTRIBUTES, number[]> & {
  index: number[];
  groups: Array<Required<THREE.BufferGeometry['groups'][number]>>;
};
interface MeshPayload {
  version: number;
  seed: number;
  mesh: Mesh;
}
function numbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v: unknown): boolean => typeof v === 'number');
}
function validateMeshPayload(value: unknown): asserts value is MeshPayload {
  assert(isRecord(value) && isRecord(value.mesh), 'soldier mesh object');
  assert(typeof value.version === 'number', 'soldier mesh version');
  assert(typeof value.seed === 'number', 'u32 authoring seed');
  const mesh = value.mesh;
  for (const name of Object.keys(ATTRIBUTES)) assert(numbers(mesh[name]), `${name} number array`);
  assert(numbers(mesh.index), 'triangle index array');
  assert(
    Array.isArray(mesh.groups) &&
      mesh.groups.every(
        (group: unknown): boolean =>
          isRecord(group) &&
          typeof group.start === 'number' &&
          typeof group.count === 'number' &&
          typeof group.materialIndex === 'number'
      ),
    'surface group fields'
  );
}

export function validateMetadata(value: unknown, name?: string): asserts value is SoldierMetadata {
  assert(isRecord(value), 'soldier metadata object');
  const meta = parseSoldierMetadata(value);
  const key = meta.name;
  assert(hasOwn(VARIANTS, key) && (name === undefined || key === name), 'soldier metadata name');
  assert.deepEqual(meta.slots, MATERIAL_SLOTS, 'canonical material slots');
  assert.deepEqual(value.variant, VARIANTS[key], 'stale variant reference');
  for (const key of ['vertices', 'triangles'] as const) {
    assert(Number.isSafeInteger(meta.stats[key]) && meta.stats[key] > 0, `positive ${key}`);
  }
  assert.deepEqual(Object.keys(meta.weapon).sort(), [...SOCKETS].sort(), 'five weapon sockets');
  for (const key of SOCKETS) {
    assert(Array.isArray(meta.weapon[key]) && meta.weapon[key].length === 3, `weapon ${key}`);
    for (const value of meta.weapon[key]) {
      assert(
        Number.isFinite(value) && Number.isFinite(Math.fround(value)),
        `weapon ${key} finite float32`
      );
    }
  }
}

export function validateMesh(data: unknown): asserts data is SoldierMetadata & MeshPayload {
  validateMetadata(data);
  validateMeshPayload(data);
  assert.equal(data.version, 1, 'soldier mesh version');
  assert.equal(RIG.count, 25, 'canonical rig count');
  assert.equal(RIG.names.length, 25, 'canonical rig names');
  assert(Object.hasOwn(VARIANTS, data.name), 'unknown soldier variant');
  assert(
    Number.isInteger(data.seed) && data.seed >= 0 && data.seed <= 0xffffffff,
    'u32 authoring seed'
  );
  const mesh = data.mesh;
  const vertices = mesh.position.length / 3;
  assert(Number.isSafeInteger(vertices) && vertices > 0 && vertices <= 0xffffffff, 'vertex count');
  for (const name of Object.keys(ATTRIBUTES)) {
    assert(hasOwn(ATTRIBUTES, name));
    const size = ATTRIBUTES[name];
    assert(mesh[name].length === vertices * size, `${name} count`);
    for (const value of mesh[name]) {
      assert(
        Number.isFinite(value) && Number.isFinite(Math.fround(value)),
        `${name} finite float32`
      );
    }
  }
  assert(
    mesh.color.every((v): boolean => v >= 0 && v <= 1),
    'linear RGB range'
  );
  assert(
    mesh.skinIndex.every((v): boolean => Number.isInteger(v) && v >= 0 && v < RIG.count),
    'joint range'
  );
  assert(
    mesh.skinWeight.every((v): boolean => v >= 0 && v <= 1),
    'weight range'
  );
  for (let v = 0; v < vertices; v++) {
    const i = v * 4,
      n = v * 3,
      weights = mesh.skinWeight,
      normal = mesh.normal;
    // Four quantized/float32 influences; no silent normalization of broken input.
    assert(
      Math.abs(weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] - 1) < 1e-5,
      'weight sum'
    );
    assert(Math.abs(Math.hypot(normal[n], normal[n + 1], normal[n + 2]) - 1) < 1e-4, 'unit normal');
    const joints = new Set<number>();
    for (let j = 0; j < 4; j++) {
      if (j) assert(weights[i + j] <= weights[i + j - 1], 'top-four weight order');
      if (weights[i + j] > 0) {
        assert(!joints.has(mesh.skinIndex[i + j]), 'unique weighted joints');
        joints.add(mesh.skinIndex[i + j]);
      }
    }
  }
  assert(mesh.index.length > 0 && mesh.index.length % 3 === 0, 'triangle indices');
  assert(
    mesh.index.every((v): boolean => Number.isInteger(v) && v >= 0 && v < vertices),
    'index range'
  );
  assert.equal(mesh.groups.length, MATERIAL_SLOTS.length, 'surface count');
  const roles = new Int16Array(vertices).fill(-1);
  let end = 0;
  mesh.groups.forEach((group, slot): void => {
    assert.equal(group.materialIndex, slot, 'surface order');
    assert.equal(group.start, end, 'contiguous groups');
    assert(
      Number.isInteger(group.count) && group.count > 0 && group.count % 3 === 0,
      'group count'
    );
    end += group.count;
    assert(end <= mesh.index.length, 'group range');
    for (let j = group.start; j < end; j++) {
      const vertex = mesh.index[j];
      assert(roles[vertex] === -1 || roles[vertex] === slot, 'disjoint surface vertices');
      roles[vertex] = slot;
    }
  });
  assert.equal(end, mesh.index.length, 'complete groups');
  assert(
    roles.every((v): boolean => v >= 0),
    'all vertices referenced'
  );
  assert.deepEqual(data.stats, { vertices, triangles: mesh.index.length / 3 }, 'mesh statistics');
}

export async function cookSoldier(data: unknown): Promise<{ glb: Buffer; meta: SoldierMetadata }> {
  validateMesh(data);
  assert(hasOwn(VARIANTS, data.name));
  const variant = VARIANTS[data.name];
  assert(typeof variant.faceWrap === 'boolean' && typeof variant.beard === 'boolean');
  const geometry = new THREE.BufferGeometry();
  const materials: THREE.MeshStandardMaterial[] = [];
  let skeleton: THREE.Skeleton | undefined;
  try {
    for (const name of Object.keys(ATTRIBUTES)) {
      assert(hasOwn(ATTRIBUTES, name));
      const values =
        name === 'skinIndex' ? new Uint16Array(data.mesh[name]) : new Float32Array(data.mesh[name]);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, ATTRIBUTES[name]));
    }
    const indices =
      data.stats.vertices > 65535
        ? new Uint32Array(data.mesh.index)
        : new Uint16Array(data.mesh.index);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    for (const group of data.mesh.groups)
      geometry.addGroup(group.start, group.count, group.materialIndex);
    const rig = RIG.createSkeleton();
    skeleton = rig.skeleton;
    const rootBone = rig.root;
    for (const name of data.slots) materials.push(new THREE.MeshStandardMaterial({ name }));
    const scene = new THREE.Scene(),
      root = new THREE.Group();
    root.name = `${data.name}-model`;
    scene.add(root);
    root.add(rootBone);
    const mesh = new THREE.SkinnedMesh(geometry, materials);
    mesh.name = `${data.name}-body`;
    mesh.bind(skeleton);
    root.add(mesh);
    scene.updateMatrixWorld(true);
    // Keep imports/reader-only calls free of the exporter's FileReader adapter.
    const { exportGlb } = await import('../../lib/export-glb.ts');
    return {
      glb: await exportGlb(scene),
      meta: {
        name: data.name,
        slots: data.slots,
        weapon: {
          muzzle: data.weapon.muzzle,
          foregrip: data.weapon.foregrip,
          magBottom: data.weapon.magBottom,
          ejection: data.weapon.ejection,
          stockTop: data.weapon.stockTop,
        },
        stats: data.stats,
        variant: { ...variant, faceWrap: variant.faceWrap, beard: variant.beard },
      },
    };
  } finally {
    geometry.dispose();
    for (const material of materials) material.dispose();
    skeleton?.dispose();
  }
}
