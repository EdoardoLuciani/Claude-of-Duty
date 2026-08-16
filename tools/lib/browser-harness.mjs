import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.map((arg) => {
      const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
      return match ? [match[1], match[2] ?? true] : [arg, true];
    })
  );
}

export function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolveOpen) => {
    const socket = net.connect({ port, host }, () => {
      socket.destroy();
      resolveOpen(true);
    });
    socket.once('error', () => resolveOpen(false));
    socket.setTimeout(400, () => {
      socket.destroy();
      resolveOpen(false);
    });
  });
}

/** Start one HMR-free Vite server unless the requested port is already owned. */
export async function ensureViteServer({
  port = 5173,
  root = REPO_ROOT,
  attempts = 160,
  intervalMs = 250,
  stdio = 'ignore',
  noHmr = true,
} = {}) {
  if (await portOpen(port)) return null;

  const server = spawn(
    resolve(root, 'node_modules/.bin/vite'),
    ['--port', String(port), '--strictPort'],
    {
      cwd: root,
      stdio,
      detached: false,
      env: noHmr ? { ...process.env, OW_NO_HMR: '1' } : process.env,
    }
  );
  let startupError = null;
  server.once('error', (error) => { startupError = error; });
  server.once('exit', (code, signal) => {
    if (code && code !== 0) startupError = new Error(`vite exited with code ${code}`);
    else if (signal && signal !== 'SIGTERM') startupError = new Error(`vite exited on ${signal}`);
  });

  for (let i = 0; i < attempts; i++) {
    if (startupError) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    if (await portOpen(port)) return server;
  }

  if (server.exitCode === null && server.signalCode === null) server.kill();
  throw startupError ?? new Error(`vite failed to start on port ${port}`);
}

export function stopViteServer(server) {
  if (server?.exitCode === null && server.signalCode === null) server.kill();
}

/**
 * ANGLE backend flags that actually hit a GPU in headless Chromium.
 *
 * `--use-angle=metal` is correct on macOS and is what every capture tool used
 * to pass unconditionally. On Linux that flag is meaningless, so Chromium
 * silently falls back to SwiftShader (CPU). Headless Linux also cannot create
 * a presentable Vulkan swapchain unless `--disable-vulkan-surface` is set;
 * without it, even `--use-angle=vulkan` lands on SwiftShader.
 */
export function gpuAngleArgs() {
  if (process.platform === 'darwin') return ['--use-angle=metal'];
  if (process.platform === 'win32') return ['--use-angle=d3d11'];
  // Headless Linux needs --disable-vulkan-surface to present without a
  // compositor. Only force Vulkan when a DRM render node exists; otherwise
  // Chromium's default (SwiftShader) is the only thing that works in CI.
  if (existsSync('/dev/dri/renderD128')) {
    return ['--use-angle=vulkan', '--disable-vulkan-surface'];
  }
  return [];
}

/** Rewrite leftover `--use-angle=metal` on non-mac hosts to the local GPU backend. */
function rewriteGpuArgs(args = []) {
  if (process.platform === 'darwin') return args;
  const out = [];
  let replaced = false;
  for (const arg of args) {
    if (arg === '--use-angle=metal') {
      if (!replaced) {
        out.push(...gpuAngleArgs());
        replaced = true;
      }
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Launch Chromium with the caller's flags, rewriting macOS-only ANGLE metal
 * onto the local GPU backend. Prefer Playwright's managed binary, but fall
 * back to a system browser when package and browser revisions are temporarily
 * out of sync (common after npm install in headless CI).
 */
export async function launchChromium(options = {}) {
  const incoming = options.args ?? [];
  const hasBackend = incoming.some(
    (arg) => arg.startsWith('--use-angle=') || arg.startsWith('--use-gl=')
  );
  const launch = {
    ...options,
    args: hasBackend ? rewriteGpuArgs(incoming) : [...gpuAngleArgs(), ...incoming],
  };
  if (launch.executablePath) return chromium.launch(launch);

  const managed = chromium.executablePath();
  if (existsSync(managed)) return chromium.launch(launch);

  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const executablePath = candidates.find((path) => existsSync(path));
  if (!executablePath) return chromium.launch(launch); // retain Playwright's useful install error
  return chromium.launch({ ...launch, executablePath });
}
