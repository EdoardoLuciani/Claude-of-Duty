import { RenderTarget } from 'three/webgpu';

import type { Engine } from './engine.ts';

/** Strict-WebGPU material warmup; never creates or requests a WebGL context. */
export async function prewarm(
  engine: Engine,
  { onProgress = (): void => {} }: { onProgress?: (progress: number) => void } = {}
): Promise<
  | { ok: boolean; reason: string; hooks?: undefined; ms?: undefined }
  | { ok: boolean; hooks: Record<string, unknown>; ms: number; reason?: undefined }
> {
  const render = engine.ctx.peek('render');
  const renderer = render?.renderer;
  if (!renderer) return { ok: false, reason: 'no renderer' };
  const start = performance.now();
  const scratch = new RenderTarget(1, 1, { depthBuffer: false });
  const target = renderer.getRenderTarget();
  const camera = engine.camera;
  const pos = camera.position.clone(),
    quat = camera.quaternion.clone(),
    fov = camera.fov;
  const hooks: Record<string, unknown> = {};
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
      // Real registry entries validate metadata at registration. Isolated warmup
      // fixtures can omit it; preserve the original property-key coercion.
      const id = String('id' in system.constructor ? system.constructor.id : undefined);
      try {
        hooks[id] = (await system.prewarmMaterials(engine.ctx)) ?? { ok: true };
      } catch (error) {
        const message =
          typeof error === 'object' && error !== null && 'message' in error ? error.message : error;
        hooks[id] = { ok: false, reason: String(message ?? error) };
      }
    }
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
  return {
    ok: Object.values(hooks).every(
      (hook): boolean =>
        !(typeof hook === 'object' && hook !== null && 'ok' in hook && hook.ok === false)
    ),
    hooks,
    ms: Math.round(performance.now() - start),
  };
}
