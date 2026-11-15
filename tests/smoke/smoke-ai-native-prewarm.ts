import assert from 'node:assert/strict';

import * as THREE from 'three/webgpu';

import { AiSystem, type AiVariant } from '../../src/ai/index.ts';
import { VARIANTS } from '../../src/ai/soldier.ts';
import { SoldierMaterialsNode } from '../../src/ai/textures-tsl.ts';
import type { RenderSystem } from '../../src/render/index-webgpu.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';
import { FixtureImageBitmap, installImageBitmapFixture } from '../lib/image-bitmap.ts';
import { captureMethod } from '../lib/render-fixture.ts';

// Exercise the real PNG loader and packing path before borrowing its native material.
const restoreBitmap = installImageBitmapFixture();
const saved = {
  fetch: globalThis.fetch,
  bitmap: Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap'),
  canvas: Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas'),
  dispose: captureMethod(THREE.Texture.prototype, 'dispose'),
};
let closes = 0;
const disposedTextures: THREE.Texture[] = [];
let fail = false;
let release = (): void => assert.fail('no held PNG');
const texels = [11, 22, 33, 44];
let library: SoldierMaterialsNode;
try {
  globalThis.fetch = Object.assign(
    async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
      const path = String(url);
      if (path.endsWith('manifest.json'))
        return Response.json({ sets: ['polymer'], details: ['cloth', 'nylon'] });
      if (fail && path.endsWith('-normal.png'))
        await new Promise<void>((resolve): void => {
          release = resolve;
        });
      return new Response(null, { status: fail && path.endsWith('-orm.png') ? 404 : 200 });
    },
    { preconnect: saved.fetch.preconnect }
  );
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (): Promise<ImageBitmap> => {
      const image = new FixtureImageBitmap({
        width: 1,
        height: 1,
        data: new Uint8ClampedArray(texels),
      });
      image.close = (): void => {
        assert.deepEqual(Array.from(image.data ?? []), texels, 'close each source exactly once');
        closes++;
        image.data?.fill(0);
      };
      return image;
    },
  });
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: class {
      getContext(): object {
        let image: FixtureImageBitmap;
        return {
          clearRect(): void {},
          drawImage(input: FixtureImageBitmap): void {
            image = input;
          },
          getImageData(): { data: Uint8ClampedArray | undefined } {
            return { data: image.data };
          },
        };
      }
    },
  });
  THREE.Texture.prototype.dispose = function (this: THREE.Texture): void {
    assert(!disposedTextures.includes(this), 'dispose each texture only once');
    disposedTextures.push(this);
    saved.dispose.call(this);
  };
  library = await SoldierMaterialsNode.fromCache();
  assert.equal(closes, 5, 'release decoded PNGs before returning the library');
  assert.equal(new Set(disposedTextures).size, 5, 'dispose each source texture once');
  assert(library.arrays);
  for (const [name, array] of Object.entries(library.arrays)) {
    const fallback =
      name === 'albedo'
        ? [255, 255, 255, 255]
        : name === 'orm'
          ? [255, 255, 0, 255]
          : [128, 128, 255, 255];
    assert(array.image.data);
    assert.deepEqual(
      Array.from(array.image.data),
      [...texels, ...(name === 'detail' ? texels : fallback)],
      'packed arrays retain independent bytes after PNG close clears the inputs'
    );
  }
  // A failed set still owns its decoded and outstanding sibling PNGs.
  fail = true;
  let settled = false;
  const loading = SoldierMaterialsNode.fromCache().finally((): void => {
    settled = true;
  });
  const rejection = assert.rejects(loading, /HTTP 404/);
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
  assert.equal(settled, false, 'wait for late siblings before releasing sources');
  release();
  await rejection;
  assert.equal(closes, 7, 'release both successful siblings of the failed PNG');
  assert.equal(new Set(disposedTextures).size, 7);
} finally {
  globalThis.fetch = saved.fetch;
  THREE.Texture.prototype.dispose = saved.dispose;
  restoreBitmap();
  for (const [key, descriptor] of [
    ['createImageBitmap', saved.bitmap],
    ['OffscreenCanvas', saved.canvas],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
const sourceCloses = closes;
const material = library.soldier('vanguard', ['polymer', 'glass']),
  geometry = new THREE.BoxGeometry();
let disposed = 0,
  calls = 0;
geometry.addEventListener('dispose', (): number => disposed++);
material.addEventListener('dispose', (): number => disposed++);
const scene = new THREE.Scene(),
  existing = new THREE.Object3D();
scene.add(existing);
const render = fixture<RenderSystem>({
  renderer: fixture<RenderSystem['renderer']>({}),
  _graph: null,
  patchMaterials(): void {},
  async _warmGraph(): ReturnType<RenderSystem['_warmGraph']> {
    calls++;
    assert.equal(scene.children.length, 2);
    const holder = scene.children[1],
      skins = holder.children.filter((o): o is THREE.SkinnedMesh => o instanceof THREE.SkinnedMesh);
    assert.equal(skins.length, Object.keys(VARIANTS).length);
    for (const mesh of skins) {
      assert.equal(mesh.geometry, geometry, 'borrow actual model geometry');
      assert.equal(mesh.material, material, 'one material draws all surface groups');
      assert(mesh.castShadow && mesh.receiveShadow, 'compile actual receiving/casting variants');
      assert.equal(mesh.frustumCulled, false);
    }
    return { ms: 0, geometries: 0, frameUnchanged: true };
  },
});
const ai = new AiSystem();
ai.ctx = createTestContext({ scene, camera: new THREE.PerspectiveCamera(), providers: { render } });
ai.variant = (): AiVariant => fixture<AiVariant>({ geometry, material });
ai.rng = fixture<AiSystem['rng']>({
  fork: (): never => assert.fail('warmup must not create an Agent or consume RNG'),
});

const early = await ai.prewarmMaterials();
assert.equal(early.ok, false);
assert.equal(ai._prewarmed, null);
assert.equal(calls, 0, 'init must not falsely cache prewarm before native graph creation');
render._graph = fixture<NonNullable<RenderSystem['_graph']>>({});
const warm = await ai.prewarmMaterials();
assert.equal(warm.ok, true);
assert(warm.graphWarm);
assert.equal(warm.graphWarm.frameUnchanged, true);
assert.equal(
  warm.programs,
  null,
  'unavailable WebGL program count must not claim zero native work'
);
assert.equal(await ai.prewarmMaterials(), warm);
assert.equal(calls, 1);
assert.deepEqual(scene.children, [existing]);
assert.equal(disposed, 0);
ai._prewarmed = null;
render._warmGraph = async (): Promise<never> => {
  throw new Error('intentional native warm failure');
};
const failed = await ai.prewarmMaterials();
assert.equal(failed.ok, false);
assert(failed.error);
assert.match(failed.error, /intentional native warm failure/);
assert.deepEqual(scene.children, [existing]);
assert.equal(disposed, 0, 'borrowed assets survive failure');
geometry.dispose();
library.dispose();
assert.deepEqual(closes, sourceCloses, 'final disposal never closes PNG inputs again');
console.log('AI native prewarm readiness, exact geometry ownership and failure cleanup passed');
