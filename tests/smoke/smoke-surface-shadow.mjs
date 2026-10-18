import assert from 'node:assert/strict';

import WGSLNodeBuilder from 'three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js';
import { Fn, struct, uniform, vec4 } from 'three/tsl';
import {
  BoxGeometry,
  Color,
  DataTexture,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector4,
  WebGPUCoordinateSystem,
} from 'three/webgpu';

import { DEFAULT_PARAMS } from '../../src/materials/params.ts';
import { createSurfaceNodeMaterial } from '../../src/materials/shader-tsl.ts';

const stages = globalThis.GPUShaderStage;
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const textures = Array.from(
  { length: 6 },
  () => new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
);
const [albedo, normal, orm, detailAlbedo, detailNormal, macro] = textures;
const controls = {
  tintNode: uniform(new Color(1, 1, 1)),
  weatherNode: uniform(new Vector4(...DEFAULT_PARAMS.weather)),
};
let constructed = false;
const options = new Proxy(
  {
    ...DEFAULT_PARAMS,
    ...controls,
    parallax: 0.035,
    detile: 0.7,
    macroRelief: 0.1,
    vertexMasks: true,
  },
  {
    get(target, key) {
      assert.equal(constructed, false, `authoring option read after construction: ${String(key)}`);
      return target[key];
    },
  }
);
const set = new Proxy(
  { albedo, normal, orm },
  {
    get(target, key) {
      assert.equal(
        constructed,
        false,
        `texture-set record read after construction: ${String(key)}`
      );
      return target[key];
    },
  }
);
const material = createSurfaceNodeMaterial(set, options, { detailAlbedo, detailNormal, macro });
constructed = true;
const source = material.colorNode;
const geometry = new BoxGeometry(1, 1, 1);
const renderer = {
  backend: { utils: { getTextureSampleData: () => ({ primarySamples: 1 }) } },
  coordinateSystem: WebGPUCoordinateSystem,
  debug: { diagnostics: { keywords: false } },
  hasFeature: () => false,
  hasCompatibility: () => true,
  getRenderTarget: () => null,
};
function compile(root) {
  const builder = new WGSLNodeBuilder(new Mesh(geometry, material), renderer);
  builder.camera = new PerspectiveCamera();
  builder.scene = new Scene();
  builder.setShaderStage('fragment');
  const flow = builder.flowStagesNode(Fn(() => root)());
  builder.buildUpdateNodes();
  return {
    textures: new Set(
      builder
        .getBindings()
        .flatMap((g) => g.bindings)
        .map((b) => b.textureNode?.value)
        .filter(Boolean)
    ),
    code: flow.code,
  };
}
const Channels = struct({
  color: 'vec3',
  normal: 'vec3',
  rough: 'float',
  metal: 'float',
  ao: 'float',
});
// Test-only coupling control: same expressions, but one shader struct forces all
// channels to build. No legacy implementation is copied into the test/runtime.
const packed = Fn(() =>
  Channels(
    material.colorNode,
    material.normalNode,
    material.roughnessNode,
    material.metalnessNode,
    material.aoNode
  )
)();
const all = vec4(
  material.colorNode
    .mul(material.roughnessNode)
    .mul(material.aoNode)
    .add(material.normalNode)
    .add(material.metalnessNode),
  1
);
try {
  for (const roots of [
    [source.a, all],
    [all, source.a],
  ]) {
    const results = roots.map(compile);
    const alpha = roots[0] === all ? results[1] : results[0];
    const beauty = roots[0] === all ? results[0] : results[1];
    assert.deepEqual(alpha.textures, new Set([albedo, orm, detailAlbedo, macro]));
    assert.deepEqual(beauty.textures, new Set(textures));
    assert.equal(
      (beauty.code.match(/\bfor\s*\(/g) ?? []).length,
      1,
      'shared parallax must not duplicate per channel'
    );
    assert.equal(material.colorNode, source, 'building must not replace source graph identity');
  }
  assert.deepEqual(compile(packed.get('color').a).textures, new Set(textures));
  controls.tintNode.value.setRGB(0.5, 0.7, 0.9);
  assert.equal(material.colorNode, source, 'live values must not replace the graph');
  const replacement = vec4(1, 0, 0, 0.25);
  material.colorNode = replacement;
  assert.equal(material.colorNode, replacement, 'ordinary RGBA replacement remains supported');
} finally {
  material.dispose();
  geometry.dispose();
  textures.forEach((t) => t.dispose());
  if (stages === undefined) delete globalThis.GPUShaderStage;
  else globalThis.GPUShaderStage = stages;
}
console.log(
  'Surface channels: selective dependencies, shared work, builder orders, construction options and graph identity passed'
);
