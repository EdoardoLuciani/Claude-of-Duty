// Actual rigid-influence vertices, independent control oracle and clone ownership.
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
  const surface = model.root.getObjectByName('MPX_surface');
  assert.ok(surface.isSkinnedMesh);
  assert.ok(!Array.isArray(surface.material) && surface.geometry.groups.length === 0);
  const { position, normal, skinIndex, skinWeight } = surface.geometry.attributes;
  const controls = surface.skeleton.bones.map((bone) =>
    model.root.getObjectByName(bone.name.replace(/^(MECH|FRAME)_/, ''))
  );
  const rest = controls.map((control, joint) =>
    control.matrixWorld
      .clone()
      .invert()
      .multiply(surface.skeleton.bones[joint].matrixWorld)
      .multiply(surface.skeleton.boneInverses[joint])
      .multiply(surface.bindMatrix)
  );
  const byJoint = controls.map(() => []);
  for (let i = 0; i < position.count; i++) {
    assert.deepEqual(
      [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)],
      [1, 0, 0, 0]
    );
    byJoint[skinIndex.getX(i)].push(i);
  }
  assert.ok(
    byJoint.filter((vertices) => vertices.length > 0).length === 10,
    'ten mesh frames own real surface vertices; control parents preserve local interpolation'
  );
  const denseVertices = byJoint
    .filter((vertices) => vertices.length > 0)
    .flatMap((vertices) =>
      Array.from({ length: 12 }, (_, i) => vertices[Math.floor(((vertices.length - 1) * i) / 11)])
    );
  const matrices = controls.map(() => new THREE.Matrix4());
  const expectedNormals = controls.map(() => new THREE.Matrix3());
  const actualNormals = controls.map(() => new THREE.Matrix3());
  const skinMatrix = new THREE.Matrix4();
  const actual = new THREE.Vector3(),
    expected = new THREE.Vector3();
  let maximum = 0,
    samples = 0,
    maximumNormal = 0,
    normalSamples = 0;
  function check(vertices, checkNormals = true) {
    model.root.updateMatrixWorld(true);
    for (let j = 0; j < controls.length; j++) {
      matrices[j].multiplyMatrices(controls[j].matrixWorld, rest[j]);
      if (checkNormals) {
        expectedNormals[j].getNormalMatrix(matrices[j]);
        skinMatrix
          .copy(surface.matrixWorld)
          .multiply(surface.bindMatrixInverse)
          .multiply(surface.skeleton.bones[j].matrixWorld)
          .multiply(surface.skeleton.boneInverses[j])
          .multiply(surface.bindMatrix);
        actualNormals[j].getNormalMatrix(skinMatrix);
      }
    }
    for (const i of vertices) {
      surface.getVertexPosition(i, actual).applyMatrix4(surface.matrixWorld);
      expected.fromBufferAttribute(position, i).applyMatrix4(matrices[skinIndex.getX(i)]);
      const error = actual.distanceTo(expected);
      maximum = Math.max(maximum, error);
      assert.ok(
        error < (suffix === 'glb' ? 0.000001 : 0.000025),
        `${animation.name}/${i}: skinned vertex drift ${error}m from actual control`
      );
      samples++;
      if (checkNormals) {
        const joint = skinIndex.getX(i);
        actual.fromBufferAttribute(normal, i).applyNormalMatrix(actualNormals[joint]);
        expected.fromBufferAttribute(normal, i).applyNormalMatrix(expectedNormals[joint]);
        const normalError = actual.distanceTo(expected);
        maximumNormal = Math.max(maximumNormal, normalError);
        assert.ok(normalError < 0.001, 'actual skinned normal follows independent rigid control');
        normalSamples++;
      }
    }
  }
  const allVertices = Array.from({ length: position.count }, (_, i) => i);
  for (const [name, info] of Object.entries(manifest.clips)) {
    for (let i = 0; i <= 20; i++) {
      animation._sample(name, (info.duration * i) / 20);
      check(allVertices, i % 10 === 0);
    }
    for (let i = 0; i <= Math.ceil(info.duration * 240); i++) {
      animation._sample(name, Math.min(info.duration, i / 240));
      check(denseVertices);
    }
  }
  // Out-of-band empty lockback/reset must affect visible carrier vertices too.
  for (const clip of ['inspect', 'draw', 'holster', null]) {
    animation.fire();
    animation.update(0.1, clip, 0.1, true);
    check(denseVertices);
    animation.reset();
    check(denseVertices);
  }
  for (const tag of ['front', 'rear']) {
    const pivot = model.root.getObjectByName(`lens_cap_${tag}`);
    const q = pivot.quaternion.clone();
    for (const angle of [0.3, -0.6, 0.9]) {
      pivot.quaternion
        .copy(q)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle));
      check(allVertices);
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
  // Evaluate the actual small TSL conditionals at every optical vertex, not a
  // separate test-only spelling of the alpha/clearcoat selection formula.
  function evaluate(node, uv1) {
    if (node.isConstNode) return node.value;
    if (node.isAttributeNode || node.getAttributeName?.() === 'uv1') return uv1;
    if (node.isSplitNode) return evaluate(node.node, uv1)[{ x: 0, y: 1 }[node.components]];
    if (node.isOperatorNode && node.op === '>=')
      return evaluate(node.aNode, uv1) >= evaluate(node.bNode, uv1);
    if (node.condNode)
      return evaluate(evaluate(node.condNode, uv1) ? node.ifNode : node.elseNode, uv1);
    throw new Error(`Unexpected MPX optical node ${node.constructor.name}`);
  }
  let sheets = 0;
  model.root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.material !== optical) return;
    sheets++;
    assert.ok(
      !mesh.isSkinnedMesh,
      'independent optical sorting stays rigid, outside the opaque skin'
    );
    const cap = mesh.name.startsWith('lens_cap_');
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const uv1 = [mesh.geometry.attributes.uv1.getX(i), mesh.geometry.attributes.uv1.getY(i)];
      assert.equal(evaluate(optical.opacityNode, uv1), cap ? 0.01 : 0.02);
      assert.equal(evaluate(optical.clearcoatNode, uv1), cap ? 0 : 0.25);
    }
  });
  assert.equal(sheets, 3, 'body lenses and two independently sorted moving covers');

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

  surface.skeleton.computeBoneTexture();
  const liveTexture = surface.skeleton.boneTexture;
  let liveDisposed = 0,
    previewDisposed = 0;
  liveTexture.addEventListener('dispose', () => liveDisposed++);
  const def = { ...WEAPON_DEFS.smg, cycleTime: 60 / WEAPON_DEFS.smg.rpm };
  animation.update(0, 'reloadEmpty', 0.8, true, false);
  const livePosition = animation.bolt.position.clone();
  const inspection = createWeaponInspection({ model, def });
  const previewSurface = inspection.scene.getObjectByName('MPX_surface');
  assert.notEqual(previewSurface.skeleton, surface.skeleton);
  assert.ok(previewSurface.skeleton.bones.every((bone) => !surface.skeleton.bones.includes(bone)));
  previewSurface.skeleton.computeBoneTexture();
  assert.notEqual(previewSurface.skeleton.boneTexture, liveTexture);
  previewSurface.skeleton.boneTexture.addEventListener('dispose', () => previewDisposed++);
  inspection.dispose();
  assert.equal(previewDisposed, 1, 'inspection bone texture disposed exactly once');
  assert.equal(liveDisposed, 0);
  assert.ok(animation.bolt.position.equals(livePosition));
  animation.dispose();
  assert.equal(liveDisposed, 1, 'gameplay bone texture released with animation');
  console.log(
    `MPX ${suffix}: ${samples} actual skinned-vertex/control samples, max ${(maximum * 1000).toFixed(6)}mm; ${normalSamples} moving normal samples, max vector error ${maximumNormal}; exact optical alpha/coating, independent moving caps, magazine ownership and inspection/skeleton disposal passed`
  );
}
