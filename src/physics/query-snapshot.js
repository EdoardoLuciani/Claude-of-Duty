// Query-only collision snapshots: geometry is copied, scratch remains worker-owned.
// Never transfer the live world's buffers. Yield while copying so a runtime
// revision does not introduce a whole-world structured-clone stall.
const ARRAYS = ['pos', 'nrm', 'surface', 'mask', 'object', 'triIndex', 'nodeBounds', 'nodeMeta', '_taabb'];
export async function querySnapshot(world, current = () => true) {
  const version = world.version;
  const snapshot = { version, dirty: false, nodeCount: world.nodeCount, triCount: world.triCount, stackSize: world._stackNode.length };
  const transfer = []; let bytes = 0;
  for (const name of ARRAYS) {
    const source = world[name], copy = new source.constructor(source.length);
    for (let offset = 0; offset < source.length; offset += 65536) {
      if (!current() || world.dirty || world.version !== version) return null;
      copy.set(source.subarray(offset, offset + 65536), offset);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    snapshot[name] = copy; transfer.push(copy.buffer); bytes += copy.byteLength;
  }
  if (!current() || world.dirty || world.version !== version) return null;
  return { snapshot, transfer, bytes };
}
