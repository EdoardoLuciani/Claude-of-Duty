// Fresh-process production loader costs, excluding collision/renderer setup.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const dir = new URL('../../public/models/world/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('level.json', dir)));
globalThis.gc?.();
const before = process.memoryUsage(), start = performance.now();
const { SurfaceNav } = await import('../../src/ai/nav.js');
const { PhysicsSystem } = await import('../../src/physics/index.js');
const imported = performance.now();
const compressed = readFileSync(new URL(meta.assets.nav, dir)), raw = gunzipSync(compressed);
const inflated = performance.now();
const nav = await SurfaceNav.load(raw, new PhysicsSystem(), { sha256: meta.navigation.sha256,
  sourceHash: meta.sourceHash, collisionAsset: meta.assets.collision });
const done = performance.now();
globalThis.gc?.();
const after = process.memoryUsage();
console.log(JSON.stringify({ totalMs: done - start, modulesMs: imported - start, inflateMs: inflated - imported,
  ...nav.stats, envelopeBytes: raw.length, gzipBytes: compressed.length,
  rssDelta: after.rss - before.rss, heapDelta: after.heapUsed - before.heapUsed }));
nav.dispose();
