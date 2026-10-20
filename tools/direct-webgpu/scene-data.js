import { identity, inverseAffine, lookAtWorld, multiply, ortho } from './math.js';
export async function loadScene(agents) {
  const [meta, binary] = await Promise.all([
    fetch(`/data/scene-${agents}.json`).then((r) => r.json()),
    fetch(`/data/scene-${agents}.bin`).then((r) => r.arrayBuffer()),
  ]);
  const f32 = (s) => new Float32Array(binary, s.offset, s.bytes / 4),
    u32 = (s) => new Uint32Array(binary, s.offset, s.bytes / 4);
  const data = {
    meta,
    binary,
    frames: f32(meta.frames),
    visibility: u32(meta.visibility),
    cameras: f32(meta.cameras),
  };
  data.geometry = meta.geometries.map((g) => ({
    ...g,
    vertices: new Uint8Array(binary, g.vertex.offset, g.vertex.bytes),
    indices: u32(g.index),
  }));
  data.instances = meta.meshes.map((m) => (m.instances ? f32(m.instances) : null));
  data.roots = [-1, -1];
  for (const mesh of meta.meshes) {
    let n = mesh.node;
    while (meta.nodes[n].parent >= 0) n = meta.nodes[n].parent;
    data.roots[mesh.scene] = n;
  }
  const camera = data.cameras.subarray(0, 16),
    target = [camera[12] - camera[8] * 22, camera[13] - 1, camera[14] - camera[10] * 22];
  const light = [0.4, 0.8, 0.45],
    len = Math.hypot(...light);
  for (let i = 0; i < 3; i++) light[i] /= len;
  data.light = new Float32Array([...light, 0.22]);
  const world = lookAtWorld(
      target.map((v, i) => v + light[i] * 130),
      target
    ),
    view = inverseAffine(new Float64Array(16), world);
  data.shadows = [18, 45, 100].map((extent) => {
    const projection = ortho(extent);
    return { world, projection, vp: multiply(new Float64Array(16), projection, view) };
  });
  data.identity = identity(new Float64Array(16));
  return data;
}
