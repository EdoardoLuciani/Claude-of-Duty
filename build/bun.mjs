/**
 * Bun bundler and servers: `bun build/bun.mjs dev|build|preview [--port N]`.
 * dev and build first run the Node asset tasks (tools/build-assets.mjs, which honours
 * OW_SKIP_ASSETS); preview serves the existing dist/. Dev plugins live in bunfig.toml.
 * Env: OW_SOURCEMAP=1 emits linked sourcemaps; OW_NO_HMR=1 disables dev HMR.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import plugin from './bun-plugin.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { port: { type: 'string' } },
});
const [command] = positionals;

function runAssetTasks() {
  // Asset tools are Node scripts; Bun executes this file, so name Node explicitly.
  const { status, error } = spawnSync('node', ['tools/build-assets.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (status !== 0) {
    console.error(`[assets] build-assets.mjs failed (${error?.message ?? `exit ${status}`})`);
    process.exit(1);
  }
}

/** Static file under `dir`; refuses paths that escape it. */
async function serveStatic(dir, request) {
  const path = normalize(join(dir, decodeURIComponent(new URL(request.url).pathname)));
  const file = path.startsWith(dir + sep) ? Bun.file(path) : null;
  return file && (await file.exists())
    ? new Response(file)
    : new Response('Not found', { status: 404 });
}

function listen(defaultPort, options) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(values.port ?? defaultPort),
    ...options,
  });
  console.log(`[${command}] ${server.url.href}`);
}

if (command === 'build') {
  const start = performance.now();
  runAssetTasks();
  rmSync(DIST, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(ROOT, 'index.html')],
    outdir: DIST,
    target: 'browser',
    minify: true,
    splitting: true,
    publicPath: '/',
    sourcemap: process.env.OW_SOURCEMAP === '1' ? 'linked' : 'none',
    naming: { chunk: 'assets/[name]-[hash].[ext]', asset: 'assets/[name]-[hash].[ext]' },
    plugins: [plugin],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  // Bun has no public/ convention: copy it verbatim, as served in dev.
  cpSync(PUBLIC, DIST, { recursive: true });
  await Bun.write(join(DIST, 'LICENSE.txt'), Bun.file(join(ROOT, 'LICENSE')));
  const bytes = result.outputs.reduce((sum, output) => sum + output.size, 0);
  console.log(
    `[build] ${result.outputs.length} files, ${(bytes / 2 ** 20).toFixed(1)} MiB + public/ ` +
      `in ${((performance.now() - start) / 1000).toFixed(1)}s`
  );
} else if (command === 'dev') {
  runAssetTasks();
  const { default: html } = await import('../index.html');
  listen(5173, {
    routes: { '/': html },
    development: { hmr: !process.env.OW_NO_HMR },
    fetch: (request) => serveStatic(PUBLIC, request),
  });
} else if (command === 'preview') {
  listen(4173, {
    routes: { '/': new Response(Bun.file(join(DIST, 'index.html'))) },
    fetch: (request) => serveStatic(DIST, request),
  });
} else {
  console.error('usage: bun build/bun.mjs dev|build|preview [--port N]');
  process.exit(2);
}
