import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
/** Generated assets; tools/build-assets.mjs honours OW_SKIP_ASSETS (`bun run build:ci`). */
async function runAssetTasks() {
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [resolve(ROOT, 'tools/build-assets.mjs')], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('error', () => done(1));
    child.on('exit', (value) => done(value ?? 1));
  });
  if (code !== 0) throw new Error(`[assets] build-assets.mjs failed with exit code ${code}`);
}

export default defineConfig(async ({ isPreview }) => {
  // Generated models are built here; world export stays explicit (committed, validated).
  if (!isPreview) await runAssetTasks();

  let revision = 'unknown';
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim())
      revision += '+dirty';
  } catch {
    /* source archives need not include Git metadata */
  }
  return {
    define: { 'window.__BUILD_REVISION__': JSON.stringify(revision) },
    plugins: [
      {
        name: 'license',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'LICENSE.txt',
            source: readFileSync(resolve(ROOT, 'LICENSE'), 'utf8'),
          });
        },
      },
    ],
    resolve: { dedupe: ['three'] },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      hmr: process.env.OW_NO_HMR ? false : undefined,
      watch: { ignored: ['**/public/models/**'] },
    },
    preview: { host: '127.0.0.1' },
    build: {
      target: 'es2022',
      sourcemap: process.env.OW_SOURCEMAP === '1',
      chunkSizeWarningLimit: 4096,
    },
    assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
  };
});
