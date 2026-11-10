import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// tools/ typechecks against Node types only; these are the Bun runtime APIs used.
declare const Bun: {
  Transpiler: new (options: { loader: 'ts' }) => {
    scanImports(code: string): { path: string }[];
  };
  resolveSync(specifier: string, parent: string): string;
};

const transpiler = new Bun.Transpiler({ loader: 'ts' });
// Workers are module entries that static import scanning cannot see.
const URL_ENTRY = /new URL\(\s*'(\.\.?\/[^']+\.ts)',\s*import\.meta\.url\s*\)/g;

/** Repo-relative first-party files reachable from `entries` through runtime
 * imports (relative or `#` aliases) and relative `new URL(..., import.meta.url)`. */
export function sourceClosure(root: string, entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const stack = entries.map((entry): string => resolve(root, entry));
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(file, 'utf8').replace(/^#!.*/, '');
    const specifiers = transpiler.scanImports(source).map((entry): string => entry.path);
    for (const match of source.matchAll(URL_ENTRY)) specifiers.push(match[1] ?? '');
    for (const specifier of specifiers)
      if (specifier.startsWith('.') || specifier.startsWith('#'))
        stack.push(Bun.resolveSync(specifier, dirname(file)));
  }
  return [...seen].map((file): string => relative(root, file)).sort();
}

/** Stable short hash of repo-relative paths and their bytes. */
export function hashFiles(root: string, files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
