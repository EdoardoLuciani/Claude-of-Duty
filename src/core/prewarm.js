/**
 * Shader pre-warm.
 *
 * WHY THIS EXISTS — measured, not guessed. Profiling actual gameplay at Retina
 * DPR showed 86 WebGL programs compiling lazily *during play*, with up to 30
 * landing on a single frame. Each of those frames took 3.1-3.9 SECONDS. That is
 * the "freezing" players report: not a low frame rate, but multi-second stalls
 * whenever geometry with an uncompiled material/light/shadow permutation first
 * enters the frame.
 *
 * Three.js compiles a program the first time a given (material, lights, shadow,
 * skinning, fog, ...) permutation is actually drawn. The fix is to force every
 * permutation to compile up front, while a loading state is on screen, so the
 * steady-state frame loop never compiles anything.
 *
 * This must not change a single rendered pixel. It only moves *when* compilation
 * happens, so it touches no material parameters, no camera, no lighting state.
 * The pixel-diff gate (tools/imagediff.mjs) enforces that.
 *
 * Two mechanisms, because neither alone is sufficient:
 *
 *  1. renderer.compileAsync() — uses KHR_parallel_shader_compile where available,
 *     so it compiles off the main thread and does not block. Covers the forward
 *     lit pass for everything currently in a scene graph.
 *  2. Pixel-neutral subsystem hooks — compileAsync does not cover depth/shadow
 *     variants or the post-processing chain. Render, world, AI and FX compile
 *     those directly against scratch targets without stepping gameplay.
 */

/** Poses chosen to span the level's lighting and material variety, so the
 *  cascades, interiors and exteriors all get their permutations compiled. */
const WARM_POSES = [
  { pos: [12, 1.75, 18], look: [-4, 2.2, -6] }, // main street, long cascades
  { pos: [-8.5, 1.7, 3.2], look: [2, 1.6, -2] }, // interior, short cascades
  { pos: [3.2, 1.35, 5.0], look: [1.4, 1.1, 2.2] }, // close material detail
  { pos: [4, 1.7, 12], look: [-6, 1.7, -4] }, // combat staging
];

/**
 * Force every shader permutation to compile before gameplay starts.
 * Resolves once warm. Never throws — a failed pre-warm must not block boot,
 * it just means the old stutter comes back. Only pixel-neutral compile hooks are
 * allowed here; staging gameplay objects or stepping frames is intentionally not
 * supported.
 */
import * as THREE from 'three';

/** Hidden-material systems that self-warm after the first frame's light cull. */
const SELF_WARMING = new Set(['fx', 'weapons', 'radio']);

/**
 * Whether to let `render.prewarmMaterials()` run its CSM-depth + MRT-prepass step.
 *
 * OFF, and it is the one thing in this file that was MEASURED not to be
 * pixel-neutral. Unlike every other step here, that one does not compile — it
 * actually *runs* the two depth passes, writing the shadow array and the gbuffer.
 * `render` reports it as clean when invoked standalone at frame 0; driven from
 * here (after every subsystem has init'd, with the camera restored to the real
 * spawn pose) it is not. Bisected against shots/perf-base with everything else in
 * place, one variable at a time:
 *
 *   render-only tree, no hooks .................. identical, 0 px
 *   + ragdoll sleep skip ........................ identical, 0 px
 *   + all hooks, shadow:false ................... identical, 0 px
 *   + all hooks, shadow:true .... detail/impacts/muzzle/night/weapon changed,
 *                                 0.005-0.017% of pixels, maxDelta 1
 *
 * Run-to-run noise was verified at exactly zero first (two captures of the same
 * tree were bit-identical), so those deltas are the change, not the harness.
 *
 * Little is lost: the override-material variants are reached anyway, without
 * drawing, by `world.prewarmMaterials()` (which compiles the level under
 * `csm.depthMaterial` and `gbuffer.material` via `scene.overrideMaterial`) and by
 * `ai.prewarmMaterials()` (which borrows render's depth override for the
 * characters). The gate outranks the last few programs.
 */
const RENDER_SHADOW_WARM = false;

