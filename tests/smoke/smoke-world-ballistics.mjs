#!/usr/bin/env node
/** Solid/material metadata survives batching, cooking and committed GLB loading. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Accum } from '../../tools/worldgen/util.js';
import { buildCollision } from '../../tools/worldgen/pack.js';
import { PhysicsSystem } from '../../src/physics/index.js';
import { loadMap } from '../../tools/nav240/fixtures.mjs';

// Warping a face splits its positional seams. Authoring IDs, not a runtime
// connected-components guess, must still pair that face with its own exit.
const acc = new Accum();
for (const x of [2, 4]) {
  const box = new THREE.BoxGeometry(.08, 3, 3);
  const p = box.getAttribute('position'), n = box.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getX(i)) > .5) p.setX(i, p.getX(i) + .005);
  }
  acc.add(box, new THREE.Matrix4().makeTranslation(x, 1, 0));
}
const visual = new THREE.Scene();
const mesh = new THREE.Mesh(acc.build());
mesh.userData.surface = 'wood'; visual.add(mesh);
const cooked = await buildCollision(visual);
const physics = new PhysicsSystem();
physics.addStaticGroup(cooked.scene); physics.rebuildStatic();
const shot = physics.fireBullet({ origin: new THREE.Vector3(0, 1, 0), dir: new THREE.Vector3(1, 0, 0),
  penetration: 1, damage: 40, maxDist: 10, emit: false });
assert.equal(shot.impacts.filter(i => !i.exit).length, 2);
assert.equal(shot.impacts.filter(i => i.exit).length, 2, 'warped kit solids retain measurable exits');
for (let i = 0; i < shot.impacts.length; i += 2) {
  assert.ok(Math.abs(shot.impacts[i + 1].distance - shot.impacts[i].distance - .08) < .001);
}

const map = await loadMap();
let merged = 0, sandbags = 0, clothSheets = 0;
for (const o of map.physics.staticWorld.objects) {
  if (!o) continue;
  const g = o.mesh.geometry;
  const ids = g.getAttribute('_solid');
  assert.ok(ids, `${o.name}: GLB preserved solid IDs`);
  assert.equal(ids.count, g.getAttribute('position').count);
  assert.ok(Number.isInteger(o.ballisticSurface));
  assert.ok(o.sheetThickness >= 0);
  if (o.name.includes('sandbag')) {
    sandbags++;
    assert.equal(o.surface, map.physics.SURFACE.fabric);
    assert.equal(o.ballisticSurface, map.physics.SURFACE.sand);
    assert.equal(o.sheetThickness, 0, 'filled bags cannot use a cloth-sheet fallback');
  } else if (o.surface === map.physics.SURFACE.fabric && o.sheetThickness > 0) clothSheets++;
  const components = new Set();
  for (let i = 0; i < g.index.count; i += 3) {
    const a = ids.getX(g.index.getX(i)), b = ids.getX(g.index.getX(i + 1)), c = ids.getX(g.index.getX(i + 2));
    assert.ok(Number.isInteger(a) && a >= 0);
    assert.equal(a, b, `${o.name}: simplification must not bridge authored solids`);
    assert.equal(a, c);
    components.add(a);
  }
  if (components.size > 1) merged++;
}
assert.ok(merged > 0, 'merged meshes retain multiple distinct solids');
assert.ok(sandbags > 0 && clothSheets > 0, 'sandbag fill and hanging cloth have different ballistic structure');
const origin = new THREE.Vector3(2.5, 1.6, 6);
const dir = new THREE.Vector3(-1.8, 1.5, 9).sub(origin).normalize();
const hit = map.physics.raycast(origin, dir, 40, map.physics.MASK.BULLET);
assert.equal(hit.surface, 'plaster');
assert.equal(hit.ballisticSurfaceIndex, map.physics.SURFACE.concrete, 'production facade is plaster-covered masonry');
const facade = map.physics.fireBullet({ origin, dir, damage: 17, penetration: .9, maxDist: 200, emit: false });
assert.equal(facade.stopReason, 'blocked');
assert.equal(facade.impacts.length, 1, 'production masonry protects cover without an artificial exit');
assert.equal(facade.impacts[0].surface, 'plaster');
console.log('smoke-world-ballistics: ok');
