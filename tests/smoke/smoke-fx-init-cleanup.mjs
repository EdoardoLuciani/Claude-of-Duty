import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FxSystem } from '../../src/fx/index.ts';
import { Rng } from '../../src/core/rng.ts';

const fetch = globalThis.fetch,
  bitmap = globalThis.createImageBitmap,
  loadAsync = GLTFLoader.prototype.loadAsync;
try {
  const fetched = [],
    registered = [];
  let decoded = 0,
    hullLoads = 0;
  globalThis.fetch = async (url) => {
    fetched.push(url);
    return { ok: true, blob: async () => new Blob([url]) };
  };
  globalThis.createImageBitmap = async () => {
    decoded++;
    return { close() {} };
  };
  const hullError = new Error('hull HTTP 404');
  GLTFLoader.prototype.loadAsync = async function (url) {
    hullLoads++;
    assert.equal(url, '/models/fx/spent12g.glb');
    assert.equal(decoded, 4, 'required atlases loaded before hull request');
    throw hullError;
  };
  const scene = new THREE.Scene(),
    viewScene = new THREE.Scene();
  const render = {
    addLight(light) {
      registered.push(light);
    },
  };
  const fx = new FxSystem();
  await assert.rejects(
    fx.init({
      scene,
      viewScene,
      config: { q: {} },
      rng: new Rng(410),
      peek: (id) => (id === 'render' ? render : null),
      events: {
        on() {
          assert.fail('hull failure must not install gameplay listeners');
        },
      },
    }),
    (error) => error === hullError,
    'original required hull failure remains terminal'
  );
  assert.equal(fetched.length, 4);
  assert(fetched.every((url) => url.startsWith('/models/proc/fx-') && url.endsWith('.png')));
  assert.equal(hullLoads, 1, 'no hull retry or fallback');
  assert.equal(fx.shells, undefined, 'no substitute casing pool');
  assert.equal(fx.ambience, undefined, 'initialization stops at the failed hull load');
  assert.equal(registered.length, 4);
  assert(registered.every((light) => light.parent === scene));

  const layers = [fx.lit, fx.add, fx.motes, fx.viewAdd, fx.viewLit, fx.hazeSys.layer];
  const resources = [
    ...layers.flatMap((layer) => [layer.geometry, layer.material]),
    fx.decals.geometry,
    fx.decals.material,
    fx.hazeSys.distortTexNode,
    fx._atlas.texture,
    fx._decalAtlas.albedo,
    fx._decalAtlas.normal,
    fx._decalAtlas.orm,
    ...registered,
  ];
  const disposed = new Map(resources.map((resource) => [resource, 0]));
  for (const resource of resources)
    resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
  assert.doesNotThrow(() => fx.dispose(), 'real FX teardown must finish after hull rejection');
  for (const resource of resources)
    assert.equal(
      disposed.get(resource),
      1,
      `${resource.name || resource.type} disposed exactly once`
    );
  assert.equal(fx.lights.lights.length, 0);
  assert(
    registered.every((light) => light.parent === null),
    'all registered lights detached'
  );
  assert.equal(scene.children.length, 0, 'world particle/decal layers and lights detached');
  assert.equal(viewScene.children.length, 0);
  assert.equal(fx.viewLights, null);
} finally {
  globalThis.fetch = fetch;
  globalThis.createImageBitmap = bitmap;
  GLTFLoader.prototype.loadAsync = loadAsync;
}
console.log(
  'FX hull rejection preserves the original error without fallback; real teardown releases atlas, particle/decal/haze resources and lights'
);