export async function prewarm(engine, { onProgress = () => {} } = {}) {
  const t0 = performance.now();
  const render = engine.ctx.peek('render');
  const renderer = render?.renderer;
  if (!renderer) return { ok: false, reason: 'no renderer' };

  const programsBefore = renderer.info.programs?.length ?? 0;
  const cam = engine.camera;
  const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };

  // A RENDER TARGET MUST BE BOUND WHILE COMPILING. three folds `outputColorSpace`
  // and `toneMapping` into the program cache key and reads BOTH off the currently
  // bound target. With the canvas bound (the default here) every program compiled
  // is the `srgb` + tone-mapped variant — but the world and the viewmodel are both
  // drawn into HDR targets, which need `srgb-linear` + NoToneMapping. Measured by
  // src/materials and src/fx independently: 25 of 47 pre-warmed programs were the
  // unused canvas variant, and the real ones still compiled during the first
  // frames of play. A 1x1 target is enough to get the right key; nothing is ever
  // rendered into it. Restored in the caller's `finally`.
  const scratchRt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
  const prevRt = renderer.getRenderTarget();
  const prevFace = renderer.getActiveCubeFace?.() ?? 0;
  const prevMip = renderer.getActiveMipmapLevel?.() ?? 0;

  const compile = async () => {
    // compileAsync is non-blocking where KHR_parallel_shader_compile exists.
    renderer.setRenderTarget(scratchRt);
    try {
      await renderer.compileAsync(engine.scene, engine.camera);
      await renderer.compileAsync(engine.viewScene, engine.viewCamera);
    } catch {
      // Older three or a driver without the extension — fall back to sync.
      try {
        renderer.compile(engine.scene, engine.camera);
        renderer.compile(engine.viewScene, engine.viewCamera);
      } catch { /* nothing more we can do; boot must still proceed */ }
    } finally {
      renderer.setRenderTarget(prevRt, prevFace, prevMip);
    }
  };

  try {
    let step = 0;
    const totalSteps = WARM_POSES.length + 1;
    const tick = () => onProgress(Math.min(1, ++step / totalSteps));

    // Pass 1: compile the static world from each representative pose.
    for (const p of WARM_POSES) {
      cam.position.set(...p.pos);
      cam.lookAt(...p.look);
      cam.updateMatrixWorld(true);
      await compile();
      tick();
    }

    // Pass 1b: THE SUBSYSTEM HOOKS. This is the `prewarmMaterials()` contract the
    // doc comment above says is missing — "a prewarmMaterials() on each subsystem
    // that builds and compiles its materials WITHOUT spawning gameplay objects".
    // It is now implemented by render, world and ai, and it reaches exactly what
    // `compileAsync(scene, camera)` provably cannot:
    //
    //   render  the CSM depth pass, the MRT prepass and the ~13 full-screen post
    //           materials (blitted into a 4x4 scratch). +34-40 programs.
    //   world   the CSM-depth and prepass override variants of the level geometry,
    //           in their plain / instanced / instanced+instanceColor flavours,
    //           compiled at the stabilised light count. +35 programs.
    //   ai      the 26 character materials and their skinned + depth variants,
    //           against a dummy SkinnedMesh on the real skeleton. +7 programs.
    //           (ai also calls this itself at the end of init(); it is idempotent.)
    //
    // None of them draws a gameplay frame, steps the engine, touches the clock or
    // the RNG, which keeps pre-warm simulation-transparent.
    //
    // The camera goes back to its real pose FIRST: render's hook runs the shadow
    // and prepass passes for real (at frame 0, where it is pixel-clean), and there
    // is no reason to fit the cascades to a warm-up pose the game never uses.
    cam.position.copy(saved.pos);
    cam.quaternion.copy(saved.quat);
    cam.fov = saved.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // render goes first, deliberately: it patches every lit material with the
    // CSM/AO/SSR injection, and a program compiled off an UNPATCHED material is
    // thrown away by the first frame that walks the scene.
    const hooks = [];
    const renderSys = engine.registry.peek?.('render');
    if (renderSys && typeof renderSys.prewarmMaterials === 'function') hooks.push(renderSys);
    for (const sys of engine.registry.ordered ?? []) {
      if (sys === renderSys) continue;
      if (SELF_WARMING.has(sys.constructor?.id)) continue;
      if (typeof sys.prewarmMaterials === 'function') hooks.push(sys);
    }
    const hookResults = {};
    for (const sys of hooks) {
      const id = sys.constructor?.id ?? '?';
      try {
        const arg = sys === renderSys ? { post: true, shadow: RENDER_SHADOW_WARM } : engine.ctx;
        hookResults[id] = (await sys.prewarmMaterials(arg)) ?? { ok: true };
      } catch (err) {
        // An optional hook must never be able to block boot.
        hookResults[id] = { ok: false, reason: String(err?.message ?? err) };
      }
    }
    engine.__prewarmHooks = hookResults;
    tick();
  } finally {
    // Restore exactly what we found. Any residue here would be a visual change.
    cam.position.copy(saved.pos);
    cam.quaternion.copy(saved.quat);
    cam.fov = saved.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    renderer.setRenderTarget(prevRt, prevFace, prevMip);
    scratchRt.dispose();
  }

  const programsAfter = renderer.info.programs?.length ?? 0;
  return {
    ok: true,
    hooks: engine.__prewarmHooks,
    ms: Math.round(performance.now() - t0),
    programsBefore,
    programsAfter,
    compiled: programsAfter - programsBefore,
    parallel: !!renderer.getContext().getExtension('KHR_parallel_shader_compile'),
  };
}
