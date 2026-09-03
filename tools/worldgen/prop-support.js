import * as THREE from 'three';
import { SupportIndex } from './support-index.js';

const INSTANCE_SUPPORTERS = new Set([
  'crate_a', 'crate_b', 'crate_c', 'crate_flat', 'box_card_a', 'box_card_b',
  'barrel_rust', 'barrel_blue', 'barrel_wood', 'sandbag_a', 'sandbag_b',
  'sandbag_c', 'jersey', 'block_big', 'block_small', 'tyre', 'tyre_small',
  'pallet', 'table', 'table_small', 'stall', 'shelf', 'mattress', 'chair',
  'cabinet', 'water_tank', 'planter', 'stool',
]);
const SUPPORT_CANDIDATES = new Set([
  ...INSTANCE_SUPPORTERS,
  'gas_bottle', 'bucket', 'jerry_can', 'lamp_post', 'palm_trunk', 'rock_a',
  'rock_b', 'brick_a', 'brick_b', 'slab_shard', 'rebar', 'plank_a', 'plank_b',
  'bottle', 'can',
]);
const STACKABLE_NAMES = new Set(['crate_a', 'crate_b', 'crate_c', 'crate_flat', 'box_card_a', 'box_card_b']);

const BOX = new THREE.Box3();
const POINT = new THREE.Vector3();
const TRI_A = new THREE.Vector3();
const TRI_B = new THREE.Vector3();
const TRI_C = new THREE.Vector3();
const EDGE_A = new THREE.Vector3();
const EDGE_B = new THREE.Vector3();
const CROSS = new THREE.Vector3();
const POSITION = new THREE.Vector3();
const SCALE = new THREE.Vector3();
const QUATERNION = new THREE.Quaternion();
const EULER = new THREE.Euler();

function placementKey(prototype, position) {
  return `${prototype}|${position.x.toFixed(3)}|${position.y.toFixed(3)}|${position.z.toFixed(3)}`;
}

function placementIdMap(placements) {
  const ids = new Map();
  for (const placement of placements) {
    POSITION.fromArray(placement.position);
    ids.set(placementKey(placement.prototype, POSITION), placement);
  }
  return ids;
}

function contactPoints(geometry, matrix, box) {
  const position = geometry.getAttribute('position');
  let minY = Infinity;
  for (let i = 0; i < position.count; i++) {
    POINT.fromBufferAttribute(position, i).applyMatrix4(matrix);
    if (POINT.y < minY) minY = POINT.y;
  }
  const threshold = Math.min(0.09, Math.max(0.025, (box.max.y - box.min.y) * 0.08));
  const width = Math.max(1e-5, box.max.x - box.min.x);
  const depth = Math.max(1e-5, box.max.z - box.min.z);
  const bins = new Array(9);
  const addPoint = (point) => {
    if (point.y > minY + threshold) return;
    const ix = Math.min(2, Math.max(0, Math.floor(((point.x - box.min.x) / width) * 3)));
    const iz = Math.min(2, Math.max(0, Math.floor(((point.z - box.min.z) / depth) * 3)));
    const bin = ix + iz * 3;
    if (!bins[bin] || point.y < bins[bin].y) bins[bin] = point.clone();
  };
  for (let i = 0; i < position.count; i++) {
    POINT.fromBufferAttribute(position, i).applyMatrix4(matrix);
    addPoint(POINT);
  }
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  for (let i = 0; i < count; i += 3) {
    TRI_A.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
    TRI_B.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
    TRI_C.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);
    EDGE_A.subVectors(TRI_B, TRI_A);
    EDGE_B.subVectors(TRI_C, TRI_A);
    CROSS.crossVectors(EDGE_A, EDGE_B);
    const normalLength = CROSS.length();
    if (normalLength < 1e-7 || CROSS.y / normalLength > -0.35) continue;
    POINT.copy(TRI_A).add(TRI_B).add(TRI_C).multiplyScalar(1 / 3);
    addPoint(POINT);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  return bins.filter(Boolean).map((point) => ({
    x: cx + (point.x - cx) * 0.9,
    y: point.y,
    z: cz + (point.z - cz) * 0.9,
  }));
}

