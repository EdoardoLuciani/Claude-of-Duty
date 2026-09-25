// Fresh-process import of an offline bake: keep generator heap high-water marks
// out of runtime-load measurements. Called by run.mjs, not by the game.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const [directory, filename] = process.argv.slice(2);
const start = performance.now(), before = process.memoryUsage();
const api = await import(pathToFileURL(join(directory, 'index.mjs')));
const importedAt = performance.now();
await api.init();
const initializedAt = performance.now();
const bytes = new Uint8Array(readFileSync(filename));
const loadAt = performance.now();
const { navMesh } = api.importNavMesh(bytes);
const query = new api.NavMeshQuery(navMesh, { maxNodes: 6000 });
const loadedAt = performance.now(), after = process.memoryUsage();
console.log(JSON.stringify({ moduleImportMs: importedAt - start, initMs: initializedAt - importedAt,
  assetReadMs: loadAt - initializedAt, navAndQueryMs: loadedAt - loadAt, totalMs: loadedAt - start,
  wasmHeapBytes: api.Raw.Module.HEAPU8.byteLength, rssDelta: after.rss - before.rss }));
api.Raw.destroy(query.defaultFilter.raw);
query.destroy(); navMesh.destroy();
