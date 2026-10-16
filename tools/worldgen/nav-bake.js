import { init, exportNavMesh, Detour } from '@recast-navigation/core';
import { generateTiledNavMesh } from '@recast-navigation/generators';
import * as THREE from 'three';

import { INFANTRY } from '../../src/ai/capabilities.ts';
import {
  createLadderDescriptors,
  LadderMotor,
  LADDER,
  ladderMoveBudget,
} from '../../src/ai/ladder.ts';
import {
  NAV_CONFIG,
  NAV_PROFILE,
  NAV_LADDER_FLAG,
  NAV_LINK_RADIUS,
  packNav,
} from '../../src/ai/nav-format.ts';
import { SurfaceNav, navigationComponents } from '../../src/ai/nav.ts';
import { CharacterController } from '../../src/physics/character.ts';
import { PhysicsSystem } from '../../src/physics/index.ts';

// Sample walkable boundaries on EVERY floor. No top-down single-height grid.
// Runtime scoring/claims remain in CoverMap; these are static physical probes.
function bakeCover(nav) {
  const points = [],
    seen = new Set(),
    p = new THREE.Vector3(),
    out = new THREE.Vector3();
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const phys = nav.physics;
  for (let i = 0; i < nav.mesh.getMaxTiles(); i++) {
    const tile = nav.mesh.getTile(i),
      h = tile.header();
    if (!h) continue;
    for (let j = 0; j < h.polyCount(); j++) {
      const poly = tile.polys(j);
      if (poly.getType() !== 0) continue;
      const connected = new Set();
      for (let k = poly.firstLink(); k !== Detour.DT_NULL_LINK; k = tile.links(k).next())
        if (tile.links(k).ref()) connected.add(tile.links(k).edge());
      for (let edge = 0; edge < poly.vertCount(); edge++) {
        if (connected.has(edge)) continue;
        const a = poly.verts(edge) * 3,
          b = poly.verts((edge + 1) % poly.vertCount()) * 3;
        const ax = tile.verts(a),
          ay = tile.verts(a + 1),
          az = tile.verts(a + 2);
        const bx = tile.verts(b),
          by = tile.verts(b + 1),
          bz = tile.verts(b + 2);
        const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.8));
        for (let s = 0; s < samples; s++) {
          const t = (s + 0.5) / samples;
          p.set(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
          const ref = nav.sampleGround(p.x, p.z, p.y, out);
          if (!ref) continue;
          const key = `${Math.round(out.x / 0.8)},${Math.round(out.y / 0.4)},${Math.round(out.z / 0.8)},${nav.walkingComponents.get(ref)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          for (const [x, z] of directions) {
            const len = Math.hypot(x, z),
              dx = x / len,
              dz = z / len;
            const low = phys.raycast(out.x, out.y + 0.55, out.z, dx, 0, dz, 1.3, phys.MASK.WORLD);
            if (!low.hit) continue;
            const distance = low.distance;
            const high = phys.raycastAny(
              out.x,
              out.y + 1.32,
              out.z,
              dx,
              0,
              dz,
              1.3,
              phys.MASK.WORLD
            );
            points.push({
              x: out.x,
              y: out.y,
              z: out.z,
              dx,
              dz,
              dist: distance,
              high,
              surface: ref,
              component: nav.walkingComponents.get(ref),
              claimed: -1,
              score: 0,
            });
            break;
          }
        }
      }
    }
  }
  return points;
}

/** Bake only offline, from the exact cooked collision registered by physics. */
export async function bakeNav(collisionScene, bounds, provenance = {}, volumes = []) {
  const phys = new PhysicsSystem();
  collisionScene.updateWorldMatrix(true, true);
  collisionScene.traverse((object) => {
    if (object.isMesh && object.userData?.surface) phys.addStatic(object, object.userData.surface);
  });
  const start = performance.now();
  phys.rebuildStatic();
  const bvhMs = performance.now() - start;
  return bakePhysicsNav(phys, bounds, provenance, bvhMs, volumes);
}

// Also used by controller-backed smoke fixtures, with the same generator/profile.
export async function bakePhysicsNav(phys, bounds, provenance = {}, bvhMs = 0, volumes = []) {
  await init();
  const positions = phys.staticWorld.pos.subarray(0, phys.triangleCount * 9);
  const indices = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const start = performance.now();
  const ladders = createLadderDescriptors(volumes);
  const generated = generateTiledNavMesh(positions, indices, {
    ...NAV_CONFIG,
    offMeshConnections: ladders.map((d) => ({
      startPosition: d.points[0],
      endPosition: d.points[3],
      radius: NAV_LINK_RADIUS,
      bidirectional: true,
      flags: NAV_LADDER_FLAG,
      userId: d.id,
    })),
  });
  if (!generated.success) throw new Error(`[nav bake] ${generated.error}`);
  const components = navigationComponents(generated.navMesh);
  const nav = new SurfaceNav(phys, generated.navMesh, components, { ladders });
  try {
    // Fail the bake, not individual links, if the real motor or either final
    // Detour walking attachment cannot execute. No shaft-top endpoint guesses.
    for (const [ref, { descriptor: d, lowerRef }] of nav.ladderLinks) {
      for (const direction of ['up', 'down']) {
        const entry = d.points[direction === 'up' ? 0 : 3];
        const c = new CharacterController(phys.staticWorld, {
          ...NAV_PROFILE,
          position: entry,
          stepHeight: INFANTRY.stepHeight,
          slopeLimit: INFANTRY.slopeRadians,
        });
        const motor = new LadderMotor(c, d, direction, ladderMoveBudget(d));
        for (let i = 0; motor.status === 'active' && i <= motor.maxMoves; i++)
          motor.advance(LADDER.step);
        if (motor.status !== 'complete')
          throw new Error(`[nav bake] ladder ${d.id}/${direction}: ${motor.failure}`);
      }
      const native = generated.navMesh.getOffMeshConnectionPolyEndPoints(lowerRef, ref);
      if (!native.success) throw new Error('[nav bake] missing final ladder endpoints');
      for (const [i, p] of [native.start, native.end].entries()) {
        const a = new THREE.Vector3().copy(p),
          b = new THREE.Vector3().copy(d.points[i ? 3 : 0]);
        const c = new CharacterController(phys.staticWorld, {
          ...NAV_PROFILE,
          position: p,
          stepHeight: INFANTRY.stepHeight,
        });
        c.probeGround();
        if (!c.grounded || !nav.canStand(a) || !nav.canAttach(a, b) || !nav.canAttach(b, a))
          throw new Error(`[nav bake] ladder ${d.id} final attachment ${i}`);
      }
    }
    const points = bakeCover(nav);
    const metadata = {
      ...provenance,
      ladders,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      config: NAV_CONFIG,
    };
    const buffer = await packNav(metadata, exportNavMesh(generated.navMesh), components, points);
    return {
      buffer,
      bvhMs,
      polygons: components.size,
      coverCount: points.length,
      components: new Set(components.values()).size,
      bakeMs: performance.now() - start,
    };
  } finally {
    nav.dispose();
  }
}
