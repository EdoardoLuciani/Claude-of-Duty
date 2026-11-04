/** Lossless final encoding of new Blender mesh data; never repairs an existing GLB. */
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

import { RIG } from '../../../src/ai/rig.ts';
import { MATERIAL_SLOTS, VARIANTS } from '../../../src/ai/soldier.ts';

const ATTRIBUTES = { position: 3, normal: 3, uv: 2, color: 3, skinIndex: 4, skinWeight: 4 };
export const SOCKETS = ['muzzle', 'foregrip', 'magBottom', 'ejection', 'stockTop'];

export function validateMetadata(meta, name = meta.name) {
  assert(Object.hasOwn(VARIANTS, name) && meta.name === name, 'soldier metadata name');
  assert.deepEqual(meta.slots, MATERIAL_SLOTS, 'canonical material slots');
  assert.deepEqual(meta.variant, VARIANTS[name], 'stale variant reference');
  for (const key of ['vertices', 'triangles']) {
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

export function validateMesh(data) {
  assert.equal(data.version, 1, 'soldier mesh version');
  assert.equal(RIG.count, 25, 'canonical rig count');
  assert.equal(RIG.names.length, 25, 'canonical rig names');
  validateMetadata(data);
  assert(Object.hasOwn(VARIANTS, data.name), 'unknown soldier variant');
  assert(
    Number.isInteger(data.seed) && data.seed >= 0 && data.seed <= 0xffffffff,
    'u32 authoring seed'
  );
  const mesh = data.mesh;
  const vertices = mesh.position.length / 3;
  assert(Number.isSafeInteger(vertices) && vertices > 0 && vertices <= 0xffffffff, 'vertex count');
  for (const [name, size] of Object.entries(ATTRIBUTES)) {
    assert(Array.isArray(mesh[name]) && mesh[name].length === vertices * size, `${name} count`);
    for (const value of mesh[name]) {
      assert(
        Number.isFinite(value) && Number.isFinite(Math.fround(value)),
        `${name} finite float32`
      );
    }
  }
  assert(
    mesh.color.every((v) => v >= 0 && v <= 1),
    'linear RGB range'
  );
  assert(
    mesh.skinIndex.every((v) => Number.isInteger(v) && v >= 0 && v < RIG.count),
    'joint range'
  );
  assert(
    mesh.skinWeight.every((v) => v >= 0 && v <= 1),
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
    const joints = new Set();
    for (let j = 0; j < 4; j++) {
      if (j) assert(weights[i + j] <= weights[i + j - 1], 'top-four weight order');
      if (weights[i + j] > 0) {
        assert(!joints.has(mesh.skinIndex[i + j]), 'unique weighted joints');
        joints.add(mesh.skinIndex[i + j]);
      }
    }
  }
  assert(
    Array.isArray(mesh.index) && mesh.index.length > 0 && mesh.index.length % 3 === 0,
    'triangle indices'
  );
  assert(
    mesh.index.every((v) => Number.isInteger(v) && v >= 0 && v < vertices),
    'index range'
  );
  assert.equal(mesh.groups.length, MATERIAL_SLOTS.length, 'surface count');
  const roles = new Int16Array(vertices).fill(-1);
  let end = 0;
  mesh.groups.forEach((group, slot) => {
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
    roles.every((v) => v >= 0),
    'all vertices referenced'
  );
  assert.deepEqual(data.stats, { vertices, triangles: mesh.index.length / 3 }, 'mesh statistics');
}

export async function cookSoldier(data) {
  validateMesh(data);
  // Same Blob shim used by the existing model exporter. No browser or Blender
  // process participates in GLB encoding, and imports have no scene side effects.
  if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
      readAsArrayBuffer(blob) {
        blob.arrayBuffer().then((buffer) => {
          this.result = buffer;
          queueMicrotask(() => this.onloadend?.());
        });
      }
    };
  }
  const geometry = new THREE.BufferGeometry();
  const materials = [];
  let skeleton;
  try {
    for (const [name, size] of Object.entries(ATTRIBUTES)) {
      const values =
        name === 'skinIndex' ? new Uint16Array(data.mesh[name]) : new Float32Array(data.mesh[name]);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
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
    return {
      glb: Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true })),
      meta: {
        name: data.name,
        slots: data.slots,
        weapon: Object.fromEntries(SOCKETS.map((key) => [key, data.weapon[key]])),
        stats: data.stats,
        variant: VARIANTS[data.name],
      },
    };
  } finally {
    geometry.dispose();
    for (const material of materials) material.dispose();
    skeleton?.dispose();
  }
}
