import assert from 'node:assert/strict';

import NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import { uniform, vec3, vec4 } from 'three/tsl';
import { Color, NodeMaterial, Texture, UniformNode } from 'three/webgpu';

import { createSurfaceNodeMaterial as create } from '../../src/materials/shader-tsl.ts';

const params = { alphaMask: false, localSpace: false };
for (const order of [
  [true, false],
  [false, true],
]) {
  const controls = { tintNode: uniform(new Color(1, 1, 1)), tileNode: uniform(1) };
  const material = create({}, { ...params, ...controls }, {});
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
    assert.equal(material.colorNode, sourceNode, 'building must not replace the source graph');
  }
  material.dispose();
}
for (const test of [
  { p: { alphaMask: true } },
  { p: { localSpace: true } },
  { p: { tintNode: vec3(1).add(1) } },
  { p: { tintNode: uniform(1).onObjectUpdate(() => 1) } },
  { p: { tintNode: uniform(1).onRenderUpdate(() => 1) } },
  { p: { tintNode: uniform(1).onFrameUpdate(() => 1) } },
  { p: { tintNode: uniform(1).onReference(() => ({})) } },
  { p: { tintNode: new (class extends UniformNode {})(1) } },
  ...['map', 'alphaMap'].map((key) => ({ props: { [key]: new Texture() } })),
  ...['transparent', 'alphaHash', 'alphaToCoverage'].map((key) => ({ props: { [key]: true } })),
  { props: { opacity: 0.5 } },
  { props: { alphaTest: 0.5 } },
  { props: { physical: true, transmission: 1 } },
  { props: { physical: true, transmissionNode: vec4(1) } },
  ...[
    'opacityNode',
    'alphaTestNode',
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
    'lightsNode',
  ].map((key) => ({ props: { [key]: vec4(1) } })),
]) {
  const material = create({}, { ...params, ...test.p }, {}, test.props);
  assert.equal(
    material.colorNode.isMemberNode,
    true,
    `ineligible surface wrapped: ${JSON.stringify(Object.keys(test.props ?? test.p))}`
  );
  material.dispose();
}
const material = create({}, params, {});
const replacement = vec4(1, 0, 0, 0.25);
material.colorNode = replacement;
assert.equal(material.colorNode, replacement, 'replaced RGBA graph must retain its ordinary route');
material.dispose();
console.log(
  'Surface shadows: both builder orders, cache/identity and alpha/custom/callback guards passed'
);