function recordFor(prototype, proto, matrix, inverse, ids, extra = false) {
  proto.geo.computeBoundingBox();
  if (!proto.geo.boundingBox) return null;
  BOX.copy(proto.geo.boundingBox).applyMatrix4(matrix);
  POSITION.setFromMatrixPosition(matrix).applyMatrix4(inverse);
  const placement = ids.get(placementKey(prototype, POSITION)) ?? null;
  return {
    id: placement?.id ?? null,
    declaredSupport: placement?.support ?? null,
    prototype,
    geometry: proto.geo,
    matrix,
    box: BOX.clone(),
    position: POSITION.clone(),
    contacts: contactPoints(proto.geo, matrix, BOX),
    extra,
  };
}

function matrixForPlacement(A, placement) {
  POSITION.fromArray(placement.position);
  SCALE.fromArray(placement.scale);
  EULER.set(
    THREE.MathUtils.degToRad(placement.rotationDeg[0]),
    THREE.MathUtils.degToRad(placement.rotationDeg[1]),
    THREE.MathUtils.degToRad(placement.rotationDeg[2])
  );
  QUATERNION.setFromEuler(EULER);
  return new THREE.Matrix4().multiplyMatrices(
    A.xform,
    new THREE.Matrix4().compose(POSITION, QUATERNION, SCALE)
  );
}

function linkInterlocked(records, all, match, minDy, maxDy, maxDistance) {
  const supports = all.filter(match);
  for (const record of records) {
    if (!match(record)) continue;
    for (const other of supports) {
      const dy = record.position.y - other.position.y;
      if (other === record || dy < minDy || dy > maxDy) continue;
      if (Math.hypot(record.position.x - other.position.x, record.position.z - other.position.z) > maxDistance) continue;
      for (const point of record.evidence) point.owners.add(other.serial);
    }
  }
}

