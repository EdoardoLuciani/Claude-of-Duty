/**
 * Bundles `new URL('<file>.ts', import.meta.url)` targets (the attachment worker and the
 * energy worklet) into one hashed ES module each, for the dev server (bunfig.toml) and
 * `build/bun.mjs build`. Sources stay raw ES modules that Node smoke tests import unchanged.
 * URLs resolve against the page because dev HMR sees a file:// import.meta.url.
 * Dev bundles each target once per load: restart `bun run dev` after editing one.
 */
import { dirname, resolve } from 'node:path';

const PATTERN = /new URL\(\s*'([^']+)\.ts',\s*import\.meta\.url\s*\)/g;

/** A subprocess, because Bun 1.4.4 deadlocks on Bun.build() inside a plugin callback. */
async function bundle(entry, minify) {
  const child = Bun.spawn(
    [process.execPath, 'build', entry, '--target=browser', '--format=esm'].concat(
      minify ? ['--minify'] : []
    ),
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

/** @type {import('bun').BunPlugin} */
export default {
  name: 'claude-of-duty',
  setup(build) {
    const minify = !!build.config.minify;
    // `ow-bundle:<entry>.js` names the emitted asset; it loads from <entry>.ts.
    build.onResolve({ filter: /^ow-bundle:/ }, ({ path }) => ({
      path: path.slice('ow-bundle:'.length),
      namespace: 'ow-bundle',
    }));
    build.onLoad({ filter: /.*/, namespace: 'ow-bundle' }, async ({ path }) => ({
      contents: await bundle(path.replace(/\.js$/, '.ts'), minify),
      loader: 'file',
    }));
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async ({ path }) => {
      const text = await Bun.file(path).text();
      if (!text.includes('import.meta.url')) return undefined;
      const imports = [];
      const contents = text.replace(PATTERN, (match, spec) => {
        const asset = `ow-bundle:${resolve(dirname(path), spec)}.js`;
        imports.push(`import __bundle${imports.length} from ${JSON.stringify(asset)};`);
        // Keep the match's line breaks so later lines (and sourcemaps) stay aligned.
        const breaks = '\n'.repeat(match.split('\n').length - 1);
        return `new URL(__bundle${imports.length - 1}, location.href${breaks})`;
      });
      // Prepended on the first source line, again keeping line numbers.
      return imports.length ? { contents: imports.join(' ') + contents, loader: 'ts' } : undefined;
    });
  },
};
