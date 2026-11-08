import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { basename, dirname, resolve } from 'node:path';
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

/** Bun binary: `bun run` exposes it via npm_execpath without putting it on PATH. */
export const BUN = basename(process.env.npm_execpath ?? '').startsWith('bun')
  ? process.env.npm_execpath
  : 'bun';

/** Start one HMR-free Bun dev (or preview) server unless the requested port is already owned. */
export async function ensureDevServer({
  port = 5173,
  root = REPO_ROOT,
  attempts = 160,
  intervalMs = 250,
  stdio = 'ignore',
  noHmr = true,
  preview = false,
} = {}) {
  if (await portOpen(port)) return null;

  const server = spawn(
    BUN,
    ['build/bun.mjs', preview ? 'preview' : 'dev', '--port', String(port)],
    {
      cwd: root,
      stdio,
      detached: false,
      env: noHmr ? { ...process.env, OW_NO_HMR: '1' } : process.env,
    }
  );
  let startupError = null;
  server.once('error', (error) => {
    startupError = error;
  });
  server.once('exit', (code, signal) => {
    if (code !== null && code !== 0)
      startupError = new Error(`dev server exited with code ${code}`);
    else if (signal && signal !== 'SIGTERM')
      startupError = new Error(`dev server exited on ${signal}`);
  });

  for (let i = 0; i < attempts; i++) {
    if (startupError) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    if (await portOpen(port)) return server;
  }

  if (server.exitCode === null && server.signalCode === null) server.kill();
  throw startupError ?? new Error(`dev server failed to start on port ${port}`);
}

/** Shared console/device-validation error collection; fixture assertions stay local. */
export function collectBrowserErrors(
  page,
  errors,
  { warnings = null, echo = false, validationMessages = false } = {}
) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const value = message.text();
    if (
      message.type() === 'error' ||
      (validationMessages &&
        /GPUValidationError|validation error|THREE\.TSL|Error while parsing WGSL/i.test(value))
    ) {
      errors.push(value);
      if (echo) console.error(value);
    }
    if (message.type() === 'warning') warnings?.push(value);
  });
}

export function stopDevServer(server) {
  if (server?.exitCode === null && server.signalCode === null) server.kill();
}

/** Metal on macOS, D3D11 on Windows, Vulkan on Linux with a DRM node. Empty
 *  in CI (no /dev/dri) so Chromium keeps SwiftShader. */
function gpuAngleArgs() {
  if (process.platform === 'darwin') return ['--use-angle=metal'];
  if (process.platform === 'win32') return ['--use-angle=d3d11'];
  if (existsSync('/dev/dri/renderD128')) {
    return ['--use-angle=vulkan', '--disable-vulkan-surface'];
  }
  return [];
}

/**
 * Launch Chromium with the local GPU backend. Prefer Playwright's managed
 * binary, but fall back to a system browser when package and browser revisions
 * are temporarily out of sync (common after bun install in headless CI).
 */
// Current gameplay/previews are native-only. Legacy comparison callers opt out.
export async function launchChromium({ webgpu = true, ...options } = {}) {
  const launch = {
    ...options,
    args: [
      ...gpuAngleArgs(),
      ...(webgpu
        ? [
            '--enable-unsafe-webgpu',
            ...(process.platform === 'linux' ? ['--enable-features=Vulkan'] : []),
          ]
        : []),
      ...(options.args ?? []),
    ],
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
