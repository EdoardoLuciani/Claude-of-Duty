import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const EXPORTER = resolve(ROOT, 'tools', 'export-models.mjs');

/**
 * Every module whose output the GLBs depend on. The exporter regenerates ALL
 * models on any of these changing — a per-file freshness check cannot see
 * transitive inputs (parts.js, geometry.js, rig.js, geo.js, ...), so the dev
 * watcher simply re-runs the whole deterministic export.
 */
const MODEL_SOURCES = [
  'src/weapons/models/rifle.js',
  'src/weapons/models/smg.js',
  'src/weapons/models/pistol.js',
  'src/weapons/parts.js',
  'src/weapons/geometry.js',
  'src/ai/soldier.js',
  'src/ai/rig.js',
  'src/ai/geo.js',
  'src/ai/parts.js',
  'src/ai/weapon.js',
  'src/ai/textures.js',
  'tools/export-models.mjs',
];

/**
 * Dev-only: when a model source changes, re-run tools/export-models.mjs after
 * a short debounce. Runs are serialised (the exporter also holds its own pid
 * lock, so a concurrent predev/prebuild cannot interleave). The page is not
 * reloaded by us; vite's own public-dir handling may full-reload, which is the
 * desired outcome — you edited the weapon, so you see the weapon.
 */
function modelsExportWatcher() {
  let timer = null;
  let running = false;
  let queued = false;

  const run = () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    const p = spawn(process.execPath, [EXPORTER], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => {
      running = false;
      if (queued) {
        queued = false;
        run();
      }
      if (code !== 0) console.error(`[models] export failed (exit ${code})`);
    });
  };

  return {
    name: 'claude-of-duty:models-export',
    apply: 'serve',
    configureServer(server) {
      server.watcher.on('change', (file) => {
        const rel = file.replace(/\\/g, '/');
        if (!MODEL_SOURCES.some((s) => rel.endsWith(s))) return;
        clearTimeout(timer);
        timer = setTimeout(run, 300);
      });
    },
  };
}

export default defineConfig({
  plugins: [modelsExportWatcher()],
  // Keep every import of three — app code and the examples/jsm modules — on one
  // instance. Without this, dev mode can execute three's source twice and trip
  // the "Multiple instances of Three.js" guard, which breaks instanceof checks
  // across modules.
  resolve: {
    dedupe: ['three'],
  },
  // Bind IPv4 explicitly: the default `localhost` binds ::1 only on macOS,
  // which the capture harness (127.0.0.1) cannot reach.
  // `hmr: false` when the capture harness owns the server (OW_NO_HMR=1): a file
  // saved by a concurrently-working agent otherwise reloads the page mid-capture
  // and playwright fails with "Execution context was destroyed".
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: process.env.OW_NO_HMR ? false : undefined,
  },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4096 },
  // Large binary game assets served verbatim.
  assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
});
