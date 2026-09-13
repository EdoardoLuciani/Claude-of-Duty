import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

function filesUnder(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(path));
    else if (entry.name.endsWith('.js')) result.push(path);
  }
  return result;
}

export function worldSourceHash(root) {
  const files = [
    ...filesUnder(join(root, 'tools/worldgen')),
    join(root, 'tools/export-world.mjs'),
    join(root, 'src/core/rng.js'),
    join(root, 'src/world/palette.js'),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(root, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
