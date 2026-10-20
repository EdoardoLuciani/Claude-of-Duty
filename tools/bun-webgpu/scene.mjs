import assert from 'node:assert/strict';

import { identity, inverseAffine, lookAtWorld, multiply, ortho } from './math.mjs';

// Same #476 decoder/shadow construction; filesystem I/O belongs to the host.
export function decodeScene(meta, binary) {
  assert(meta.version === 1 && meta.frameCount === 120, 'expected final 120-frame recording');
  const section = (s, Type) => {
    assert(
      s &&
        Number.isSafeInteger(s.offset) &&
        Number.isSafeInteger(s.bytes) &&
        s.offset >= 0 &&
        s.bytes >= 0 &&
        s.offset + s.bytes <= binary.byteLength &&
        s.offset % Type.BYTES_PER_ELEMENT === 0 &&
        s.bytes % Type.BYTES_PER_ELEMENT === 0,
      'invalid binary section'
    );
    return new Type(binary, s.offset, s.bytes / Type.BYTES_PER_ELEMENT);
  };
  const f32 = (s) => section(s, Float32Array),
    u32 = (s) => section(s, Uint32Array);
  assert(
    meta.nodes.length > 0 && meta.meshes.length > 0 && meta.skeletons.length > 0,
    'empty scene'
  );
  for (const [i, n] of meta.nodes.entries()) {
    assert(Number.isInteger(n.parent) && n.parent >= -1 && n.parent < i, 'non-topological parent');
    assert(n.matrix.length === 16 && n.matrix.every(Number.isFinite), 'invalid matrix');
  }
  assert(f32(meta.frames).length === meta.frameCount * meta.dynamic.length * 16, 'frame length');
  assert(
    u32(meta.visibility).length === meta.frameCount * meta.dynamic.length,
    'visibility length'
  );
  assert(f32(meta.cameras).length === meta.frameCount * 64, 'camera length');
  for (const n of meta.dynamic)
    assert(Number.isInteger(n) && n >= 0 && n < meta.nodes.length, 'dynamic node');
  const data = {
    meta,
    binary,
    frames: f32(meta.frames),
    visibility: u32(meta.visibility),
    cameras: f32(meta.cameras),
  };
  data.geometry = meta.geometries.map((g) => ({
    ...g,
    vertices: section(g.vertex, Uint8Array),
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
