/**
 * Source transforms for the Bun dev server (bunfig.toml) and `build/bun.mjs build`; sources
 * stay raw ES modules that Node smoke tests import unchanged. Rewritten URLs resolve against
 * the page (dev HMR sees a file:// import.meta.url), so builds use publicPath '/'.
 * Dev bundles workers/worklets once per load: restart `bun run dev` after editing them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
// Application sources, plus the one bundled dependency that locates assets this way.
const SOURCES =
  /[\\/]src[\\/].*\.ts$|[\\/]three[\\/]examples[\\/]jsm[\\/]loaders[\\/]KTX2Loader\.js$/;
const URL_PATTERN = /new URL\(\s*'([^']+)',\s*import\.meta\.url\s*\)/g;
const GLOB_PATTERN = /import\.meta\.glob\?\.\(\s*'([^']+)'\s*\)/g;

/** HEAD, marked dirty when the work tree differs; source archives have no Git metadata. */
function gitRevision() {
  try {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    return git('rev-parse', 'HEAD').trim() + (git('status', '--porcelain').trim() ? '+dirty' : '');
  } catch {
    return 'unknown';
  }
}

/**
 * One browser ES module without imports, as Worker({ type: 'module' }) and addModule load.
 * A subprocess, because Bun 1.4.4 deadlocks on Bun.build() inside a plugin callback.
 */
async function bundleNested(entry, minify) {
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
    const revision = JSON.stringify(gitRevision());
    const minify = !!build.config.minify;
    // `ow-bundle:<entry>.js` names the emitted asset; it loads from <entry>.ts.
    build.onResolve({ filter: /^ow-bundle:/ }, ({ path }) => ({
      path: path.slice('ow-bundle:'.length),
      namespace: 'ow-bundle',
    }));
    build.onLoad({ filter: /.*/, namespace: 'ow-bundle' }, async ({ path }) => ({
      contents: await bundleNested(path.replace(/\.js$/, '.ts'), minify),
      loader: 'file',
    }));
    build.onLoad({ filter: SOURCES }, async ({ path }) => {
      let text = await Bun.file(path).text();
      if (!/import\.meta\.(url|glob)|__BUILD_REVISION__/.test(text)) return undefined;
      const dir = dirname(path);
      const imports = [];
      const importUrl = (file) => {
        imports.push(
          `import __asset${imports.length} from ${JSON.stringify(file)} with { type: 'file' };`
        );
        return `__asset${imports.length - 1}`;
      };
      // `new URL('<literal>', import.meta.url)` -> hashed file; .ts targets are bundled first.
      text = text
        .replace(URL_PATTERN, (match, spec) => {
          const file = resolve(dir, spec);
          // Code-only builds (OW_SKIP_ASSETS) lack generated GLBs; keep the runtime URL, as Vite did.
          if (process.env.OW_SKIP_ASSETS && !existsSync(file)) {
            console.warn(`[bundle] ${relative(ROOT, file)} missing; left unbundled`);
            return match;
          }
          return `new URL(${importUrl(file.endsWith('.ts') ? `ow-bundle:${file.slice(0, -3)}.js` : file)}, location.href)`;
        })
        // `import.meta.glob?.('<pattern>')` -> { './match': hashedUrl }; raw Node gets undefined.
        .replace(GLOB_PATTERN, (_, pattern) => {
          const entries = [...new Bun.Glob(pattern).scanSync({ cwd: dir })].sort().map((file) => {
            // Scan results keep the pattern's './' prefix; normalise to Vite-style keys.
            const path = resolve(dir, file);
            const key = `./${relative(dir, path).replaceAll('\\', '/')}`;
            return `${JSON.stringify(key)}: new URL(${importUrl(path)}, location.href).href`;
          });
          return `{ ${entries.join(', ')} }`;
        })
        // Dev ignores plugin `define`s, so stamp the revision here for both modes.
        .replaceAll('window.__BUILD_REVISION__', revision);
      // Same line as the source's first line keeps sourcemap line numbers.
      return { contents: imports.join(' ') + text, loader: path.endsWith('.ts') ? 'ts' : 'js' };
    });
  },
};
