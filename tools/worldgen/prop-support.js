import * as THREE from 'three';
import { SupportIndex } from './support-index.js';
import { contactPoints, footprintMargin, geometryCentre, geometryWinding, supportFootprint } from './support-contact.js';

// Solid props only: decals, dust skirts, vegetation and pocks are not roots or
// supporters. Any analyzed solid can carry another; no separate stack whitelist.
const SUPPORT_CANDIDATES = new Set([
  'crate_a', 'crate_b', 'crate_c', 'crate_flat', 'box_card_a', 'box_card_b',
  'barrel_rust', 'barrel_blue', 'barrel_wood', 'sandbag_a', 'sandbag_b',
  'sandbag_c', 'jersey', 'block_big', 'block_small', 'tyre', 'tyre_small',
  'pallet', 'table', 'table_small', 'stall', 'shelf', 'mattress', 'chair',
  'cabinet', 'water_tank', 'planter', 'stool',
  'gas_bottle', 'bucket', 'jerry_can', 'lamp_post', 'palm_trunk', 'rock_a',
  'rock_b', 'brick_a', 'brick_b', 'slab_shard', 'rebar', 'plank_a', 'plank_b',
  'bottle', 'can',
]);

// Separate measured contact from diagnostic proximity. Neither a nearby prop
// nor an overlapping world AABB creates contact samples or a certain support.
export const SUPPORT_LIMITS = Object.freeze({ contact: 0.04, penetration: 0.04, reviewGap: 0.35, reviewPenetration: 0.45 });
const REASONS = ['review-gap', 'review-penetration', 'unclassified-seat', 'review-balcony', 'review-overhang'];

function placementKey(prototype, position) {
  return `${prototype}|${position.x.toFixed(3)}|${position.y.toFixed(3)}|${position.z.toFixed(3)}`;
}

function matrixForPlacement(A, placement) {
  const rotation = new THREE.Euler(...placement.rotationDeg.map(THREE.MathUtils.degToRad));
  return new THREE.Matrix4().multiplyMatrices(A.xform, new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(placement.position),
    new THREE.Quaternion().setFromEuler(rotation),
    new THREE.Vector3().fromArray(placement.scale)
  ));
}

function touching(hit) {
  return hit.gap >= -SUPPORT_LIMITS.penetration && hit.gap <= SUPPORT_LIMITS.contact;
}

function intended(hit, record) {
  return hit.role && (hit.role !== 'balcony' || record.declaredSupport === 'balcony');
}

