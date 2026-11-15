import assert from 'node:assert/strict';

import { Fn, context, storage, vec2, vec3, vec4, float } from 'three/tsl';
import {
  WebGPUCoordinateSystem,
  WGSLNodeBuilder,
  StorageBufferAttribute,
  Object3D,
  Node,
  type Renderer,
  type Backend,
} from 'three/webgpu';

import { SURFACES_TSL } from '../../src/materials/surfaces-index-tsl.ts';
import { fixture } from '../lib/fixture.ts';

// Build every procedural surface through the native WGSL compiler without a GPU.
function hasBuild(value: object): value is { build(): void } {
  return 'build' in value && typeof value.build === 'function';
}
for (const surface of Object.values(SURFACES_TSL)) {
  const output = storage(new StorageBufferAttribute(7, 1), 'float', 7);
  const compute = Fn((): void => {
    const s = surface(vec2(0.3, 0.6), float(2), vec3(1), vec3(0), vec4(1));
    const a = s.get('albedo');
    assert('x' in a && a.x instanceof Node);
    assert('y' in a && a.y instanceof Node);
    assert('z' in a && a.z instanceof Node);
    const channels = [
      a.x,
      a.y,
      a.z,
      ...['height', 'rough', 'metal', 'ao'].map((key): Node => s.get(key)),
    ];
    for (const [index, channel] of channels.entries()) output.element(index).assign(channel);
  })().compute(1);
  const builder = new WGSLNodeBuilder(
    new Object3D(),
    fixture<Renderer>({
      coordinateSystem: WebGPUCoordinateSystem,
      contextNode: context(),
      backend: fixture<
        Backend & { capabilities: { getUniformBufferLimit(): number }; compatibilityMode: boolean }
      >({ capabilities: { getUniformBufferLimit: (): number => 65536 }, compatibilityMode: false }),
      debug: fixture<Renderer['debug']>({ diagnostics: { keywords: false } }),
      hasFeature: (): boolean => false,
      getRenderTarget: (): null => null,
    })
  );
  builder.compute = compute;
  assert(hasBuild(builder));
  builder.build();
  assert('computeShader' in builder && typeof builder.computeShader === 'string');
  assert(builder.computeShader.length > 0);
}
console.log('material graphs: every packed surface channel compiles to native WGSL');
