// Query-only collision snapshots: copy used geometry, never live buffers or
// unused BVH capacity. Scratch remains worker-owned.
import { StaticWorld } from './bvh.ts';

/** Query-only copy of a StaticWorld, sent to the AI attachment worker. */
export type QuerySnapshot = Pick<
  StaticWorld,
  | 'version'
  | 'dirty'
  | 'nodeCount'
  | 'triCount'
  | 'pos'
  | 'nrm'
  | 'surface'
  | 'mask'
  | 'object'
  | 'triIndex'
  | 'nodeBounds'
  | 'nodeMeta'
  | 'triBounds'
> & { stackSize: number };

type BufferKey =
  | 'pos'
  | 'nrm'
  | 'surface'
  | 'mask'
  | 'object'
  | 'triIndex'
  | 'nodeBounds'
  | 'nodeMeta'
  | 'triBounds';
type SnapshotBuffer = QuerySnapshot[BufferKey];

function sameBuffer<T extends SnapshotBuffer>(value: unknown, source: T): value is T {
  return ArrayBuffer.isView(value) && value.constructor === source.constructor;
}

export async function querySnapshot(
  world: StaticWorld,
  current: () => boolean = (): boolean => true
): Promise<{ snapshot: QuerySnapshot; transfer: ArrayBuffer[]; bytes: number } | null> {
  const { version, nodeCount, triCount } = world;
  const valid = (): boolean =>
    current() &&
    !world.dirty &&
    world.version === version &&
    world.nodeCount === nodeCount &&
    world.triCount === triCount;
  const snapshot: QuerySnapshot = {
    version,
    dirty: false,
    nodeCount,
    triCount,
    stackSize: world._stackNode.length,
    // Private until all borrowed buffers have been replaced with copies.
    pos: world.pos,
    nrm: world.nrm,
    surface: world.surface,
    mask: world.mask,
    object: world.object,
    triIndex: world.triIndex,
    nodeBounds: world.nodeBounds,
    nodeMeta: world.nodeMeta,
    triBounds: world.triBounds,
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
    triBounds: triCount * 6,
  };
  const transfer: ArrayBuffer[] = [];
  let bytes = 0;
  // Cooperative target, not a hard bound on allocation/GC or one copy chunk.
  let yieldAt = performance.now() + 2;
  function storeBuffer<K extends BufferKey>(name: K, copy: QuerySnapshot[K]): void {
    snapshot[name] = copy;
  }
  for (const name of [
    'pos',
    'nrm',
    'surface',
    'mask',
    'object',
    'triIndex',
    'nodeBounds',
    'nodeMeta',
    'triBounds',
  ] as const) {
    const length = lengths[name];
    if (!valid()) return null;
    const source = world[name];
    const copy: unknown = Reflect.construct(source.constructor, [length]);
    if (!sameBuffer(copy, source)) throw new TypeError('invalid snapshot buffer constructor');
    for (let offset = 0; offset < length; offset += 65536) {
      if (!valid()) return null;
      copy.set(source.subarray(offset, Math.min(length, offset + 65536)), offset);
      if (performance.now() >= yieldAt) {
        await new Promise((resolve): ReturnType<typeof setTimeout> => setTimeout(resolve, 0));
        yieldAt = performance.now() + 2;
      }
    }
    storeBuffer(name, copy);
    if (!(copy.buffer instanceof ArrayBuffer))
      throw new TypeError('invalid snapshot transfer buffer');
    transfer.push(copy.buffer);
    bytes += copy.byteLength;
  }
  if (!valid()) return null;
  return { snapshot, transfer, bytes };
}

/** Rebuild a query-only world from a snapshot; its traversal scratch is the caller's own. */
export function restoreSnapshot({ stackSize, ...data }: QuerySnapshot): StaticWorld {
  const world = new StaticWorld();
  Object.assign(world, data);
  world._stackNode = new Int32Array(stackSize);
  return world;
}
