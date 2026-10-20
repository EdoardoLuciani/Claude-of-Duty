import { loadScene } from './scene-data.js';
const params = new URLSearchParams(location.search),
  mode = params.get('mode') || 'raw';
const canvas = document.querySelector('canvas');
canvas.width = Number(params.get('w') || 1920);
canvas.height = Number(params.get('h') || 1080);
window.__LAB_READY__ = (async () => {
  const data = await loadScene(Number(params.get('agents') || 5));
  const request = navigator.gpu.requestAdapter;
  let adapterInfo;
  navigator.gpu.requestAdapter = async function (...args) {
    const adapter = await request.apply(this, args);
    if (adapter)
      adapterInfo = {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        fallback: adapter.info.isFallbackAdapter,
      };
    return adapter;
  };
  let renderer;
  try {
    const options = {
      shadowSize: Number(params.get('shadow') || 1024),
      freezePose: params.has('freeze'),
      unbatched: mode === 'raw-unbatched',
    };
    renderer = mode.startsWith('raw')
      ? await (await import('./raw-renderer.js')).createRaw(canvas, data, options)
      : await (await import('./three-reference.js')).createThree(canvas, data, options);
  } finally {
    navigator.gpu.requestAdapter = request;
  }
  if (!adapterInfo || adapterInfo.fallback) throw Error('must use nonfallback native adapter');
  window.__LAB__ = { renderer, data, mode, adapterInfo };
  return {
    mode,
    adapterInfo,
    nodes: data.meta.nodes.length,
    meshes: data.meta.meshes.length,
    groups: data.meta.meshes.reduce((n, m) => n + m.ranges.length, 0),
    frames: data.meta.frameCount,
  };
})();
