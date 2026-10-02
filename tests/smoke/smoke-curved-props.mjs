import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../src/core/rng.js';
import { registerProps } from '../../tools/worldgen/props.js';
import { drainpipe } from '../../tools/worldgen/kit.js';
import { catenaryTube } from '../../tools/worldgen/util.js';

// Weld coincident vertices only: overlapping disconnected primitives must NOT
// pass as one continuous surface. Caps and UV seams may duplicate vertices.
function componentBounds(geometry) {
  const positions = geometry.getAttribute('position');
  const ids = [], points = [], parent = [], welded = new Map();
  for (let i = 0; i < positions.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i);
    const key = p.toArray().map(n => Math.round(n * 1e5)).join(',');
    if (!welded.has(key)) {
      welded.set(key, points.length);
      parent.push(points.length);
      points.push(p);
    }
    ids.push(welded.get(key));
  }
  const root = i => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const indices = geometry.index.array;
  for (let i = 0; i < indices.length; i += 3) {
    const a = root(ids[indices[i]]);
    parent[root(ids[indices[i + 1]])] = a;
    parent[root(ids[indices[i + 2]])] = a;
  }
  const bounds = new Map();
  points.forEach((p, i) => {
    const id = root(i);
    if (!bounds.has(id)) bounds.set(id, new THREE.Box3());
    bounds.get(id).expandByPoint(p);
  });
  return [...bounds.values()];
}

const props = new Map();
registerProps({ proto(id, { geo }) {
  if (id === 'lamp_post' || id === 'palm_trunk') props.set(id, geo);
  else geo.dispose();
} }, new Rng(0x5eed1234));
const lamp = props.get('lamp_post');
assert(componentBounds(lamp).some(b => b.max.x - b.min.x > .75 && b.min.y > 5.1 && b.max.y > 5.6),
  'lamp arm is one continuous curved surface, not isolated cylinder stubs');
const palm = props.get('palm_trunk');
assert(componentBounds(palm).some(b => b.max.y - b.min.y > 5.39),
  'palm trunk has shared rings from base to crown, not offset logs');
for (const geo of props.values()) {
  assert([...geo.getAttribute('normal').array].every(Number.isFinite));
  geo.dispose();
}

const cache = new Map(), added = [];
const A = {
  cache(key, make) { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); },
  add(key, geo, matrix) { added.push({ key, geo, matrix: matrix.clone() }); },
};
const panel = new THREE.Matrix4().makeRotationY(.8).setPosition(2, 0, 3);
drainpipe(A, panel, 1, 6, 6, null);
const elbow = added.find(({ geo }) => geo.type === 'TubeGeometry');
assert(elbow, 'downpipe has a swept elbow instead of a tilted straight shoe');
const curve = elbow.geo.parameters.path;
const start = curve.getPoint(0), end = curve.getPoint(1);
assert(curve.getTangent(0).y < -.99, 'elbow starts downward on the pipe axis');
assert(curve.getTangent(1).z < -.99, 'outlet faces out toward the street');
assert(end.y - .055 > .145, 'open outlet stays above the sidewalk');
assert.equal(end.z, -.25, 'outlet projects away from the facade');
const firstPipe = added[0];
const pipeBase = new THREE.Vector3().applyMatrix4(firstPipe.matrix);
const elbowTop = start.applyMatrix4(elbow.matrix);
assert(Math.abs(pipeBase.x - elbowTop.x) < 1e-8 && Math.abs(pipeBase.z - elbowTop.z) < 1e-8,
  'straight section and elbow share an axis in transformed panel space');
assert(Math.abs(pipeBase.y - elbowTop.y + .02) < 1e-8, 'pipe overlaps the elbow by 2 cm');
for (const geo of cache.values()) geo.dispose();

const from = [-6.4, 7.2, 10], to = [6.4, 6.6, 12.5];
const wire = catenaryTube(from, to, 1.1, .022, { seg: 14, radial: 4, jitter: .05 });
const path = wire.parameters.path;
assert(path.getPoint(0).distanceTo(new THREE.Vector3(...from)) < 1e-9, 'jitter never moves the first cable mount');
assert(path.getPoint(1).distanceTo(new THREE.Vector3(...to)) < 1e-9, 'jitter never moves the last cable mount');
assert(path.getPoint(.5).y < Math.min(from[1], to[1]), 'span retains its catenary sag');
assert([...wire.getAttribute('normal').array].every(Number.isFinite));
wire.dispose();
console.log('Curved props: continuous lamp/palm surfaces, connected outward drain elbow and pinned cable ends passed');
