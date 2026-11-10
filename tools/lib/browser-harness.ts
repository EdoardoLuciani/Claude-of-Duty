import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type LaunchOptions } from 'playwright';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean> {
  return Object.fromEntries(
    argv.map((arg): [string, string | boolean] => {
      const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
      return match ? [match[1], match[2] ?? true] : [arg, true];
    })
  );
}

export function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolveOpen): void => {
    const socket = net.connect({ port, host }, (): void => {
      socket.destroy();
      resolveOpen(true);
    });
    socket.once('error', (): void => resolveOpen(false));
    socket.setTimeout(400, (): void => {
      socket.destroy();
      resolveOpen(false);
    });
  });
}

/** Bun binary: `bun run` exposes it via npm_execpath without putting it on PATH; plain
 *  `node` runs fall back to the installer's default location, then PATH. */
const INSTALLED_BUN = join(process.env.BUN_INSTALL ?? join(homedir(), '.bun'), 'bin', 'bun');
const NPM_EXECPATH = process.env.npm_execpath ?? '';
export const BUN = basename(NPM_EXECPATH).startsWith('bun')
  ? NPM_EXECPATH
  : existsSync(INSTALLED_BUN)
    ? INSTALLED_BUN
    : 'bun';

interface DevServerOptions {
  port?: number;
  root?: string;
  startupTimeoutMs?: number;
  intervalMs?: number;
  stdio?: StdioOptions;
  noHmr?: boolean;
  preview?: boolean;
}
/** Start one HMR-free Bun dev (or preview) server unless the requested port is already owned.
 * Dev generates assets before listening, so allow minutes and show build progress.
 * OW_STARTUP_TIMEOUT_MS overrides the default 15-minute startup deadline. */
export async function ensureDevServer({
  port = 5173,
  root = REPO_ROOT,
  startupTimeoutMs = Number(process.env.OW_STARTUP_TIMEOUT_MS ?? 15 * 60 * 1000),
  intervalMs = 250,
  // Keep capture/profile JSON on stdout; asset/server progress goes to stderr.
  stdio = ['ignore', 2, 2],
  noHmr = true,
  preview = false,
}: DevServerOptions = {}): Promise<ChildProcess | null> {
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0)
    throw new RangeError('startupTimeoutMs / OW_STARTUP_TIMEOUT_MS must be positive and finite');
  if (await portOpen(port)) return null;

  const server = spawn(BUN, ['build/bun.ts', preview ? 'preview' : 'dev', '--port', String(port)], {
    cwd: root,
    stdio,
    detached: false,
    env: noHmr ? { ...process.env, OW_NO_HMR: '1' } : process.env,
  });
  let startupError: Error | null = null;
  server.once('error', (error): void => {
    startupError = error;
  });
  server.once('exit', (code, signal): void => {
    startupError = new Error(
      signal ? `dev server exited on ${signal}` : `dev server exited with code ${code}`
    );
  });

  const deadline = performance.now() + startupTimeoutMs;
  while (!startupError && performance.now() < deadline) {
    await new Promise<void>((resolveWait): void => {
      setTimeout(resolveWait, Math.min(intervalMs, Math.max(0, deadline - performance.now())));
    });
    if (startupError) break;
    if (performance.now() < deadline && (await portOpen(port))) return server;
  }

  if (server.exitCode === null && server.signalCode === null) server.kill();
  throw (
    startupError ??
    new Error(`dev server failed to start on port ${port} after ${startupTimeoutMs} ms`)
  );
}

/** Shared console/device-validation error collection; fixture assertions stay local. */
interface BrowserConsoleMessage {
  text(): string;
  type(): string;
}
interface BrowserErrorSource {
  on(event: 'pageerror', listener: (error: Error) => void): unknown;
  on(event: 'console', listener: (message: BrowserConsoleMessage) => void): unknown;
}
export function collectBrowserErrors(
  page: BrowserErrorSource,
  errors: string[],
  {
    warnings = null,
    echo = false,
    validationMessages = false,
  }: {
    warnings?: string[] | null;
    echo?: boolean;
    validationMessages?: boolean;
  } = {}
): void {
  page.on('pageerror', (error): void => {
    errors.push(error.message);
  });
  page.on('console', (message): void => {
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

export function stopDevServer(server: ChildProcess | null | undefined): void {
  if (server?.exitCode === null && server.signalCode === null) server.kill();
}

/** Metal on macOS, D3D11 on Windows, Vulkan on Linux with a DRM node. Empty
 *  in CI (no /dev/dri) so Chromium keeps SwiftShader. */
function gpuAngleArgs(): string[] {
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
export async function launchChromium(options: LaunchOptions = {}): Promise<Browser> {
  const launch = {
    ...options,
    args: [
      ...gpuAngleArgs(),
      '--enable-unsafe-webgpu',
      ...(process.platform === 'linux' ? ['--enable-features=Vulkan'] : []),
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
  ].filter((path): path is string => typeof path === 'string');
  const executablePath = candidates.find((path): boolean => existsSync(path));
  if (!executablePath) return chromium.launch(launch); // retain Playwright's useful install error
  return chromium.launch({ ...launch, executablePath });
}
