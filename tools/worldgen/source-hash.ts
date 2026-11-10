import { hashFiles, sourceClosure } from '../lib/source-hash.ts';

/** Every first-party module the world exporter executes, including workers. */
export function worldSourceHash(root: string): string {
  return hashFiles(root, sourceClosure(root, ['tools/export-world.ts']));
}
