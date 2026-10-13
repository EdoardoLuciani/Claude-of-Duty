#!/usr/bin/env node
/** Walk the retained W5 frontage and terrace against regenerated collision. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadMap, vec } from '../../tools/nav240/fixtures.mjs';
import { execute } from '../../tools/nav240/harness.mjs';
import { SurfaceNav } from '../../src/ai/nav.ts';

const map = await loadMap();
map.grid = await SurfaceNav.load(map.surfaceRaw, map.physics);
const transform = new THREE.Matrix4().fromArray(map.meta.transform);
const point = (position) => vec(position).applyMatrix4(transform);
const direct = { query: (_from, to) => ({ outcome: 'success', points: [to.clone()] }) };
const w5 = map.meta.buildings.find((building) => building.spec.id === 'W5');
const cases = w5.traversable.map((opening) => ({
  name: `W5/ground-door-${opening.side}`,
  from: point(opening.from), to: point(opening.to),
}));
for (const sample of cases) {
  for (const p of [sample.from, sample.to]) p.y = map.physics.groundHeight(p.x, p.z, 0.6);
}
cases.push({ name: 'W5/along-terrace', from: point([-7.1, 3.45, 28.2]), to: point([-7.1, 3.45, 35.8]) });
for (const sample of cases) {
  for (const [from, to] of [[sample.from, sample.to], [sample.to, sample.from]]) {
    const result = execute(map, direct, { ...sample, from, to });
    assert.equal(result.arrived, true, `${sample.name}: ${result.status}`);
    assert.equal(result.recovery.length, 0, `${sample.name}: no teleport recovery`);
    assert.ok(result.floorError < 0.2, `${sample.name}: stay on the intended floor`);
  }
}
map.grid.dispose();
console.log(`ok  W5 cooked collision: ${cases.length * 2} bidirectional ground-door/terrace traversals`);
