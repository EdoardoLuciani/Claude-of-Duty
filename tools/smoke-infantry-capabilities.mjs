import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../src/core/rng.js';
import { Agent } from '../src/ai/agent.js';
import { VARIANTS } from '../src/ai/soldier.js';
import { INFANTRY } from '../src/ai/capabilities.js';
import { NAV_PROFILE } from '../src/ai/nav-format.js';
import { SurfaceNav } from '../src/ai/nav.js';
import { synthetic, loadMap, addAccessCases } from './nav240/fixtures.mjs';
import { execute, canConnect } from './nav240/harness.mjs';

const f = synthetic(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
const ai = { ctx: { peek: () => f.physics }, root: new THREE.Group(), rng: new Rng(305), agents: [] };
for (const [name, variant] of Object.entries(VARIANTS)) {
  ai.variant = () => ({ geometry, materials: [material], variant, weapon: null });
  const a = new Agent(ai, { variant: name, position: new THREE.Vector3(-6, 0, -2) });
  const c = a.controller;
  assert.equal(c.radius, INFANTRY.radius * variant.scale);
  assert.equal(c.height, INFANTRY.height * variant.scale);
  assert.ok(variant.scale <= INFANTRY.maxScale, `${name}: update the bake profile for larger variants`);
  assert.ok(c.radius <= INFANTRY.navRadius);
  assert.equal(c.stepHeight, INFANTRY.stepHeight);
  assert.equal(c.slopeLimit, INFANTRY.slopeRadians, 'Agent must pass radians, not degrees');
  // Isolate the unit bug from size and movement tuning. 48 radians would mark
  // vertical walls as ground (cos(48) is negative).
  const hit = { surface: 0, object: -1 };
  c._classifyContact(1, 0, 0, hit);
  assert.equal(c.grounded, false, 'a vertical wall is not ground');
  assert.equal(c.touchingWall, true);
  c._classifyContact(Math.sin(47 * Math.PI / 180), Math.cos(47 * Math.PI / 180), 0, hit);
  assert.equal(c.grounded, true, '47 degrees is inside the infantry slope limit');
  c.grounded = false;
  c._classifyContact(Math.sin(49 * Math.PI / 180), Math.cos(49 * Math.PI / 180), 0, hit);
  assert.equal(c.grounded, false, '49 degrees is outside the infantry slope limit');
  a.crouch = true; a._move(0);
  assert.equal(c.height, INFANTRY.crouchHeight * variant.scale);
  a.crouch = false; a._move(0);
  assert.equal(c.height, a.height);
  a.dispose(); a.skeleton.dispose();
}
geometry.dispose(); material.dispose();
assert.equal(NAV_PROFILE.height, INFANTRY.height * INFANTRY.maxScale);
assert.equal(NAV_PROFILE.crouchHeight, INFANTRY.crouchHeight * INFANTRY.maxScale);
assert.equal(NAV_PROFILE.step, INFANTRY.stepHeight);

// Four independent combinations: neither a size change nor the units fix gets
// silently credited for the other. The real controller traverses authored stairs.
const map = await loadMap();
addAccessCases(map);
map.grid = await SurfaceNav.load(map.surfaceRaw, map.physics);
const direct = { query: (_from, to) => ({ outcome: 'success', points: [to.clone()] }) };
for (const scale of [1, INFANTRY.maxScale]) for (const slopeLimit of [48, INFANTRY.slopeRadians]) {
  // The old W5 approach was inside a wall shelf; don't credit depenetration
  // as a capability result. Clear approaches also cover E1's upper flights.
  for (const sample of map.cases.filter(c => /^access\/(W5|W2|E1)\/flight-/.test(c.name))) {
    const r = execute(map, direct, sample, { scale, slopeLimit });
    assert.equal(r.arrived, true, `${sample.name} scale=${scale} slope=${slopeLimit}: ${r.status}`);
    assert.equal(r.recovery.length, 0);
  }
}
// Original W4 fixture endpoints overlap facade/partition geometry. Retain those
// invalid cases, and test the actual landing between the wall and first tread.
const old = map.cases.find(c => c.name === 'W4/stairs-up');
const axis = old.to.clone().sub(old.from); axis.y = 0; axis.normalize();
const from = old.from.clone().addScaledVector(axis, .5), to = old.to.clone().addScaledVector(axis, -.3);
for (const sample of [{ from, to }, { from: to, to: from }]) {
  assert.equal(canConnect(map.physics, sample.from, sample.to), true);
  const r = execute(map, direct, sample, true);
  assert.equal(r.arrived, true, 'descent must not finish one tread above the requested floor');
  assert.equal(r.recovery.length, 0);
}
map.grid.dispose();
console.log('ok  infantry capability units, independent variants, authored stairs and floor-correct descent');
