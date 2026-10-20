import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const sha = (...chunks) =>
  chunks.reduce((h, c) => h.update(c), createHash('sha256')).digest('hex');
export async function provenance() {
  const files = [
    'app.mjs',
    'renderer.mjs',
    'math.mjs',
    'shaders.mjs',
    'scene.mjs',
    'present.mjs',
    'provenance.mjs',
    'build.mjs',
    'package.json',
    'package-lock.json',
  ];
  const bytes = await Promise.all(files.map((f) => readFile(new URL(f, import.meta.url))));
  const packageInfo = JSON.parse(bytes.at(-2));
  const native = (name) => readFile(fileURLToPath(new URL(name, import.meta.url)));
  return {
    sourceSha256: sha(...bytes),
    dependencies: packageInfo.dependencies,
    gpuAddonSha256: sha(await native('node_modules/@kmamal/gpu/dist/dawn.node')),
    sdlAddonSha256: sha(await native('node_modules/@kmamal/sdl/dist/sdl.node')),
    origin: '11ebdcacef532da3b96b6f30c4c764096d65e944',
    dawnCommit: '42d0e90fe3552a2a8e95ca8e506bc19bbda12729',
  };
}
