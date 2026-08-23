import * as THREE from 'three';
import { SPAWNS } from './config.js';
import { ALLEYS, STREET } from './layout.js';

const point = new THREE.Vector3();

function worldPosition(A, value, yOffset = 0) {
  return point.set(value.x, value.y + yOffset, value.z).applyMatrix4(A.xform).toArray();
}

export function worldMetadata(A, buildings, sourceHash) {
  const matrix = A.xform.clone();
  const bounds = new THREE.Box3(
    new THREE.Vector3(-62, -2, -62),
    new THREE.Vector3(62, 26, 62)
  ).applyMatrix4(matrix);

  const spawns = SPAWNS.map(([x, z, yaw, tag]) => {
    const worldYaw = yaw + A.ry;
    return {
      id: tag.replaceAll(' ', '_'),
      position: new THREE.Vector3(x, 0, z).applyMatrix4(matrix).toArray(),
      forward: [-Math.sin(worldYaw), 0, -Math.cos(worldYaw)],
      yaw: worldYaw,
      tag,
      team: 'any',
    };
  });

  const warm = [1, 0.5271151065826416, 0.1946178376674652];
  const amber = [1, 0.47353148460388184, 0.13013647496700287];
  const lights = A.interiorLights.slice(0, 20).map((entry, index) => ({
    id: `interior_${String(index + 1).padStart(2, '0')}`,
    kind: 'interior',
    position: worldPosition(A, entry),
    color: warm,
    range: 13,
    priority: 2,
    day: 5,
    night: 22,
  }));
  lights.push(...A.lampAnchors.map((entry, index) => ({
    id: `street_${String(index + 1).padStart(2, '0')}`,
    kind: 'street',
    position: worldPosition(A, entry, -0.12),
    color: amber,
    range: 22,
    priority: 3,
    day: 0,
    night: 14,
  })));

  return {
    version: 2,
    coordinateSystem: 'three-y-up-metres',
    sourceHash,
    transform: matrix.toArray(),
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    spawns,
    buildings: buildings.map(({ spec, floorY, roofY, top }) => ({ spec, floorY, roofY, top })),
    volumes: [],
    lights,
    query: { street: STREET, alleys: ALLEYS },
  };
}
