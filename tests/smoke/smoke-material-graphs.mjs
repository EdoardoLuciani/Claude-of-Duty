import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { Fn, context, storage, vec2, vec3, vec4, float } from 'three/tsl';
import { WGSLNodeBuilder, StorageBufferAttribute } from 'three/webgpu';

import { SURFACES_TSL } from '../../src/materials/surfaces-index-tsl.ts';

// Native WGSL captured before removing redundant scalar wrappers. Pin all seven
// packed channels, including typed vector splats: spelling a splat as a JS value
// can change native constant sharing even when the resulting pixels are equal.
// Intentional surface/Three upgrades must review and refresh these baselines.
const expected = {
  concrete: '3b0926084ccacc250bcb1e3862c3bcf0629b49a52fc3bb82c83a3d67536f5c06',
  concrete_floor: '3b0926084ccacc250bcb1e3862c3bcf0629b49a52fc3bb82c83a3d67536f5c06',
  brick: '1aef05f9175f901f8b5cf7350e0ee98128df0e927986f4578308e1360e33b081',
  plaster: 'e4b28a914099fed861bd1a076c916f6a1e2628423895517174bc391d302c17ae',
  tile: '94bcfb2c04f97c71e6daf911228d17e209439e653530bc91beb6b656df19c3fa',
  asphalt: '82a7861cc0125b5de1eec29c8be0e5f6a28f1c782d8201049a57f9a0fa05214d',
  sand: '1fee45f0c34360da5d635ebaafbfd5ebd3b29a37f434dfc568d3c4eceb0aead3',
  dirt: '17e7a881af5be7101c1774e26cc13a2ab97ac9eeb52836ecbbed167c74de4307',
  gravel: '5744b8d2df227afaedb04c7a81503efbd8f49472fba65d8a380ad32f98635cbc',
  metal_rust: '57ac2d4eab3499ea1d05da168d5752d8487551b6d78a48c0dd56018b04ab308e',
  metal_painted: '1c106a083a888d53a96e78f8587eb97d019017baf09c86d8132b2adbc0ae659d',
  metal_brushed: '3010a4e778642a7f12f1a890e14c527a1965c06554f27e0269b29ae91c9ac7c3',
  corrugated: 'f5e87a0bd1c108907d86f66c7f94bf9ca6a4371ec9b0769d761c3664f696c32e',
  wood: '6f33ca3d5f1cefcc82002783b617732d38b7aae0ea2f75f71efd19ff906d7b81',
  fabric: 'e2861834a970dd8a943f8e8bc015244fa3661865d13f84f572787cc34cf2f9b8',
  burlap: '5352ce73c1bde81928f2013aa8ab2e697b4a5bccb8955df738397bc08e401263',
  foliage: '01f5002dc53da03694a7f91559bf2e0132569fbab5ec0498aa27fd9762c0bc14',
  rubber: 'f622ab0ae9f3ea5efc8aff4b31961a47dd118871ea22b81151249f864fc89dc5',
  glass: '5e14f935de449d9b77f22e86e00d6dc0206deb37e21c1043cec8d1d4aff8262f',
};
assert.deepEqual(Object.keys(SURFACES_TSL), Object.keys(expected));
for (const [name, surface] of Object.entries(SURFACES_TSL)) {
  const output = storage(new StorageBufferAttribute(7, 1), 'float', 7);
  const compute = Fn(() => {
    const s = surface(vec2(0.3, 0.6), float(2), vec3(1), vec3(0), vec4(1));
    const a = s.get('albedo');
    const channels = [
      a.x,
      a.y,
      a.z,
      ...['height', 'rough', 'metal', 'ao'].map((key) => s.get(key)),
    ];
    for (const [index, channel] of channels.entries()) output.element(index).assign(channel);
  })().compute(1);
  const builder = new WGSLNodeBuilder(null, {
    contextNode: context(),
    backend: { capabilities: { getUniformBufferLimit: () => 65536 }, compatibilityMode: false },
    debug: { diagnostics: { keywords: false } },
    hasFeature: () => false,
    getRenderTarget: () => null,
  });
  builder.compute = compute;
  builder.build();
  assert.equal(
    createHash('sha256').update(builder.computeShader).digest('hex'),
    expected[name],
    name
  );
}
console.log(
  'material graphs: all 19 native surface shaders unchanged, including every packed channel'
);
