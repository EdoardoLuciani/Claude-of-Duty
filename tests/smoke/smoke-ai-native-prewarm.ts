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
const images: FixtureImageBitmap[] = [];
const closes = new Map<FixtureImageBitmap, number>();
const disposedTextures: THREE.Texture[] = [];
let failedPath = '',
  mismatched = '';
let held = '';
let release = (): void => assert.fail('no held PNG');
const texels = [11, 22, 33, 44, 55, 66, 77, 88];
const stats = { polymer: { mean: 0.5, was: 0.6, min: 0.1, max: 0.9, sd: 0.2 } };
let library: SoldierMaterialsNode;
try {
  globalThis.fetch = Object.assign(
    async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
      assert(typeof url === 'string');
      const path = url;
      if (path.endsWith('manifest.json'))
        return Response.json({
          sets: ['polymer', 'steel'],
          details: ['cloth', 'nylon'],
          camoStats: stats,
        });
      if (path.endsWith(held) && held)
        await new Promise<void>((resolve): void => {
          release = resolve;
        });
      return new Response(path, { status: failedPath && path.endsWith(failedPath) ? 404 : 200 });
    },
    { preconnect: saved.fetch.preconnect }
  );
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (blob: Blob): Promise<ImageBitmap> => {
      const path = await blob.text();
      const image = new FixtureImageBitmap({
        width: mismatched && path.endsWith(mismatched) ? 1 : 2,
        height: 1,
        data: new Uint8ClampedArray(texels),
      });
      image.close = (): void => {
        closes.set(image, (closes.get(image) ?? 0) + 1);
        image.data?.fill(0);
      };
      images.push(image);
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
            assert(!closes.has(input), 'packing must precede source release');
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
    disposedTextures.push(this);
    saved.dispose.call(this);
  };
  const checkSources = (count: number): void => {
    assert.equal(images.length, count);
    for (const image of images) {
      assert.equal(closes.get(image), 1, 'each decoded PNG closes once');
      assert.equal(disposedTextures.filter((t): boolean => t.image === image).length, 1);
    }
  };
  library = await SoldierMaterialsNode.fromCache();
  checkSources(8);
  assert.deepEqual(library.camoStats, stats);
  assert.deepEqual(
    [...library.layers],
    [
      ['polymer', 0],
      ['steel', 1],
      ['glass', 2],
    ]
  );
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
      [...texels, ...texels, ...(name === 'detail' ? [] : [...fallback, ...fallback])],
      'packed bytes survive closing and clearing their PNG inputs'
    );
    assert.equal(array.flipY, false);
    assert.equal(array.anisotropy, 8);
  }
  // Both the set phase and detail phase must drain successes after a sibling fails.
  for (const [failure, late, count] of [
    ['ai-polymer-orm.png', 'ai-steel-normal.png', 5],
    ['ai-detail-cloth.png', 'ai-detail-nylon.png', 7],
  ] as const) {
    images.length = disposedTextures.length = 0;
    failedPath = failure;
    held = late;
    let settled = false;
    const loading = SoldierMaterialsNode.fromCache().finally((): void => {
      settled = true;
    });
    const rejection = assert.rejects(loading, /HTTP 404/);
    await new Promise<void>((resolve): void => {
      setImmediate(resolve);
    });
    assert.equal(settled, false, 'failure waits for outstanding PNG loads');
    release();
    await rejection;
    checkSources(count);
    assert.equal(
      disposedTextures.filter((t): boolean => t instanceof THREE.DataArrayTexture).length,
      0
    );
  }
  failedPath = held = '';
  for (const [badLayer, partials] of [
    ['ai-steel-orm.png', 1],
    ['ai-steel-normal.png', 2],
    ['ai-detail-nylon.png', 3],
  ] as const) {
    images.length = disposedTextures.length = 0;
    mismatched = badLayer;
    await assert.rejects(SoldierMaterialsNode.fromCache(), /matching dimensions/);
    checkSources(8);
    const arrays = disposedTextures.filter((t): boolean => t instanceof THREE.DataArrayTexture);
    assert.equal(arrays.length, partials, 'dispose every array packed before the failure');
    assert.equal(new Set(arrays).size, partials, 'partial arrays dispose once');
  }
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
const sourceCloses = [...closes.values()];
const material = library.soldier('vanguard', ['polymer', 'steel', 'glass']),
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
assert.deepEqual(
  [...closes.values()],
  sourceCloses,
  'final disposal never closes PNG inputs again'
);
console.log('AI native prewarm readiness, exact geometry ownership and failure cleanup passed');
