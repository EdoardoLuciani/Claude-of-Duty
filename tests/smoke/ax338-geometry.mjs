// Actual ordinary-mesh geometry remains discoverable under its authored control.
import assert from 'node:assert/strict';

import * as THREE from 'three';

export function ax338GeometryControl(mesh) {
  for (let node = mesh.parent; node; node = node.parent)
    if (['receiver', 'handguard', 'stock', 'optic', 'bolt', 'trigger'].includes(node.name))
      return node;
  return null;
}

export function ax338PartTriangles(root, part) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const triangles = [];
  root.traverse((mesh) => {
    if (!mesh.isMesh || ax338GeometryControl(mesh)?.name !== part) return;
    assert(!mesh.isSkinnedMesh, `${part}: ordinary geometry, not a rigid skin`);
    const index = mesh.geometry.index;
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    for (let i = 0; i < index.count; i += 3) {
      const ids = [0, 1, 2].map((k) => index.getX(i + k));
      triangles.push(
        new THREE.Triangle(
          ...ids.map((id) =>
            mesh.getVertexPosition(id, new THREE.Vector3()).applyMatrix4(transform)
          )
        )
      );
    }
  });
  assert(triangles.length > 0, `${part}: actual owned triangles, not an empty named helper`);
  return triangles;
}
