import assert from 'node:assert/strict';

import {
  InstancedMesh,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  RenderTarget,
  Scene,
} from 'three/webgpu';
import type { Renderer } from 'three/webgpu';

import { prewarm } from '../../src/core/prewarm.ts';
import { isMesh } from '../../src/core/three-guards.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { RadioSystem } from '../../src/radio/index.ts';
import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { WorldSystem } from '../../src/world/index.ts';
import { createTestContext } from '../lib/context.ts';
import { addLifecycle, createCoreFixture } from '../lib/core-fixture.ts';
import { fixture } from '../lib/fixture.ts';

for (const failure of [null, 'compile', 'returned', 'thrown']) {
  const camera = new PerspectiveCamera();
  camera.position.set(1, 2, 3);
  const saved = camera.position.clone(),
    originalTarget = new RenderTarget();
  const quaternion = camera.quaternion.clone(),
    fov = camera.fov;
  let target: RenderTarget | null = originalTarget;
  let calls = 0,
    done = false;
  let release: (() => void) | undefined;
  const renderer = fixture<Renderer>({
    get info(): never {
      throw Error('native warmup must not read a WebGL program counter');
    },
    getRenderTarget: (): RenderTarget | null => target,
    setRenderTarget: (value): void => {
      target = value;
    },
    async compileAsync(): Promise<void> {
      calls++;
      if (failure === 'compile') throw Error('compile failure');
    },
  });
  const { engine, registry } = createCoreFixture();
  engine.camera = camera;
  engine.viewCamera = camera;
  const render = new RenderSystem();
  render.renderer = renderer;
  render.patchMaterials = (): void => {};
  engine.ctx = createTestContext({
    engine,
    camera,
    viewCamera: camera,
    scene: engine.scene,
    viewScene: engine.viewScene,
    providers: { render },
  });
  registry.add('world', new WorldSystem());
  for (const dep of WorldSystem.deps) addLifecycle(registry, dep, {});
  addLifecycle(registry, 'fixture', {
    async prewarmMaterials(): Promise<{ ok: false } | undefined> {
      assert(camera.position.equals(saved), 'hooks start at the untouched spawn camera');
      await new Promise<void>((resolve): void => {
        release = resolve;
      });
      camera.position.set(9, 8, 7);
      camera.rotation.set(0.1, 0.2, 0.3);
      camera.fov = 40;
      // FX retains an explicit compile; its rejection must still fail boot.
      await renderer.compileAsync(engine.scene, camera);
      if (failure === 'thrown') throw Error('hook failure');
      return failure === 'returned' ? { ok: false } : undefined;
    },
  });
  const pending = prewarm(engine, {
    onProgress(): void {
      done = true;
    },
  });
  assert.equal(typeof release, 'function', 'no pose/world compiles before the owning hooks');
  assert.equal(done, false, 'readiness cannot precede the awaited hook');
  assert(release);
  release();
  const result = await pending;
  assert.equal(done, true);
  assert.equal(Object.hasOwn(engine, '__prewarmHooks'), false, 'return one canonical hook report');
  assert(result.hooks);
  if (failure) {
    const report = result.hooks.fixture;
    assert(typeof report === 'object' && report !== null && 'ok' in report);
    assert.equal(report.ok, false, 'failed hooks remain available to boot diagnostics');
  }
  assert.equal(calls, 1, 'only the owning subsystem requests its compile');
  assert.deepEqual(
    Object.keys(result.hooks),
    ['fixture'],
    'world warming belongs to the render graph'
  );
  assert.equal(result.ok, failure === null, `aggregate warmup status: ${failure}`);
  assert(camera.position.equals(saved), 'restore camera even after failure');
  assert(camera.quaternion.equals(quaternion));
  assert.equal(camera.fov, fov);
  assert.equal(target, originalTarget, 'restore render target');
  originalTarget.dispose();
}

// Stage only borrowed visual assets in the real scene until the graph warmup
// settles. The graph owns target/range restoration; radio owns scene cleanup.
for (const fail of [false, true]) {
  let settle: (() => void) | undefined;
  let patches = 0,
    disposed = 0;
  const scene = new Scene(),
    sentinel = new Scene();
  scene.add(sentinel);
  const render = new RenderSystem();
  render.renderer = fixture<Renderer>({});
  render.patchMaterials = (stage): void => {
    assert(stage);
    assert.equal(stage.parent, scene);
    patches++;
    stage.traverse((mesh): void => {
      if (!isMesh(mesh)) return;
      assert(!Array.isArray(mesh.material));
      assert(mesh.material instanceof MeshStandardNodeMaterial);
      assert.equal(mesh.material.isMeshStandardNodeMaterial, true);
      mesh.geometry.addEventListener('dispose', (): void => {
        disposed++;
      });
      mesh.material.addEventListener('dispose', (): void => {
        disposed++;
      });
    });
  };
  render._warmGraph = (): ReturnType<RenderSystem['_warmGraph']> =>
    new Promise((resolve, reject): void => {
      settle = (): void => {
        if (fail) reject(Error('radio compile failure'));
        else resolve({ ms: 0, geometries: 0, frameUnchanged: true });
      };
    });
  const radio = new RadioSystem();
  radio.active = [];
  const ctx = createTestContext({ scene, providers: { render } });
  ctx.rng.float = (): never => {
    assert.fail('warmup consumed gameplay RNG');
  };
  radio.ctx = ctx;
  const task = radio.prewarmMaterials();
  assert.notEqual(radio._warmed, true, 'radio is not ready while compiling');
  assert.equal(scene.children.length, 2);
  assert.equal(patches, 1);
  assert(settle);
  settle();
  const result = await task;
  assert.deepEqual(scene.children, [sentinel]);
  assert.deepEqual(radio.active, []);
  assert.equal(disposed, 0, 'shared geometry/materials remain borrowed');
  assert.equal(radio._warmed === true, !fail);
  assert(result);
  assert.equal(result.ok, !fail, 'radio compile rejection must not become success');
}
assert.deepEqual(await new FxSystem().prewarmMaterials(), { ok: false, reason: 'no renderer' });
for (const renderer of [
  fixture<Renderer>({}),
  fixture<Renderer>({
    async compileAsync(): Promise<void> {
      throw Error('native compile rejection');
    },
  }),
]) {
  const fx = new FxSystem();
  const render = new RenderSystem();
  render.renderer = renderer;
  fx.render = render;
  fx.ctx = createTestContext();
  fx._viewAttached = true;
  for (const key of ['lit', 'add', 'motes'] satisfies (keyof FxSystem)[]) {
    fx[key] = fixture<FxSystem['lit']>({ mesh: new Mesh() });
  }
  fx.decals = fixture<FxSystem['decals']>({ mesh: new Mesh() });
  fx.shells = fixture<FxSystem['shells']>({
    mesh: new InstancedMesh(undefined, undefined, 1),
    hullMesh: new InstancedMesh(undefined, undefined, 1),
  });
  await assert.rejects(
    (): ReturnType<FxSystem['prewarmMaterials']> => fx.prewarmMaterials(),
    /compileAsync|native compile rejection/
  );
  assert.equal(fx._warmScene?.children.length, 0, 'failed FX compile detaches borrowed meshes');
}
console.log('warmup failure status, async radio readiness and restoration preserved');
