// Query-only collision snapshots: copy used geometry, never live buffers or
// unused BVH capacity. Scratch remains worker-owned.
export async function querySnapshot(world, current = () => true) {
  const { version, nodeCount, triCount } = world;
  const valid = () =>
    current() &&
    !world.dirty &&
    world.version === version &&
    world.nodeCount === nodeCount &&
    world.triCount === triCount;
  const snapshot = {
    version,
    dirty: false,
    nodeCount,
    triCount,
    stackSize: world._stackNode.length,
  };
  const lengths = {
    pos: triCount * 9,
    nrm: triCount * 3,
    surface: triCount,
    mask: triCount,
    object: triCount,
    triIndex: triCount,
    nodeBounds: nodeCount * 6,
    nodeMeta: nodeCount * 2,
    _taabb: triCount * 6,
  };
  const transfer = [];
  let bytes = 0;
  // Cooperative target, not a hard bound on allocation/GC or one copy chunk.
  let yieldAt = performance.now() + 2;
  for (const [name, length] of Object.entries(lengths)) {
    if (!valid()) return null;
    const source = world[name],
      copy = new source.constructor(length);
    for (let offset = 0; offset < length; offset += 65536) {
      if (!valid()) return null;
      copy.set(source.subarray(offset, Math.min(length, offset + 65536)), offset);
      if (performance.now() >= yieldAt) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yieldAt = performance.now() + 2;
      }
    }
    snapshot[name] = copy;
    transfer.push(copy.buffer);
    bytes += copy.byteLength;
  }
  if (!valid()) return null;
  return { snapshot, transfer, bytes };
}
