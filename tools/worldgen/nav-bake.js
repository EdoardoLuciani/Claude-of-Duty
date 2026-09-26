import * as THREE from 'three';
import { init, exportNavMesh, Detour } from '@recast-navigation/core';
import { generateTiledNavMesh } from '@recast-navigation/generators';
import { PhysicsSystem } from '../../src/physics/index.js';
import { SurfaceNav } from '../../src/ai/nav.js';
import { NAV_CONFIG, packNav } from '../../src/ai/nav-format.js';

/** Weak components are a cheap necessary reachability check, never a substitute
 * for Detour's full-path result. No off-mesh/advanced traversal is baked. */
function componentsFor(mesh) {
  const refs = [], index = new Map();
  for (let i = 0; i < mesh.getMaxTiles(); i++) {
    const tile = mesh.getTile(i), header = tile.header();
    if (!header) continue;
    const base = mesh.getPolyRefBase(tile);
    for (let j = 0; j < header.polyCount(); j++) { index.set(base + j, refs.length); refs.push(base + j); }
  }
  const parent = Int32Array.from({ length: refs.length }, (_, i) => i);
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < refs.length; i++) {
    const { tile, poly } = mesh.getTileAndPolyByRef(refs[i]);
    for (let k = poly.firstLink(); k !== Detour.DT_NULL_LINK; k = tile.links(k).next()) {
      const ref = tile.links(k).ref(), j = index.get(ref);
      if (j === undefined) continue;
      const a = root(i), b = root(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  return new Map(refs.map((ref, i) => [ref, root(i) + 1]));
}

// Sample walkable boundaries on EVERY floor. No top-down single-height grid.
// Runtime scoring/claims remain in CoverMap; these are static physical probes.
function bakeCover(nav) {
  const points = [], seen = new Set(), p = new THREE.Vector3(), out = new THREE.Vector3();
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const phys = nav.physics;
  for (let i = 0; i < nav.mesh.getMaxTiles(); i++) {
    const tile = nav.mesh.getTile(i), h = tile.header();
    if (!h) continue;
    for (let j = 0; j < h.polyCount(); j++) {
      const poly = tile.polys(j), connected = new Set();
      for (let k = poly.firstLink(); k !== Detour.DT_NULL_LINK; k = tile.links(k).next()) if (tile.links(k).ref()) connected.add(tile.links(k).edge());
      for (let edge = 0; edge < poly.vertCount(); edge++) {
        if (connected.has(edge)) continue;
        const a = poly.verts(edge) * 3, b = poly.verts((edge + 1) % poly.vertCount()) * 3;
        const ax = tile.verts(a), ay = tile.verts(a + 1), az = tile.verts(a + 2);
        const bx = tile.verts(b), by = tile.verts(b + 1), bz = tile.verts(b + 2);
        const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / .8));
        for (let s = 0; s < samples; s++) {
          const t = (s + .5) / samples;
          p.set(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
          const ref = nav.sampleGround(p.x, p.z, p.y, out);
          if (!ref) continue;
          const key = `${Math.round(out.x / .8)},${Math.round(out.y / .4)},${Math.round(out.z / .8)},${nav.components.get(ref)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          for (const [x, z] of directions) {
            const len = Math.hypot(x, z), dx = x / len, dz = z / len;
            const low = phys.raycast(out.x, out.y + .55, out.z, dx, 0, dz, 1.3, phys.MASK.WORLD);
            if (!low.hit) continue;
            const distance = low.distance;
            const high = phys.raycastAny(out.x, out.y + 1.32, out.z, dx, 0, dz, 1.3, phys.MASK.WORLD);
            points.push({ x: out.x, y: out.y, z: out.z, dx, dz, dist: distance, high, surface: ref,
              component: nav.components.get(ref), claimed: -1, score: 0 });
            break;
          }
        }
      }
    }
  }
  return points;
}

/** Bake only offline, from the exact cooked collision registered by physics. */
export async function bakeNav(collisionScene, bounds, provenance = {}) {
  const phys = new PhysicsSystem();
  collisionScene.updateWorldMatrix(true, true);
  collisionScene.traverse(object => { if (object.isMesh && object.userData?.surface) phys.addStatic(object, object.userData.surface); });
  const start = performance.now(); phys.rebuildStatic(); const bvhMs = performance.now() - start;
  return bakePhysicsNav(phys, bounds, provenance, bvhMs);
}

// Also used by controller-backed smoke fixtures, with the same generator/profile.
export async function bakePhysicsNav(phys, bounds, provenance = {}, bvhMs = 0) {
  await init();
  const positions = phys.staticWorld.pos.subarray(0, phys.triangleCount * 9);
  const indices = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const start = performance.now();
  const generated = generateTiledNavMesh(positions, indices, NAV_CONFIG);
  if (!generated.success) throw new Error(`[nav bake] ${generated.error}`);
  const components = componentsFor(generated.navMesh);
  const nav = new SurfaceNav(phys, generated.navMesh, components);
  try {
    const points = bakeCover(nav);
    const metadata = { ...provenance, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, config: NAV_CONFIG };
    const buffer = await packNav(metadata, exportNavMesh(generated.navMesh), components, points);
    return { buffer, bvhMs, polygons: components.size, coverCount: points.length,
      components: new Set(components.values()).size, bakeMs: performance.now() - start };
  } finally { nav.dispose(); }
}
