import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { provenance, sha } from './provenance.mjs';
if (!process.versions.bun) throw Error('Run this build with Bun (tested 1.4.3)');
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(new URL('build/', import.meta.url), { recursive: true });
const info = await provenance();
const args = [
  'build',
  '--compile',
  '--bytecode',
  '--format=esm',
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-bunfig',
  `--define=globalThis.__BUN_WEBGPU_BUILD__=${JSON.stringify(info)}`,
  '--outfile=build/cod-bun-webgpu',
  'app.mjs',
];
const p = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
if (p.status !== 0) process.exit(p.status || 1);
const file = new URL('build/cod-bun-webgpu', import.meta.url);
await writeFile(
  new URL('build/manifest.json', import.meta.url),
  JSON.stringify(
    {
      ...info,
      bun: process.versions.bun,
      args,
      binarySha256: sha(await readFile(file)),
      bytes: (await stat(file)).size,
    },
    null,
    2
  ) + '\n'
);