/** Analyze prop support without mutating the assembled world. */
export function analyzePropSupport(A, placements, extras = []) {
  if (!A.supportIndex) throw new Error('[world] support analysis requires trackSupports');
  const inverse = A.xform.clone().invert();
  const ids = new Map([...placements, ...extras].map((placement) => [
    placementKey(placement.prototype, new THREE.Vector3().fromArray(placement.position)), placement,
  ]));
  const records = [];
  function addRecord(prototype, proto, matrix, extra = false) {
    const position = new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(inverse);
    const placement = ids.get(placementKey(prototype, position));
    // A transformed local AABB grows spuriously with rotation. Use actual
    // transformed vertices for both the sampling bounds and centre estimate.
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    const vertices = proto.geo.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) box.expandByPoint(point.fromBufferAttribute(vertices, i).applyMatrix4(matrix));
    const serial = records.length;
    records.push({
      serial, id: placement?.id ?? null,
      key: placement?.id ?? `generated/${placementKey(prototype, position)}`,
      declaredSupport: placement?.support ?? null,
      prototype, geometry: proto.geo, matrix, box, position, extra,
      centre: geometryCentre(proto.geo).clone().applyMatrix4(matrix),
      contacts: contactPoints(proto.geo, matrix, box),
      evidence: [], reasons: new Set(), dependencies: new Set(),
    });
  }
  for (const [prototype, proto] of A._protos) {
    if (!SUPPORT_CANDIDATES.has(prototype)) continue;
    for (const matrix of proto.matrices) addRecord(prototype, proto, matrix);
  }
  for (const placement of extras) {
    const proto = A._protos.get(placement.prototype);
    if (!proto) throw new Error(`[world] unknown support fixture prototype ${placement.prototype}`);
    addRecord(placement.prototype, proto, matrixForPlacement(A, placement), true);
  }

  const instances = new SupportIndex();
  for (const record of records) {
    // Fixtures are probes, not changes to the world: they cannot support other
    // fixtures or real placements. Normal instances exercise full graph logic.
    if (record.extra) continue;
    instances.addGeometry(record.geometry, record.matrix, 'prop', record.prototype, record.serial,
      geometryWinding(record.geometry) * Math.sign(record.matrix.determinant()));
  }
  for (const record of records) {
    const penetration = Math.min(SUPPORT_LIMITS.reviewPenetration, Math.max(0.08, (record.box.max.y - record.box.min.y) * 0.5));
    for (const point of record.contacts) {
      const hits = [
        ...A.supportIndex.surfacesAt(point.x, point.z, -Infinity, point.y + penetration),
        ...instances.surfacesAt(point.x, point.z, -Infinity, point.y + penetration, record.serial),
      ].map((hit) => ({ ...hit, gap: point.y - hit.y }));
      record.evidence.push({ point, hits });
    }
  }

  // Solve two rooted graphs. A review edge may explain where an object should
  // sit, but can never certify it (or anything above it) as stably supported.
  function resolve(strict) {
    const resolved = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of records) {
        if (record.extra || resolved.has(record.serial)) continue;
        const points = record.evidence.filter(({ hits }) => hits.some((hit) => (
          hit.gap <= SUPPORT_LIMITS.reviewGap &&
          (hit.owner == null || resolved.has(hit.owner)) &&
          (!strict || (touching(hit) && (hit.owner != null || intended(hit, record))))
        ))).map(({ point }) => point);
        if (strict ? !supportFootprint(points, record.box, record.centre) : points.length === 0) continue;
        resolved.add(record.serial);
        changed = true;
      }
    }
    return resolved;
  }
  const rooted = resolve(false);
  const stable = resolve(true);

  for (const record of records) {
    record.measured = [];
    record.roles = new Set();
    record.sources = new Set();
    record.nearest = null;
    const selectedPoints = [];
    for (const evidence of record.evidence) {
      let selected = null;
      let cost = Infinity;
      for (const hit of evidence.hits) {
        if (hit.owner != null && !rooted.has(hit.owner)) continue;
        if (!record.nearest || Math.abs(hit.gap) < Math.abs(record.nearest.gap)) record.nearest = hit;
        if (hit.gap > SUPPORT_LIMITS.reviewGap) continue;
        const certain = touching(hit) && (hit.owner == null ? intended(hit, record) : stable.has(hit.owner));
        const score = (certain ? 0 : touching(hit) ? 1 : 2) + Math.abs(hit.gap);
        if (score < cost) { selected = hit; cost = score; }
      }
      if (selected) selectedPoints.push({ point: evidence.point, hit: selected });
    }
    // Higher undersides naturally have an air gap (a chair seat, torus curve,
    // tilted crate). Diagnose the best actual contact patch, not every ray.
    const physical = selectedPoints.filter(({ hit }) => touching(hit));
    const patch = stable.has(record.serial) ? physical.filter(({ hit }) => (
      hit.owner == null ? intended(hit, record) : stable.has(hit.owner)
    )) : physical.length ? physical : selectedPoints;
    for (const { point, hit: selected } of patch) {
      record.roles.add(selected.role ?? 'unclassified');
      if (selected.owner != null) record.dependencies.add(selected.owner);
      else {
        if (!selected.role) { record.reasons.add('unclassified-seat'); record.sources.add(selected.source); }
        if (selected.role === 'balcony' && record.declaredSupport !== 'balcony') record.reasons.add('review-balcony');
      }
      if (touching(selected)) record.measured.push(point);
      else record.reasons.add(selected.gap > SUPPORT_LIMITS.contact ? 'review-gap' : 'review-penetration');
    }
    if (physical.length && !supportFootprint(record.measured, record.box, record.centre)) record.reasons.add('review-overhang');
    // A clean independent support path wins over unrelated nearby ambiguity.
    if (stable.has(record.serial)) record.reasons.clear();
    record.hasSupport = patch.length > 0;
    record.localReasons = [...record.reasons];
  }
  // Preserve all uncertainty through the selected dependencies. Monotone sets
  // converge even for mutually intersecting props; cycles cannot seed a root.
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (stable.has(record.serial)) continue;
      for (const owner of record.dependencies) {
        for (const reason of records[owner].reasons) {
          if (!record.reasons.has(reason)) { record.reasons.add(reason); changed = true; }
        }
      }
    }
  }

  const results = records.map((record) => {
    const reasons = REASONS.filter((reason) => record.reasons.has(reason));
    // Mutual contacts can surround both centres without either object having a
    // stable path to a root. Never turn that rooted-but-uncertain cycle green.
    if (record.hasSupport && !record.extra && !stable.has(record.serial) && !reasons.length) reasons.push('review-support-chain');
    const margin = footprintMargin(record.measured, record.box, record.centre);
    return {
      id: record.id, key: record.key, prototype: record.prototype, position: record.position.toArray(),
      status: !record.hasSupport ? 'unsupported' : reasons[0] ?? 'supported', reasons,
      localReasons: record.localReasons,
      physical: record.measured.length ? 'contact' : !record.hasSupport ? 'none' : record.localReasons.includes('review-gap') ? 'gap' : 'penetration',
      contacts: record.measured.length, samples: record.contacts.length,
      stableFootprint: margin >= -1e-7,
      stabilityMargin: Number.isFinite(margin) ? margin : null,
      roles: [...record.roles].sort(), unclassifiedSources: [...record.sources].filter(Boolean).sort(),
      supporters: [...record.dependencies].map((serial) => records[serial].key).sort(),
      nearestGap: record.nearest?.gap ?? null,
      nearestSupport: record.nearest ? (record.nearest.owner == null ? record.nearest.source : records[record.nearest.owner].key) : null,
      extra: record.extra,
    };
  });
  const current = results.filter((result) => !result.extra);
  const statuses = {};
  for (const result of current) statuses[result.status] = (statuses[result.status] ?? 0) + 1;
  return { results, stats: {
    candidates: current.length, fixtures: results.length - current.length,
    staticTriangles: A.supportIndex.triangles, staticCells: A.supportIndex.cells.size,
    supported: statuses.supported ?? 0, suspicious: current.length - (statuses.supported ?? 0), statuses,
    inheritedOnly: current.filter((result) => result.status !== 'supported' && result.status !== 'unsupported' && result.localReasons.length === 0).length,
  } };
}
