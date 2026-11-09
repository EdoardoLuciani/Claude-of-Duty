import * as THREE from 'three';

import type { Assembler } from './builder.ts';
import type { TraversableOpening } from './buildings.ts';
import { PLACEMENT_ROWS } from './level/placements/index.ts';
import type { InstanceMasks, RectXZ } from './util.ts';

type Vec3 = [number, number, number];
export interface Placement {
  id: string;
  prototype: string;
  position: Vec3;
  rotationDeg: Vec3;
  scale: Vec3;
  masks?: InstanceMasks;
}
export interface ClearanceBox extends RectXZ {
  y0?: number;
  y1?: number;
}

/** Authored row: [prototype, id, position, rotationDeg, scale, masks?]. An id without
 * a `/` is shorthand for `prototype/id`; a scalar scale is uniform. */
export type PlacementRow = [string, string, Vec3, Vec3, number | Vec3, InstanceMasks?];

const PLACEMENTS = PLACEMENT_ROWS.map(
  ([prototype, id, position, rotationDeg, scale, masks]): Placement => ({
    id: id.includes('/') ? id : `${prototype}/${id}`,
    prototype,
    position,
    rotationDeg,
    scale: typeof scale === 'number' ? [scale, scale, scale] : scale,
    ...(masks ? { masks } : {}),
  })
);
// Row shapes are type-checked; identity is the one invariant types cannot express.
const ids = new Set<string>();
for (const { id } of PLACEMENTS) {
  if (ids.has(id)) throw new Error(`[world] duplicate placement id ${id}`);
  ids.add(id);
}

const position = new THREE.Vector3();
const rotation = new THREE.Euler();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const levelPosition = new THREE.Vector3();
const inverse = new THREE.Matrix4();

function inClearance(
  point: THREE.Vector3Like,
  clearance: Pick<TraversableOpening, 'from' | 'to'>
): boolean {
  const ax = clearance.from[0];
  const az = clearance.from[2];
  const bx = clearance.to[0];
  const bz = clearance.to[2];
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const along =
    lengthSq > 0
      ? Math.max(-0.2, Math.min(1.2, ((point.x - ax) * dx + (point.z - az) * dz) / lengthSq))
      : 0;
  const px = ax + dx * along;
  const pz = az + dz * along;
  return Math.hypot(point.x - px, point.z - pz) < 1.25;
}

export function placeBaked(A: Assembler): void {
  for (const placement of PLACEMENTS) {
    if (!A.has(placement.prototype)) {
      throw new Error(
        `[world] ${placement.id} references unknown prototype ${placement.prototype}`
      );
    }
    const degrees = placement.rotationDeg;
    position.fromArray(placement.position);
    rotation.set(
      THREE.MathUtils.degToRad(degrees[0]),
      THREE.MathUtils.degToRad(degrees[1]),
      THREE.MathUtils.degToRad(degrees[2])
    );
    quaternion.setFromEuler(rotation);
    scale.fromArray(placement.scale);
    matrix.compose(position, quaternion, scale);
    A.place(placement.prototype, matrix, placement.masks ?? null);
  }
}

const DOORWAY_CLUTTER = new Set([
  'barrel_blue',
  'barrel_rust',
  'barrel_wood',
  'bottle',
  'box_card_a',
  'box_card_b',
  'brick_a',
  'brick_b',
  'bucket',
  'can',
  'chair',
  'cinder',
  'crate_a',
  'crate_b',
  'crate_c',
  'crate_flat',
  'dust_skirt',
  'gas_bottle',
  'jerry_can',
  'litter',
  'pallet',
  'plank_a',
  'plank_b',
  'produce',
  'rebar',
  'rock_a',
  'rock_b',
  'sack',
  'sandbag_a',
  'sandbag_b',
  'sandbag_c',
  'shrub',
  'slab_shard',
  'stool',
  'tray',
  'tyre',
  'tyre_small',
  'weeds',
]);

/** Remove low, non-structural clutter from every authored traversal sweep. */
export function clearDoorwayClutter(A: Assembler, clearances: TraversableOpening[]): void {
  inverse.copy(A.xform).invert();
  let removed = 0;
  for (const [id, prototype] of A._protos) {
    if (!DOORWAY_CLUTTER.has(id)) continue;
    const matrices = [];
    const masks = [];
    for (let i = 0; i < prototype.matrices.length; i++) {
      levelPosition.setFromMatrixPosition(prototype.matrices[i]).applyMatrix4(inverse);
      if (
        levelPosition.y < 2.3 &&
        clearances.some((clearance): boolean => inClearance(levelPosition, clearance))
      ) {
        removed++;
        continue;
      }
      matrices.push(prototype.matrices[i]);
      masks.push(prototype.masks[i]);
    }
    prototype.matrices = matrices;
    prototype.masks = masks;
  }
  A.culledDoorwayClutter = removed;
}

const VOLUME_CLUTTER = new Set([
  ...DOORWAY_CLUTTER,
  'ac_unit',
  'table_small',
  'cabinet',
  'shelf',
  'mattress',
  'jersey',
  'table',
]);

export function clearVolumeClutter(A: Assembler, boxes: ClearanceBox[]): void {
  if (!boxes?.length) return;
  inverse.copy(A.xform).invert();
  let removed = 0;
  for (const [id, prototype] of A._protos) {
    if (!VOLUME_CLUTTER.has(id)) continue;
    const matrices = [];
    const masks = [];
    for (let i = 0; i < prototype.matrices.length; i++) {
      levelPosition.setFromMatrixPosition(prototype.matrices[i]).applyMatrix4(inverse);
      const inside = boxes.some(
        (box): boolean =>
          levelPosition.x >= box.x0 &&
          levelPosition.x <= box.x1 &&
          levelPosition.z >= box.z0 &&
          levelPosition.z <= box.z1 &&
          levelPosition.y >= (box.y0 ?? -1) &&
          levelPosition.y <= (box.y1 ?? 12)
      );
      if (inside) {
        removed++;
        continue;
      }
      matrices.push(prototype.matrices[i]);
      masks.push(prototype.masks[i]);
    }
    prototype.matrices = matrices;
    prototype.masks = masks;
  }
  A.culledVolumeClutter = removed;
}
