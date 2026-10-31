// Actual ordinary vertices, independent control oracle and clone ownership.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import manifest from '../../assets/weapons/sig-mpx/manifest.json' with { type: 'json' };
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { createWeaponInspection } from '../../src/weapons/inspection.ts';
import { makeMPXModel, MPXAnimation } from '../../src/weapons/mpx.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

for (const suffix of ['glb', 'runtime.glb']) {
  const model = makeMPXModel(
    await parseGLB(
      readFileSync(new URL(`../../assets/weapons/sig-mpx/mpx.${suffix}`, import.meta.url))
    )
  );
  const animation = new MPXAnimation(model);
  const parts = [
    'receiver',
    'bolt',
    'charging_handle',
    'selector',
    'trigger',
    'stock_hinge',
    'bolt_release',
    'magazine_catch',
    'lens_cap_front',
    'lens_cap_rear',
  ];
  const surfaces = parts.map((name) => {
    const control = model.root.getObjectByName(name);
    const mesh = model.root.getObjectByName(`${name}_mesh`);
    assert.ok(mesh?.isMesh && !mesh.isSkinnedMesh, `${name}: real ordinary surface`);
    assert.equal(mesh.parent, control, `${name}: original rigid owner`);
    assert.ok(!Array.isArray(mesh.material) && mesh.geometry.groups.length === 0);
    assert.equal(mesh.geometry.attributes.skinIndex, undefined);
    assert.equal(mesh.geometry.attributes.skinWeight, undefined);
    return { mesh, control, rest: mesh.matrix.clone() };
  });
  const surface = surfaces[0].mesh;
  const actual = new THREE.Vector3(),
    expected = new THREE.Vector3();
  let maximum = 0,
    samples = 0,
    maximumNormal = 0,
    normalSamples = 0;
  function check(allVertices = false, checkNormals = true) {
    model.root.updateMatrixWorld(true);
    for (const { mesh, control, rest } of surfaces) {
      const { position, normal } = mesh.geometry.attributes;
      const matrix = new THREE.Matrix4().multiplyMatrices(control.matrixWorld, rest);
      const expectedNormal = new THREE.Matrix3().getNormalMatrix(matrix);
      const actualNormal = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const vertices = allVertices
        ? Array.from({ length: position.count }, (_, i) => i)
        : Array.from({ length: 12 }, (_, i) => Math.floor(((position.count - 1) * i) / 11));
      for (const i of vertices) {
        mesh.getVertexPosition(i, actual).applyMatrix4(mesh.matrixWorld);
        expected.fromBufferAttribute(position, i).applyMatrix4(matrix);
        const error = actual.distanceTo(expected);
        maximum = Math.max(maximum, error);
        assert.ok(
          error < (suffix === 'glb' ? 0.000001 : 0.000025),
          `${mesh.name}/${i}: vertex drift ${error}m from rigid control`
        );
        samples++;
        if (checkNormals) {
          actual.fromBufferAttribute(normal, i).applyNormalMatrix(actualNormal);
          expected.fromBufferAttribute(normal, i).applyNormalMatrix(expectedNormal);
          const error = actual.distanceTo(expected);
          maximumNormal = Math.max(maximumNormal, error);
          assert.ok(error < 0.001, 'actual normal follows independent rigid control');
          normalSamples++;
        }
      }
    }
  }
  for (const [name, info] of Object.entries(manifest.clips)) {
    for (let i = 0; i <= 20; i++) {
      animation._sample(name, (info.duration * i) / 20);
      check(true, i % 10 === 0);
    }
    for (let i = 0; i <= Math.ceil(info.duration * 240); i++) {
      animation._sample(name, Math.min(info.duration, i / 240));
      check();
    }
  }
  // Check actual carrier travel, not only helper transforms. No MECH_bolt is needed.
  animation.reset();
  const carrier = model.root.getObjectByName('bolt_mesh');
  const carrierRest = Array.from({ length: carrier.geometry.attributes.position.count }, (_, i) =>
    carrier.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(carrier.matrixWorld)
  );
  animation.fire();
  animation.update(0.1, null, 0, true);
  for (let i = 0; i < carrierRest.length; i++) {
    carrier.getVertexPosition(i, actual).applyMatrix4(carrier.matrixWorld);
    expected.copy(carrierRest[i]).add(new THREE.Vector3(0, 0, 0.038));
    assert.ok(actual.distanceTo(expected) < 1e-9, 'actual carrier locks back exactly 38mm');
  }
  animation.reset();
  for (let i = 0; i < carrierRest.length; i++) {
    carrier.getVertexPosition(i, actual).applyMatrix4(carrier.matrixWorld);
    assert.ok(
      actual.distanceTo(carrierRest[i]) < 1e-9,
      'actual carrier reset ignores mixer caches'
    );
  }
  // Out-of-band empty lockback/reset must affect visible carrier vertices too.
  for (const clip of ['inspect', 'draw', 'holster', null]) {
    animation.fire();
    animation.update(0.1, clip, 0.1, true);
    check();
    animation.reset();
    check();
  }
  for (const tag of ['front', 'rear']) {
    const pivot = model.root.getObjectByName(`lens_cap_${tag}`);
    const q = pivot.quaternion.clone();
    for (const angle of [0.3, -0.6, 0.9]) {
      pivot.quaternion
        .copy(q)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle));
      check(true);
    }
    pivot.quaternion.copy(q);
  }
  animation.reset();

  const optical = [...model.materials].find((material) => material.transparent);
  assert.equal(optical.specularIntensity, 0.03);
  assert.equal(optical.envMapIntensity, 0.05);
  assert.equal(optical.side, THREE.DoubleSide);
  assert.equal(optical.depthWrite, false);
  assert.equal(optical.forceSinglePass, true);
  assert.equal(optical.opacity, 0.02);
  assert.equal(optical.clearcoat, 0.25);
  assert.equal(optical.opacityNode, null, 'body lenses need no cap/lens role selector');
  assert.equal(optical.clearcoatNode, null);
  let opticalObjects = 0;
  model.root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.material !== optical) return;
    opticalObjects++;
    assert.ok(!mesh.isSkinnedMesh);
    assert.equal(mesh.name, 'receiver_optical', 'only body lenses remain transparent');
  });
  assert.equal(opticalObjects, 1);
  assert.equal(surface.material.transparent, false);
  assert.equal(
    surface.material.side,
    THREE.DoubleSide,
    'retain the existing opaque material policy'
  );
  // Both sides of each closed lid must really cover its aperture, not just a
  // double-sided material flag. Cast against actual ordinary cap triangles.
  for (const tag of ['front', 'rear']) {
    const pivot = model.root.getObjectByName(`lens_cap_${tag}`);
    const q = pivot.quaternion.clone();
    pivot.quaternion.identity();
    model.root.updateMatrixWorld(true);
    const cap = model.root.getObjectByName(`lens_cap_${tag}_mesh`);
    const indices = cap.geometry.index;
    const triangles = [];
    for (let i = 0; i < indices.count; i += 3) {
      triangles.push(
        [0, 1, 2].map((offset) =>
          cap
            .getVertexPosition(indices.getX(i + offset), new THREE.Vector3())
            .applyMatrix4(cap.matrixWorld)
        )
      );
    }
    assert.ok(triangles.length > 0, `${tag}: cap remains owned by its original opaque frame`);
    for (const side of [-1, 1])
      for (const [x, y] of [
        [0, 0],
        [0.008, 0],
        [-0.008, 0],
        [0, 0.008],
        [0, -0.008],
      ]) {
        const ray = new THREE.Ray(
          new THREE.Vector3(x, 0.0129 + y, side * 0.02).applyMatrix4(pivot.matrixWorld),
          new THREE.Vector3(0, 0, -side).transformDirection(pivot.matrixWorld)
        );
        assert.ok(
          triangles.some(([a, b, c]) => ray.intersectTriangle(a, b, c, true, new THREE.Vector3())),
          `${suffix}/${tag}: closed opaque lid obstructs aperture from side ${side}`
        );
      }
    pivot.quaternion.copy(q);
  }
  model.root.updateMatrixWorld(true);

  // The transferred/dropped body and rounds have not moved into the skin.
  assert.ok(animation.magazineBody.isMesh && !animation.magazineBody.isSkinnedMesh);
  assert.equal(animation.magazineBody.parent, animation.magazine);
  animation.rounds.traverse((node) => {
    if (node.isMesh) assert.ok(!node.isSkinnedMesh);
  });
  const magazineGeometry = animation.magazineBody.geometry;
  assert.ok(
    magazineGeometry.attributes.position.count > 1000,
    'real complete dropped-mag geometry'
  );
  const dropped = animation.magazineBody.clone();
  assert.equal(dropped.geometry, magazineGeometry);
  assert.equal(dropped.children.length, 0, 'loaded rounds never transfer with the dropped shell');

  let geometryDisposed = 0,
    materialDisposed = 0;
  const geometries = new Set(),
    materials = new Set();
  model.root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    assert.ok(!mesh.isSkinnedMesh, 'no gameplay skeleton allocation');
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
  });
  for (const geometry of geometries) geometry.addEventListener('dispose', () => geometryDisposed++);
  for (const material of materials) material.addEventListener('dispose', () => materialDisposed++);
  const def = { ...WEAPON_DEFS.smg, cycleTime: 60 / WEAPON_DEFS.smg.rpm };
  const idleModel = makeMPXModel(
    await parseGLB(
      readFileSync(new URL(`../../assets/weapons/sig-mpx/mpx.${suffix}`, import.meta.url))
    )
  );
  const idleAnimation = new MPXAnimation(idleModel);
  const idleInspection = createWeaponInspection({ model: idleModel, def });
  const idleSurface = idleInspection.scene.getObjectByName('bolt_mesh');
  const boltMesh = model.root.getObjectByName('bolt_mesh');
  const carrierVertices = Array.from(
    { length: boltMesh.geometry.attributes.position.count },
    (_, i) => i
  );
  assert.ok(carrierVertices.length > 0, 'real carrier vertices belong to the bolt control');
  let maximumInspection = 0;
  for (const pose of ['lockback', 'reloadEmpty']) {
    animation.reset();
    if (pose === 'lockback') {
      animation.fire();
      animation.update(0.1, null, 0, true, false);
    } else animation.update(0, 'reloadEmpty', 0.8, true, false);
    const livePosition = animation.bolt.position.clone();
    const inspection = createWeaponInspection({ model, def });
    const previewSurface = inspection.scene.getObjectByName('bolt_mesh');
    assert.notEqual(previewSurface, boltMesh);
    assert.equal(previewSurface.geometry, boltMesh.geometry, 'inspection borrows live geometry');
    assert.equal(previewSurface.material, boltMesh.material, 'inspection borrows live material');
    for (const i of carrierVertices) {
      previewSurface.getVertexPosition(i, actual).applyMatrix4(previewSurface.matrixWorld);
      idleSurface.getVertexPosition(i, expected).applyMatrix4(idleSurface.matrixWorld);
      const error = actual.distanceTo(expected);
      maximumInspection = Math.max(maximumInspection, error);
      assert.ok(
        error < 1e-9,
        `${suffix}/${pose}: inspection carrier drift ${error}m from fresh Idle`
      );
    }
    for (const name of ['bolt']) {
      const preview = inspection.scene.getObjectByName(name);
      const idle = idleInspection.scene.getObjectByName(name);
      assert.ok(
        preview.matrixWorld.elements.every(
          (value, i) => Math.abs(value - idle.matrixWorld.elements[i]) < 1e-9
        ),
        `${suffix}/${pose}/${name}: inspection transform must match fresh Idle`
      );
    }
    inspection.dispose();
    assert.equal(geometryDisposed, 0, 'inspection never disposes borrowed geometry');
    assert.equal(materialDisposed, 0, 'inspection never disposes borrowed materials');
    assert.ok(animation.bolt.position.equals(livePosition));
  }
  idleInspection.dispose();
  idleAnimation.dispose();
  animation.dispose();
  assert.equal(geometryDisposed, 0, 'animation teardown preserves loader-owned geometry');
  assert.equal(materialDisposed, materials.size, 'gameplay materials disposed exactly once');
  console.log(
    `MPX ${suffix}: ${samples} actual ordinary-vertex/control samples, max ${(maximum * 1000).toFixed(6)}mm; ${normalSamples} moving normal samples, max vector error ${maximumNormal}; lockback/reload inspection carrier drift ${maximumInspection}m; exact optical alpha/coating, independent moving caps, magazine ownership and inspection/material disposal passed`
  );
}
