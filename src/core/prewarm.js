import { RenderTarget } from 'three/webgpu';

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
  try {
    // Register materials before their owning hooks warm the actual native graph.
    // Pose compiles built unused fallback-light / non-graph variants.
    render.patchMaterials(engine.scene);
    render.patchMaterials(engine.viewScene);
    renderer.setRenderTarget(scratch);
    // Each subsystem can reach hidden material variants without spawning an
    // actor, altering the clock, or rendering a gameplay frame.
    for (const system of engine.registry.ordered ?? []) {
      if (engine.error) break;
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
  return { ok: Object.values(hooks).every(hook => hook.ok !== false),
    hooks, ms: Math.round(performance.now() - start) };
}
