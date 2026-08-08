import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const ASSET_TASKS = ['export-models.mjs', 'validate-world-assets.mjs'];

async function runAssetTasks() {
  for (const file of ASSET_TASKS) {
    const code = await new Promise((done) => {
      const child = spawn(process.execPath, [resolve(ROOT, 'tools', file)], {
        cwd: ROOT,
        stdio: 'inherit',
      });
      child.on('error', () => done(1));
      child.on('exit', (value) => done(value ?? 1));
    });
    if (code !== 0) throw new Error(`[assets] ${file} failed with exit code ${code}`);
  }
}

export default defineConfig(async ({ isPreview }) => {
  // Blender export is explicit; normal builds only validate the committed world.
  if (!isPreview) await runAssetTasks();

  return {
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
