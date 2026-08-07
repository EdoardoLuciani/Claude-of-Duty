import * as THREE from 'three';

/**
 * DEV ONLY — shared boilerplate for the standalone subsystem preview pages.
 *
 * Each preview used to re-roll its own WebGLRenderer / camera / resize
 * listener (~25 duplicated lines × 4 pages). This is the one canonical copy;
 * previews keep everything else (lighting, scenes, animation loops, __READY__
 * conventions) to themselves, so a subsystem mid-edit cannot break another
 * preview's boot — the reason these pages exist in the first place.
 *
 *   const { renderer, camera } = studio('c', { fov: 38, near: 0.004, far: 60, exposure: 1.15 });
 */
export function studio(canvasId, opts = {}) {
  const canvas = document.getElementById(canvasId);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: opts.antialias ?? true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = opts.toneMapping ?? THREE.ACESFilmicToneMapping;
  if (opts.exposure !== undefined) renderer.toneMappingExposure = opts.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (opts.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const camera = new THREE.PerspectiveCamera(
    opts.fov ?? 50,
    innerWidth / innerHeight,
    opts.near ?? 0.05,
    opts.far ?? 400
  );
  // A preview with render targets to recreate (fx) passes its own handler;
  // the default just resizes the backbuffer and camera.
  const onResize =
    opts.onResize ??
    (() => {
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    });
  addEventListener('resize', onResize);
  return { canvas, renderer, camera };
}
