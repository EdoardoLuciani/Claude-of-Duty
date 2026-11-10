/**
 * Bundles `new URL('<file>.ts', import.meta.url)` targets (the attachment worker and the
 * energy worklet) into one hashed ES module each, for the dev server (bunfig.toml) and
 * `build/bun.ts build`. Also injects a fixed Git revision for telemetry in both modes.
 * Sources stay raw ES modules that Bun smoke tests import unchanged.
 * URLs resolve against the page because dev HMR sees a file:// import.meta.url.
 * Dev bundles each target once per load: restart `bun run dev` after editing one.
 */
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { dirname, resolve } from 'node:path';

import type { BunPlugin, OnLoadResult, OnResolveResult } from 'bun';

const PATTERN = /new URL\(\s*'([^']+)\.ts',\s*import\.meta\.url\s*\)/g;
const REVISION = ((): string => {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], options).trim();
    return head + (dirty ? '+dirty' : '');
  } catch {
    return 'unknown'; // Source archives need not include Git metadata or the Git binary.
  }
})();

/** A subprocess, because Bun 1.4.4 deadlocks on Bun.build() inside a plugin callback. */
async function bundle(entry: string, minify: boolean): Promise<string> {
  const child = Bun.spawn(
    [
      process.execPath,
      'build',
      entry,
      '--target=browser',
      '--format=esm',
      ...(minify ? ['--minify'] : []),
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`[bundle] ${entry} failed:\n${stderr}`);
  return stdout;
}

const plugin: BunPlugin = {
  name: 'claude-of-duty',
  setup(build): void {
    const minify = !!build.config.minify;
    // `ow-bundle:<entry>.js` names the emitted asset; it loads from <entry>.ts.
    build.onResolve({ filter: /^ow-bundle:/ }, ({ path }): OnResolveResult => ({
      path: path.slice('ow-bundle:'.length),
      namespace: 'ow-bundle',
    }));
    build.onLoad(
      { filter: /.*/, namespace: 'ow-bundle' },
      async ({ path }): Promise<OnLoadResult> => ({
        contents: await bundle(path.replace(/\.js$/, '.ts'), minify),
        loader: 'file',
      })
    );
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async ({ path }): Promise<OnLoadResult> => {
      const source = await Bun.file(path).text();
      // Bun 1.4.4's HTML dev server ignores build.config.define; share this transform instead.
      const text = source.replaceAll('import.meta.BUILD_REVISION', JSON.stringify(REVISION));
      const imports: string[] = [];
      const contents = text.replace(PATTERN, (match: string, spec: string): string => {
        const asset = `ow-bundle:${resolve(dirname(path), spec)}.js`;
        const name = `__bundle${imports.length}`;
        imports.push(`import ${name} from ${JSON.stringify(asset)};`);
        // Keep the match's line breaks so later lines (and sourcemaps) stay aligned.
        const breaks = '\n'.repeat(match.split('\n').length - 1);
        return `new URL(${name}, location.href${breaks})`;
      });
      // Prepended on the first source line, again keeping line numbers.
      return imports.length || contents !== source
        ? { contents: imports.join(' ') + contents, loader: 'ts' }
        : undefined;
    });
  },
};

export default plugin;
