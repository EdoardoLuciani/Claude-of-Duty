import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

// Execute the actual module registrations without booting the game or renderer.
type DisposeCallback = (data: Record<string, unknown>) => Promise<void>;
function registration(
  file: string,
  dispose: () => Promise<void>,
  errors: unknown[][]
): DisposeCallback {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const start = source.lastIndexOf('if (import.meta.hot)');
  assert(start >= 0, `${file}: HMR disposal registration is present`);
  const code = source.slice(start).replaceAll('import.meta.hot', 'hot');
  let callback: DisposeCallback | undefined;
  runInNewContext(stripTypeScriptTypes(code), {
    hot: {
      dispose(value: DisposeCallback): void {
        callback = value;
      },
    },
    engine: { dispose },
    dispose,
    console: {
      error(...args: unknown[]): void {
        errors.push(args);
      },
    },
  });
  assert.equal(typeof callback, 'function');
  assert(callback);
  return callback;
}

const file = 'src/main.ts';
let finish = (): void => assert.fail('disposal has not started');
let disposed = false,
  imported = false;
const errors: unknown[][] = [];
const callback = registration(
  file,
  async (): Promise<void> => {
    await new Promise<void>((resolve): void => {
      finish = resolve;
    });
    disposed = true;
  },
  errors
);
const pending = callback({});
assert.equal(typeof pending?.then, 'function', `${file}: return the disposal promise`);
// Vite's fetchUpdate()/prunePaths() await the callback before replacement.
const update = (async (): Promise<void> => {
  await pending;
  imported = true;
})();
await new Promise<void>((resolve): void => {
  setImmediate(resolve);
});
assert.equal(disposed, false);
assert.equal(imported, false, `${file}: replacement waits for teardown`);
finish();
await update;
assert.equal(disposed, true);
assert.equal(imported, true);
assert.deepEqual(errors, []);

const failure = new Error('deferred disposal failed');
let reject: (error: Error) => void = (): never => assert.fail('rejection has not been registered');
const failed = registration(
  file,
  (): Promise<void> =>
    new Promise<void>((_, fail): void => {
      reject = fail;
    }),
  errors
)({});
assert.equal(typeof failed?.then, 'function');
reject(failure);
await assert.doesNotReject((): Promise<void> => failed);
assert.equal(errors.length, 1, `${file}: handle rejection exactly once`);
assert.equal(errors[0][1], failure);
assert(typeof errors[0][0] === 'string');
assert.match(errors[0][0], /HMR disposal failed/);
console.log(
  'HMR disposal: main module callback remains awaited and handles asynchronous rejection'
);
