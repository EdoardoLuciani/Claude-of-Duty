import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

import NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import { vec3, vec4 } from 'three/tsl';
import { NodeMaterial, Texture } from 'three/webgpu';

import { shadowColorSources } from '../../tools/lib/refresh-census.mjs';

const path = 'src/materials/shader-tsl.ts';
const file = new URL('../../' + path, import.meta.url);
let code = stripTypeScriptTypes(shadowColorSources({ [path]: readFileSync(file, 'utf8') })[path]);
code = code.replace(
  /from (['"])([^'"]+)\1/g,
  (_, _quote, p) => `from '${p.startsWith('.') ? new URL(p, file).href : import.meta.resolve(p)}'`
);
const { createSurfaceNodeMaterial: create } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const params = { alphaMask: false, localSpace: false };
for (const order of [
  [true, false],
  [false, true],
]) {
  const material = create({}, params, {});
  const sourceNode = material.colorNode;
  for (const shadow of order) {
    const actual = new NodeMaterial();
    actual.isShadowPassMaterial = shadow;
    const builder = new NodeBuilder({ material: actual }, null, null);
    builder.material = actual;
    const stack = sourceNode.getOutputNode(builder);
    assert.equal(stack.outputNode.isMemberNode === true, !shadow);
    assert.equal(stack.outputNode.isConstNode === true, shadow);
    assert.equal(sourceNode.getOutputNode(builder), stack, 'same-builder cache must be stable');
    assert.equal(material.colorNode, sourceNode, 'building must not replace source graph');
  }
}
for (const test of [
  { p: { alphaMask: true } },
  { p: { localSpace: true } },
  { p: { tintNode: vec3(1).add(1) } },
  ...['map', 'alphaMap'].map((key) => ({ props: { [key]: new Texture() } })),
  ...['transparent', 'alphaHash', 'alphaToCoverage'].map((key) => ({ props: { [key]: true } })),
  { props: { opacity: 0.5 } },
  { props: { alphaTest: 0.5 } },
  { props: { physical: true, transmission: 1 } },
  ...[
    'castShadowNode',
    'maskShadowNode',
    'maskNode',
    'positionNode',
    'depthNode',
    'castShadowPositionNode',
    'fragmentNode',
    'outputNode',
    'vertexNode',
    'contextNode',
  ].map((key) => ({ props: { [key]: vec4(1) } })),
]) {
  const material = create({}, { ...params, ...test.p }, {}, test.props);
  assert.equal(
    material.colorNode.isMemberNode,
    true,
    `ineligible material wrapped: ${JSON.stringify(Object.keys(test.props ?? test.p))}`
  );
}
const material = create({}, params, {});
const replacement = vec4(1, 0, 0, 0.25);
material.colorNode = replacement;
assert.equal(
  material.colorNode,
  replacement,
  'a replacement RGBA graph must retain its ordinary route'
);
console.log(
  'Shadow color trial: builder-local branches in both orders, stable graph/material identity, alpha/custom/map/control exclusions passed'
);
