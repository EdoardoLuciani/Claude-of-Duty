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
// KTX2Loader's transcoder, served at /basis/ (src/weapons/asset-loader.ts).
const BASIS = join(ROOT, 'node_modules/three/examples/jsm/libs/basis');
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
async function serveStatic(dir, pathname) {
  let path = '';
  try {
    path = normalize(join(dir, decodeURIComponent(pathname)));
  } catch {
    // Malformed percent-encoding: treat as not found rather than a handler error.
  }
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
  // Bun.build rejects with the build logs on failure, which exits non-zero.
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
  // Bun has no public/ convention: copy it verbatim, as served in dev.
  cpSync(PUBLIC, DIST, { recursive: true });
  cpSync(BASIS, join(DIST, 'basis'), { recursive: true });
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
    routes: { '/': html, '/index.html': html },
    development: { hmr: !process.env.OW_NO_HMR },
    fetch: ({ url }) => {
      const { pathname } = new URL(url);
      return pathname.startsWith('/basis/')
        ? serveStatic(BASIS, pathname.slice('/basis'.length))
        : serveStatic(PUBLIC, pathname);
    },
  });
} else if (command === 'preview') {
  listen(4173, {
    routes: { '/': new Response(Bun.file(join(DIST, 'index.html'))) },
    fetch: ({ url }) => serveStatic(DIST, new URL(url).pathname),
  });
} else {
  console.error('usage: bun build/bun.mjs dev|build|preview [--port N]');
  process.exit(2);
}
