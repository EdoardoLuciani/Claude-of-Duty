/**
 * Source transforms shared by the Bun dev server (bunfig.toml) and `build/bun.mjs build`.
 * Sources stay valid raw ES modules, so Node smoke tests import them unchanged:
 *  - `new URL('<literal>', import.meta.url)` (also in three's KTX2Loader) becomes a hashed
 *    file import. A `.ts` target (worker or worklet) is first bundled into one ES module.
 *  - `import.meta.glob?.('<pattern>')` becomes a map of every match's hashed URL; raw Node
 *    sees no glob, so callers fall back to file URLs.
 *  - `window.__BUILD_REVISION__` becomes the Git revision; dev ignores plugin `define`s.
 * Rewritten URLs resolve against the page: dev asset URLs are root-relative, and dev HMR
 * modules see a file:// import.meta.url. Builds therefore use publicPath '/'.
 * Dev builds nested bundles once per load: restart `bun run dev` after worker edits.
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
  const args = [
    'build',
    entry,
    '--target=browser',
    '--format=esm',
    ...(minify ? ['--minify'] : []),
  ];
  const child = Bun.spawn([process.execPath, ...args], { stdout: 'pipe', stderr: 'pipe' });
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
    const minify = build.config?.minify === true;
    // Emitted under the entry's name with a .js extension, hashed like any other asset.
    build.onResolve({ filter: /^ow-bundle:/ }, ({ path }) => ({
      path: path.slice('ow-bundle:'.length).replace(/\.ts$/, '.js'),
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
      text = text
        .replace(URL_PATTERN, (match, spec) => {
          const file = resolve(dir, spec);
          // Code-only builds (OW_SKIP_ASSETS) lack generated GLBs; keep the runtime URL, as Vite did.
          if (process.env.OW_SKIP_ASSETS && !existsSync(file)) {
            console.warn(`[bundle] ${relative(ROOT, file)} missing; left unbundled`);
            return match;
          }
          return `new URL(${importUrl(file.endsWith('.ts') ? `ow-bundle:${file}` : file)}, location.href)`;
        })
        .replace(GLOB_PATTERN, (_, pattern) => {
          const entries = [...new Bun.Glob(pattern).scanSync({ cwd: dir })].sort().map((file) => {
            const key = `./${relative(dir, resolve(dir, file)).split('\\').join('/')}`;
            return `${JSON.stringify(key)}: new URL(${importUrl(resolve(dir, file))}, location.href).href`;
          });
          return `{ ${entries.join(', ')} }`;
        })
        .replaceAll('window.__BUILD_REVISION__', revision);
      // Same line as the source's first line keeps sourcemap line numbers.
      return { contents: imports.join(' ') + text, loader: path.endsWith('.ts') ? 'ts' : 'js' };
    });
  },
};
