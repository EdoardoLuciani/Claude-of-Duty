// Actual export geometry remains discoverable after cross-parent draw merging.
import assert from 'node:assert/strict';

import * as THREE from 'three';

export function ax338PartTriangles(root, part) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const triangles = [];
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const { skinIndex } = mesh.geometry.attributes;
    const index = mesh.geometry.index;
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    for (let i = 0; i < index.count; i += 3) {
      const ids = [0, 1, 2].map((k) => index.getX(i + k));
      if (!ids.every((id) => mesh.skeleton.bones[skinIndex.getX(id)].name === `MECH_${part}`))
        continue;
      triangles.push(
        new THREE.Triangle(
          ...ids.map((id) =>
            mesh.getVertexPosition(id, new THREE.Vector3()).applyMatrix4(transform)
          )
        )
      );
    }
  });
  assert(triangles.length > 0, `${part}: actual bound triangles, not an empty named helper`);
  return triangles;
}