/** Analyze prop support without mutating the assembled world. */
export function analyzePropSupport(A, placements, extras = []) {
  if (!A.supportIndex) throw new Error('[world] support analysis requires trackSupports');
  const tolerance = 0.18;
  const penetration = 0.2;
  const inverse = A.xform.clone().invert();
  const ids = placementIdMap([...placements, ...extras]);
  const records = [];
  const all = [];
  let serial = 0;
  for (const [prototype, proto] of A._protos) {
    for (const matrix of proto.matrices) {
      const record = recordFor(prototype, proto, matrix, inverse, ids);
      if (!record) continue;
      record.serial = serial++;
      all.push(record);
      if (SUPPORT_CANDIDATES.has(prototype)) records.push(record);
    }
  }
  for (const placement of extras) {
    const proto = A._protos.get(placement.prototype);
    if (!proto) throw new Error(`[world] unknown support fixture prototype ${placement.prototype}`);
    const record = recordFor(
      placement.prototype, proto, matrixForPlacement(A, placement), inverse, ids, true
    );
    record.serial = serial++;
    records.push(record);
  }

  const instanceIndex = new SupportIndex();
  for (const record of all) {
    if (!INSTANCE_SUPPORTERS.has(record.prototype)) continue;
    instanceIndex.addGeometry(record.geometry, record.matrix, 'prop', record.prototype, record.serial);
  }

  for (const record of records) {
    const points = [];
    const height = record.box.max.y - record.box.min.y;
    record.penetration = Math.max(penetration, Math.min(0.45, height * 0.55));
    let nearestGap = Infinity;
    let unclassified = 0;
    const unclassifiedSources = new Set();
    for (const point of record.contacts) {
      const hit = A.supportIndex.query(point.x, point.z, point.y + record.penetration);
      const staticGap = point.y - hit.supportY;
      const anyGap = point.y - hit.anyY;
      const staticSupport = Number.isFinite(hit.supportY) && staticGap >= -record.penetration && staticGap <= tolerance;
      const otherSurface = Number.isFinite(hit.anyY) && anyGap >= -record.penetration && anyGap <= tolerance;
      if (Number.isFinite(anyGap) && anyGap >= -record.penetration) nearestGap = Math.min(nearestGap, anyGap);
      if (otherSurface && !staticSupport) {
        unclassified++;
        if (hit.anySource) unclassifiedSources.add(hit.anySource);
      }
      points.push({
        staticSupport,
        role: staticSupport ? hit.role : null,
        owners: instanceIndex.queryOwners(
          point.x, point.z, point.y - tolerance, point.y + record.penetration, record.serial
        ),
      });
    }
    record.evidence = points;
    record.required = Math.min(points.length, Math.max(1, Math.ceil(points.length * 0.2)));
    record.strictRequired = Math.min(points.length, Math.max(points.length > 1 ? 2 : 1, Math.ceil(points.length * 0.6)));
    record.nearestGap = nearestGap;
    record.unclassified = unclassified;
    record.unclassifiedSources = unclassifiedSources;
  }

  // Horizontal tyre piles interlock through the torus holes, so vertical rays
  // correctly miss even though the lower tyre carries the next one.
  linkInterlocked(
    records, all, (record) => record.prototype === 'tyre' || record.prototype === 'tyre_small', 0.08, 0.5, 0.32
  );
  linkInterlocked(records, all, (record) => record.prototype.startsWith('sandbag_'), 0.07, 0.35, 0.72);
  const stackables = all.filter((record) => STACKABLE_NAMES.has(record.prototype));
  for (const record of records) {
    if (!STACKABLE_NAMES.has(record.prototype)) continue;
    const area = Math.max(1e-5, (record.box.max.x - record.box.min.x) * (record.box.max.z - record.box.min.z));
    for (const other of stackables) {
      if (other === record || other.position.y >= record.position.y) continue;
      const seat = record.box.min.y - other.box.max.y;
      if (seat < -0.2 || seat > 0.25) continue;
      const overlapX = Math.min(record.box.max.x, other.box.max.x) - Math.max(record.box.min.x, other.box.min.x);
      const overlapZ = Math.min(record.box.max.z, other.box.max.z) - Math.max(record.box.min.z, other.box.min.z);
      const otherArea = Math.max(1e-5, (other.box.max.x - other.box.min.x) * (other.box.max.z - other.box.min.z));
      if (overlapX <= 0 || overlapZ <= 0 || overlapX * overlapZ < Math.min(area, otherArea) * 0.2) continue;
      for (const point of record.evidence) point.owners.add(other.serial);
    }
  }

  const resolveSupported = (allowUndeclaredBalcony) => {
    const resolved = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of records) {
        if (record.extra || resolved.has(record.serial)) continue;
        let contacts = 0;
        for (const point of record.evidence) {
          const staticSupport = point.staticSupport && (
            point.role !== 'balcony' || allowUndeclaredBalcony || record.declaredSupport === 'balcony'
          );
          if (staticSupport || [...point.owners].some((owner) => resolved.has(owner))) contacts++;
        }
        if (contacts < record.required) continue;
        resolved.add(record.serial);
        changed = true;
      }
    }
    return resolved;
  };
  const supported = resolveSupported(true);
  const stableSupported = resolveSupported(false);

  const results = [];
  for (const record of records) {
    let contacts = 0;
    const roles = new Set();
    for (const point of record.evidence) {
      if (point.staticSupport) {
        contacts++;
        roles.add(point.role);
      } else if ([...point.owners].some((owner) => supported.has(owner))) {
        contacts++;
        roles.add('prop');
      }
    }
    const ok = contacts >= record.required;
    const balconyReview = ok && !record.extra && !stableSupported.has(record.serial);
    const overhangReview = ok && contacts < record.strictRequired;
    const smallGapReview = !ok && record.nearestGap != null && record.nearestGap < 0.35;
    results.push({
      id: record.id,
      prototype: record.prototype,
      position: record.position.toArray(),
      status: balconyReview ? 'review-balcony' : overhangReview ? 'review-overhang' : ok ? 'supported' : record.unclassified >= record.required ? 'unclassified-seat' : smallGapReview ? 'review-gap' : 'unsupported',
      contacts,
      required: record.required,
      strictRequired: record.strictRequired,
      samples: record.contacts.length,
      roles: [...roles].sort(),
      unclassifiedSources: [...record.unclassifiedSources].sort(),
      nearestGap: Number.isFinite(record.nearestGap) ? record.nearestGap : null,
      extra: record.extra,
    });
  }
  const current = results.filter((result) => !result.extra);
  return {
    results,
    stats: {
      candidates: current.length,
      fixtures: results.length - current.length,
      staticTriangles: A.supportIndex.triangles,
      staticCells: A.supportIndex.cells.size,
      supported: current.filter((result) => result.status === 'supported').length,
      suspicious: current.filter((result) => result.status !== 'supported').length,
    },
  };
}
