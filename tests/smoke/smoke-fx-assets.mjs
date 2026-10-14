import assert from 'node:assert/strict';
import { Texture } from 'three';
import { loadFxAtlases } from '../../src/fx/atlas.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { Rng } from '../../src/core/rng.ts';

const fetch = globalThis.fetch,
  bitmap = globalThis.createImageBitmap,
  dispose = Texture.prototype.dispose;
try {
  for (const failure of [null, 'http', 'decode']) {
    let closed = 0,
      disposed = 0,
      decodes = 0;
    Texture.prototype.dispose = function () {
      disposed++;
      dispose.call(this);
    };
    globalThis.fetch = async (url) => ({
      ok: !(failure === 'http' && url.includes('normal')),
      status: 404,
      blob: async () => new Blob([url]),
    });
    globalThis.createImageBitmap = async (blob) => {
      decodes++;
      if (failure === 'decode' && (await blob.text()).includes('normal'))
        throw Error('invalid atlas');
      return {
        close() {
          closed++;
        },
      };
    };
    if (failure) {
      await assert.rejects(
        loadFxAtlases(512),
        failure === 'http' ? /normal.*HTTP 404/ : /invalid atlas/
      );
      assert.equal(disposed, 3, 'release all successfully loaded textures on partial failure');
      assert.equal(closed, 3, 'release their owned decoded bitmaps');
    } else {
      const atlases = await loadFxAtlases(512);
      assert.equal(atlases.particles.cols, 4);
      assert.equal(atlases.decals.size, 512);
      for (const texture of [
        atlases.particles.texture,
        atlases.decals.albedo,
        atlases.decals.normal,
        atlases.decals.orm,
      ]) {
        texture.dispose();
        texture.source.data.close();
      }
    }
    assert.equal(decodes, failure === 'http' ? 3 : 4, 'all loaders settle before returning');
  }
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const fx = new FxSystem();
  await assert.rejects(
    fx.init({ config: { q: {} }, rng: new Rng(12), peek: () => null }),
    /fx-particles-512.png: HTTP 404/
  );
  assert.equal(fx._atlas, undefined, 'FX initialization never creates substitute atlases');
} finally {
  globalThis.fetch = fetch;
  globalThis.createImageBitmap = bitmap;
  Texture.prototype.dispose = dispose;
}
console.log(
  'Required FX atlases reject HTTP/decode failures and release partial loads without recovery'
);
