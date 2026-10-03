/** Connected collision components, computed offline (or at registration for test meshes). */
export function solidIds(geometry) {
  const p = geometry.attributes.position;
  const parent = new Uint32Array(p.count);
  const welded = new Map();
  for (let i = 0; i < p.count; i++) {
    // Weld UV/normal seams without connecting distinct, nearby faces.
    const key = `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    const previous = welded.get(key);
    parent[i] = previous ?? i;
    if (previous === undefined) welded.set(key, i);
  }
  function root(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  const index = geometry.index;
  const count = index ? index.count : p.count;
  for (let i = 0; i < count; i += 3) {
    const a = root(index ? index.getX(i) : i);
    for (let j = 1; j < 3; j++) {
      const b = root(index ? index.getX(i + j) : i + j);
      parent[b] = a;
    }
  }
  const components = new Map();
  const ids = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const r = root(i);
    if (!components.has(r)) components.set(r, components.size);
    ids[i] = components.get(r);
  }
  return { ids, count: components.size };
}
