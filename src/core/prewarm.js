import { RenderTarget } from 'three/webgpu';

// Compile at varied positions without stepping simulation or changing RNG.
const WARM_POSES = [
  { pos: [12, 1.75, 18], look: [-4, 2.2, -6] },
  { pos: [-8.5, 1.7, 3.2], look: [2, 1.6, -2] },
  { pos: [3.2, 1.35, 5], look: [1.4, 1.1, 2.2] },
  { pos: [4, 1.7, 12], look: [-6, 1.7, -4] },
];

/** Strict-WebGPU material warmup; never creates or requests a WebGL context. */
export async function prewarm(engine, { onProgress = () => {} } = {}) {
  const render = engine.ctx.peek('render');
  const renderer = render?.renderer;
  if (!renderer) return { ok: false, reason: 'no renderer' };
  const start = performance.now();
  const scratch = new RenderTarget(1, 1, { depthBuffer: false });
  const target = renderer.getRenderTarget();
  const camera = engine.camera;
  const pos = camera.position.clone(), quat = camera.quaternion.clone(), fov = camera.fov;
  const hooks = {};
  let ok = true;
  try {
    // Register TSL lighting on world and weapon materials before the first
    // compile; otherwise the pose warmup caches unbudgeted ambient variants.
    render.patchMaterials(engine.scene);
    render.patchMaterials(engine.viewScene);
    renderer.setRenderTarget(scratch);
    for (let i = 0; i < WARM_POSES.length; i++) {
      const pose = WARM_POSES[i];
      camera.position.set(...pose.pos);
      camera.lookAt(...pose.look);
      camera.updateMatrixWorld(true);
      try {
        await renderer.compileAsync(engine.scene, camera);
        await renderer.compileAsync(engine.viewScene, engine.viewCamera);
      } catch (error) {
        ok = false;
        console.warn('[prewarm] WebGPU compile failed', error);
      }
      onProgress((i + 1) / (WARM_POSES.length + 1));
    }
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    // Each subsystem can reach hidden material variants without spawning an
    // actor, altering the clock, or rendering a gameplay frame.
    for (const system of engine.registry.ordered ?? []) {
      if (typeof system.prewarmMaterials !== 'function') continue;
      const id = system.constructor.id;
      try {
        hooks[id] = (await system.prewarmMaterials(engine.ctx)) ?? { ok: true };
      } catch (error) {
        hooks[id] = { ok: false, reason: String(error?.message ?? error) };
      }
    }
    engine.__prewarmHooks = hooks;
    onProgress(1);
  } finally {
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    renderer.setRenderTarget(target ?? null);
    scratch.dispose();
  }
  return { ok: ok && Object.values(hooks).every(hook => hook.ok !== false),
    hooks, ms: Math.round(performance.now() - start) };
}
