// Optional spike dependency; install separately as documented, never at boot.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import * as THREE from 'three';
import { PROFILE } from './fixtures.mjs';
import { canConnect } from './harness.mjs';

export async function recastApi(packageDirectory) {
  const core = await import(pathToFileURL(join(packageDirectory, 'index.mjs')));
  const generators = await import(pathToFileURL(join(packageDirectory, 'generators.mjs')));
  const start = performance.now();
  await core.init();
  return { ...core, ...generators, initMs: performance.now() - start };
}
export function recastMesh(api, physics, cs = 0.2, { tiled = false, ...overrides } = {}) {
  const ch = overrides.ch ?? 0.05;
  const config = { cs, ch, walkableSlopeAngle: PROFILE.slope,
    walkableHeight: Math.ceil(PROFILE.height / ch), walkableClimb: Math.floor(PROFILE.step / ch),
    walkableRadius: Math.ceil(PROFILE.radius / cs), minRegionArea: 0, mergeRegionArea: 0,
    maxSimplificationError: 1.0, detailSampleDist: 6, detailSampleMaxError: 1, ...overrides };
  const positions = physics.staticWorld.pos.subarray(0, physics.triangleCount * 9);
  const indices = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const t = performance.now();
  const generated = (tiled ? api.generateTiledNavMesh : api.generateSoloNavMesh)(positions, indices, config);
  if (!generated.success) throw new Error(generated.error);
  const nav = generated.navMesh;
  const bakeMs = performance.now() - t;
  const packed = Buffer.from(api.exportNavMesh(nav));
  const loadStart = performance.now();
  const imported = api.importNavMesh(new Uint8Array(packed));
  const q = new api.NavMeshQuery(imported.navMesh, { maxNodes: 6000 });
  const loadMs = performance.now() - loadStart;
  nav.destroy();
  let polygons = 0;
  for (let i = 0; i < imported.navMesh.getMaxTiles(); i++) polygons += imported.navMesh.getTile(i).header()?.polyCount() ?? 0;
  function resolve(p, goal = false) {
    const n = q.findNearestPoly(p, { halfExtents: { x: 1.2, y: PROFILE.step, z: 1.2 } });
    if (!n.success || !n.nearestRef || Math.abs(n.nearestPoint.y - p.y) > PROFILE.step) return null;
    if (Math.hypot(n.nearestPoint.x - p.x, n.nearestPoint.z - p.z) > 1.2) return null;
    if (!(goal ? canConnect(physics, n.nearestPoint, p) : canConnect(physics, p, n.nearestPoint))) return null;
    return n;
  }
  function query(from, to) {
    const a = resolve(from), b = resolve(to, true);
    if (!a || !b) return { outcome: 'invalid', points: [] };
    const route = q.findPath(a.nearestRef, b.nearestRef, a.nearestPoint, b.nearestPoint, { maxPathPolys: 2048 });
    try {
      // Detour success can mean a PARTIAL path. Never translate that to arrival.
      if (route.status & api.Detour.DT_OUT_OF_NODES) return { outcome: 'search-limit', points: [] };
      if (route.status & api.Detour.DT_BUFFER_TOO_SMALL) return { outcome: 'path-limit', points: [] };
      if (!route.success || !route.polys.size || route.polys.get(route.polys.size - 1) !== b.nearestRef) {
        return { outcome: 'unreachable', points: [] };
      }
      const straight = q.findStraightPath(a.nearestPoint, b.nearestPoint, route.polys,
        { maxStraightPathPoints: 2048, straightPathOptions: 0 });
      try {
        if (!straight.success || (straight.status & api.Detour.DT_BUFFER_TOO_SMALL)) return { outcome: 'path-limit', points: [] };
        const points = [];
        for (let i = 0; i < straight.straightPathCount; i++) points.push(new THREE.Vector3(
          straight.straightPath.get(i * 3), straight.straightPath.get(i * 3 + 1), straight.straightPath.get(i * 3 + 2)));
        points.push(to.clone());
        return { outcome: 'success', points };
      } finally {
        straight.straightPath.destroy(); straight.straightPathFlags.destroy(); straight.straightPathRefs.destroy();
      }
    } finally { route.polys.destroy(); }
  }
  return { name: `recast-${cs}`, query, resolve, packed,
    metrics: { config, tiled, polygons, bakeMs, loadMs, packedBytes: packed.length },
    dispose() { api.Raw.destroy(q.defaultFilter.raw); q.destroy(); imported.navMesh.destroy(); } };
}
