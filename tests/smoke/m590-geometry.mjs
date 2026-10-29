import assert from 'node:assert/strict';

import * as THREE from 'three';

export const M590_FINISHES = [
  ['01', [0.027, 0.031, 0.035], 1, 0.72],
  ['02', [0.026, 0.031, 0.035], 0, 0.79],
  ['03', [0.016, 0.02, 0.024], 0, 0.91],
  ['04', [0.16, 0.18, 0.2], 1, 0.48],
  ['05', [0.48, 0.29, 0.09], 1, 0.36],
  ['06', [0.28, 0.032, 0.019], 0, 0.62],
  ['07', [0.022, 0.024, 0.027], 1, 0.8],
];

export function finishIndex(colors, vertex) {
  const index = M590_FINISHES.findIndex(([, expected]) =>
    expected.every((value, axis) => Math.abs(colors.getComponent(vertex, axis) - value) < 0.00002)
  );
  assert(index >= 0, 'actual per-corner linear finish colour must be preserved');
  return index;
}

// Test-only part-local views of the real rigid skin, not authoring proxies.
// Split real triangles by their encoded colour finish, rather than obsolete
// primitive material names, so all material-specific seam/raycast gates survive.
export function mechanicalPartViews(scene) {
  scene.updateMatrixWorld(true);
  const views = new Map();
  scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const geometry = mesh.geometry,
      indices = geometry.index,
      joints = geometry.attributes.skinIndex,
      weights = geometry.attributes.skinWeight,
      colors = geometry.attributes.color;
    for (let boneIndex = 0; boneIndex < mesh.skeleton.bones.length; boneIndex++) {
      const bone = mesh.skeleton.bones[boneIndex],
        part = scene.getObjectByName(bone.name.replace('MECH_', ''));
      assert(part, bone.name);
      const finishes = new Map();
      for (let i = 0; i < indices.count; i += 3) {
        const triangle = [0, 1, 2].map((k) => indices.getX(i + k));
        if (joints.getX(triangle[0]) !== boneIndex) continue;
        for (const vertex of triangle) {
          assert.equal(joints.getX(vertex), boneIndex, 'triangle must be rigid');
          assert.equal(weights.getX(vertex), 1);
          assert.equal(weights.getY(vertex) + weights.getZ(vertex) + weights.getW(vertex), 0);
        }
        const finish = finishIndex(colors, triangle[0]);
        for (const vertex of triangle) assert.equal(finishIndex(colors, vertex), finish);
        const selected = finishes.get(finish) ?? [];
        selected.push(...triangle);
        finishes.set(finish, selected);
      }
      for (const [finish, selected] of finishes) {
        const local = part.matrixWorld.clone().invert().multiply(mesh.matrixWorld),
          positions = new Float32Array(geometry.attributes.position.count * 3),
          point = new THREE.Vector3();
        for (const vertex of new Set(selected)) {
          mesh
            .getVertexPosition(vertex, point)
            .applyMatrix4(local)
            .toArray(positions, vertex * 3);
        }
        const viewGeometry = new THREE.BufferGeometry();
        viewGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        viewGeometry.setIndex(selected);
        const material = mesh.material.clone();
        material.name = M590_FINISHES[finish][0] + ' | encoded finish';
        const view = new THREE.Mesh(viewGeometry, material);
        view.matrixAutoUpdate = false;
        view.matrixWorld.copy(part.matrixWorld);
        const list = views.get(part) ?? [];
        list.push(view);
        views.set(part, list);
      }
    }
  });
  return (part, callback) => {
    if (views.has(part)) {
      for (const mesh of views.get(part)) {
        mesh.matrixWorld.copy(part.matrixWorld);
        callback(mesh);
      }
    } else part.traverse(callback);
  };
}
