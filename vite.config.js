import { spawn } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const ASSET_PIPELINES = {
  models: {
    exporter: resolve(ROOT, 'tools', 'export-models.mjs'),
    sources: [
      'src/weapons/models/',
      'src/weapons/parts.js',
      'src/weapons/geometry.js',
      'src/ai/soldier.js',
      'src/ai/rig.js',
      'src/ai/geo.js',
      'src/ai/parts.js',
      'src/ai/weapon.js',
      'src/ai/textures.js',
      'src/core/math.js',
      'src/core/noise.js',
      'src/core/rng.js',
      'tools/export-models.mjs',
      'tools/lib/assets.mjs',
    ],
  },
  world: {
    exporter: resolve(ROOT, 'tools', 'export-world.mjs'),
    sources: [
      'src/world/',
      'src/core/rng.js',
      'tools/export-world.mjs',
      'tools/lib/assets.mjs',
    ],
    // Runtime adapters consume exported data but do not affect its bytes.
    exclude: ['src/world/index.js', 'src/world/palette.js'],
  },
};
const ALL_PIPELINES = Object.keys(ASSET_PIPELINES);

const matchesSource = (rel, source) =>
  source.endsWith('/') ? rel.startsWith(source) : rel === source;

function pipelinesForSource(rel) {
  return ALL_PIPELINES.filter((name) => {
    const pipeline = ASSET_PIPELINES[name];
    return !pipeline.exclude?.includes(rel) &&
      pipeline.sources.some((source) => matchesSource(rel, source));
  });
}

async function runAssetExporters(names = ALL_PIPELINES) {
  for (const name of names) {
    const exporter = ASSET_PIPELINES[name].exporter;
    const code = await new Promise((resolveCode) => {
      const child = spawn(process.execPath, [exporter], { cwd: ROOT, stdio: 'inherit' });
      child.on('error', () => resolveCode(1));
      child.on('exit', (value) => resolveCode(value ?? 1));
    });
    if (code !== 0) {
      throw new Error(
        `[assets] ${name} export failed (exit ${code}) — refusing to serve stale assets`
      );
    }
  }
}

/** Dev-only asset watcher. A debounce batch exports only affected pipelines. */
function assetExportWatcher() {
  let timer = null;
  let chain = Promise.resolve();
  let batch = null;
  const events = new Map();

  const runExport = (names) => {
    chain = chain.then(async () => {
      try {
        await runAssetExporters(names);
        return 0;
      } catch (err) {
        console.error(err);
        return 1;
      }
    });
    return chain;
  };

  const scheduleExport = (server, names) => {
    if (!batch) {
      let resolveBatch;
      const promise = new Promise((resolve) => { resolveBatch = resolve; });
      batch = { promise, resolve: resolveBatch, server, names: new Set() };
    } else {
      batch.server = server;
    }
    for (const name of names) batch.names.add(name);

    clearTimeout(timer);
    timer = setTimeout(async () => {
      const current = batch;
      batch = null;
      timer = null;
      const code = await runExport(ALL_PIPELINES.filter((name) => current.names.has(name)));
      if (code === 0) {
        current.server.ws.send({ type: 'full-reload', path: '*' });
      } else {
        current.server.ws.send({
          type: 'error',
          err: { message: '[assets] export failed — see the terminal', stack: '' },
        });
      }
      current.resolve(code);
    }, 300);

    return batch.promise;
  };

  return {
    name: 'claude-of-duty:asset-export',
    apply: 'serve',
    async hotUpdate({ file, server, timestamp }) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      const names = pipelinesForSource(rel);
      if (names.length === 0) return;

      // Vite invokes this once per environment. Reuse the same completed
      // promise briefly so one filesystem event produces one export/reload.
      const eventKey = `${rel}\0${timestamp}`;
      let pending = events.get(eventKey);
      if (!pending) {
        pending = scheduleExport(server, names);
        events.set(eventKey, pending);
        void pending.then(() => {
          setTimeout(() => {
            if (events.get(eventKey) === pending) events.delete(eventKey);
          }, 2000);
        });
      }
      await pending;
      return [];
    },
  };
}

export default defineConfig(async ({ isPreview }) => {
  // Build and dev consume public/, so generate assets before either starts.
  // Preview serves an already-built dist/; rewriting public/ there cannot make
  // that immutable build fresher and only wastes several seconds.
  if (!isPreview) await runAssetExporters();

  return {
    plugins: isPreview ? [] : [assetExportWatcher()],
    // Keep every import of three — app code and the examples/jsm modules — on
    // one instance. Without this, dev mode can execute three's source twice
    // and trip the "Multiple instances of Three.js" guard, which breaks
    // instanceof checks across modules.
    resolve: {
      dedupe: ['three'],
    },
    // Bind IPv4 explicitly: the default `localhost` binds ::1 only on macOS,
    // which the capture harness (127.0.0.1) cannot reach.
    // `hmr: false` when the capture harness owns the server (OW_NO_HMR=1): a
    // file saved by a concurrently-working agent otherwise reloads the page
    // mid-capture and playwright fails with "Execution context was destroyed".
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      hmr: process.env.OW_NO_HMR ? false : undefined,
      // Generated assets must not trigger HMR/watcher work of their own.
      watch: {
        ignored: ['**/public/models/**'],
      },
    },
    preview: { host: '127.0.0.1' },
    // Source maps are release/debug artifacts, not part of the default deploy.
    // Opt in with OW_SOURCEMAP=1 npm run build.
    build: {
      target: 'es2022',
      sourcemap: process.env.OW_SOURCEMAP === '1',
      chunkSizeWarningLimit: 4096,
    },
    // Large binary game assets served verbatim.
    assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
  };
});
