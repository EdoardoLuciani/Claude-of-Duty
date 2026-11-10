import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureDevServer, portOpen, stopDevServer } from '../../tools/lib/browser-harness.ts';

const directory = mkdtempSync(join(tmpdir(), 'cod-browser-startup-'));
const previousTimeout = process.env.OW_STARTUP_TIMEOUT_MS;
let server: ChildProcess | null = null;
const wait = (ms: number): Promise<void> =>
  new Promise((resolve): void => {
    setTimeout(resolve, ms);
  });

async function unusedPort(): Promise<number> {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert(address && typeof address !== 'string');
  const closed = once(socket, 'close');
  socket.close();
  await closed;
  return address.port;
}

try {
  mkdirSync(join(directory, 'build'));
  const entry = join(directory, 'build/bun.ts');
  const delayedServer = (delay: number): void => {
    // Real external Bun process: model asset work that finishes before listening.
    writeFileSync(
      entry,
      `import net from 'node:net';
if (process.env.OW_NO_HMR !== '1') process.exit(9);
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
setTimeout(() => net.createServer(socket => socket.end()).listen(port, '127.0.0.1'), ${delay});
`
    );
  };
  const port = await unusedPort();
  process.env.OW_STARTUP_TIMEOUT_MS = '3000';
  delayedServer(150);
  server = await ensureDevServer({ port, root: directory, intervalMs: 10, stdio: 'ignore' });
  assert(server, 'slow preparation is allowed within the configured deadline');
  assert(await portOpen(port));
  assert.equal(
    await ensureDevServer({ port, root: join(directory, 'absent') }),
    null,
    'reuse an existing listener without starting another process'
  );
  const exited = once(server, 'exit');
  stopDevServer(server);
  await exited;
  server = null;

  process.env.OW_STARTUP_TIMEOUT_MS = '80';
  delayedServer(500);
  await assert.rejects(
    ensureDevServer({ port, root: directory, intervalMs: 10, stdio: 'ignore' }),
    /failed to start.*after 80 ms/
  );
  await wait(600);
  assert(!(await portOpen(port)), 'timeout kills the process before its delayed listen');

  for (const code of [0, 7]) {
    writeFileSync(entry, `process.exit(${code});\n`);
    await assert.rejects(
      ensureDevServer({
        port,
        root: directory,
        startupTimeoutMs: 3000,
        intervalMs: 10,
        stdio: 'ignore',
      }),
      new RegExp(`dev server exited with code ${code}`)
    );
  }
  await assert.rejects(
    ensureDevServer({
      port,
      root: join(directory, 'absent'),
      startupTimeoutMs: 3000,
      stdio: 'ignore',
    }),
    /ENOENT/
  );

  for (const value of ['invalid', '0', '-1', 'Infinity']) {
    process.env.OW_STARTUP_TIMEOUT_MS = value;
    await assert.rejects(ensureDevServer({ port, root: directory }), /positive and finite/);
  }
  // An explicit caller budget takes precedence over the environment.
  delayedServer(0);
  server = await ensureDevServer({
    port,
    root: directory,
    startupTimeoutMs: 3000,
    intervalMs: 10,
    stdio: 'ignore',
  });
  assert(server);
} finally {
  if (server) {
    const exited = once(server, 'exit');
    stopDevServer(server);
    await exited;
  }
  if (previousTimeout === undefined) delete process.env.OW_STARTUP_TIMEOUT_MS;
  else process.env.OW_STARTUP_TIMEOUT_MS = previousTimeout;
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  'browser startup: configurable deadlines, delayed readiness, reuse, failures and cleanup'
);
