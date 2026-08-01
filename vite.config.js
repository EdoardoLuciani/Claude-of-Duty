import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const EXPORTER = resolve(ROOT, 'tools', 'export-models.mjs');

/**
 * Run the model exporter and fail the config load if it fails. Because this
 * happens in the (async) config factory, EVERY entry point that loads vite —
 * `npm run dev`, `npm run build`, `vite preview`, and the capture harnesses
 * that spawn vite directly (capture.mjs, baseline.mjs, shotset.mjs) — is
 * guaranteed to have fresh models before the server starts, including on a
 * clean checkout where public/models/ does not exist yet.
 */
async function runModelExporter() {
  const code = await new Promise((resolveCode) => {
    const p = spawn(process.execPath, [EXPORTER], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => resolveCode(c ?? 1));
  });
  if (code !== 0) {
    throw new Error(`[models] export failed (exit ${code}) — refusing to start vite without models`);
  }
}

/**
 * Every module whose output the GLBs depend on. The exporter regenerates ALL
 * models on any of these changing — a per-file freshness check cannot see
 * transitive inputs — so the dev watcher simply re-runs the whole
 * deterministic export (the exporter holds its own pid lock, so this is safe
 * against concurrent predev/prebuild invocations).
 */
const MODEL_SOURCES = [
  'src/weapons/models/', // all model assembly files
  'src/weapons/parts.js',
  'src/weapons/geometry.js',
  'src/ai/soldier.js',
  'src/ai/rig.js',
  'src/ai/geo.js',
  'src/ai/parts.js',
  'src/ai/weapon.js',
  'src/ai/textures.js',
  'src/core/rng.js', // the exporter draws its fixed seed through this
  'tools/export-models.mjs',
];

const isModelSource = (rel) =>
  MODEL_SOURCES.some((s) => (s.endsWith('/') ? rel.startsWith(s) : rel.endsWith(s)));

/**
 * Dev-only model watcher, coordinated with HMR:
 *  1. a model source changes  -> hotUpdate hook fires (vite calls it for any
 *     watched file, module graph or not) and returns [] so no intermediate
 *     per-file HMR update reaches the page
 *  2. debounce (~300 ms) collapses bursts, then the exporter runs (serialised
 *     through a promise chain, so overlapping edits queue instead of racing)
 *  3. on success: exactly ONE full page reload — the new models are visible
 *     immediately; on failure: a vite error overlay names the failure
 * public/models/** is excluded from the watcher (server.watch.ignored), so the
 * 12 files each export writes never trigger anything.
 */
function modelsExportWatcher() {
  let timer = null;
  let chain = Promise.resolve();
  let lastTimestamp = 0;

  const runExport = () => {
    chain = chain.then(
      () =>
        new Promise((resolveCode) => {
          const p = spawn(process.execPath, [EXPORTER], { cwd: ROOT, stdio: 'inherit' });
          p.on('exit', (c) => resolveCode(c ?? 1));
        })
    );
    return chain;
  };

  return {
    name: 'claude-of-duty:models-export',
    apply: 'serve',
    async hotUpdate({ file, server, timestamp }) {
      const rel = file.replace(/\\/g, '/');
      if (!isModelSource(rel)) return;
      // vite 7 invokes hotUpdate once PER ENVIRONMENT (client + ssr) for the
      // same change event, with the same timestamp. Without this dedupe every
      // edit would trigger two exports.
      if (timestamp === lastTimestamp) return;
      lastTimestamp = timestamp;
      clearTimeout(timer);
      await new Promise((r) => {
        timer = setTimeout(r, 300); // debounce bursts of edits
      });
      const code = await runExport();
      if (code === 0) {
        server.ws.send({ type: 'full-reload', path: '*' });
      } else {
        server.ws.send({
          type: 'error',
          err: {
            message: `[models] export failed with exit code ${code} — see the terminal`,
            stack: '',
          },
        });
      }
      return []; // suppress per-file HMR updates; the single reload covers it
    },
  };
}

export default defineConfig(async () => {
  // Guarantee models exist before ANY vite entry point starts serving.
  await runModelExporter();

  return {
    plugins: [modelsExportWatcher()],
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
    build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4096 },
    // Large binary game assets served verbatim.
    assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
  };
});
