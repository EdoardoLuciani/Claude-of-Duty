import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

// Execute the actual module registrations without booting the game or renderer.
function registration(file, dispose, errors) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  const start = source.lastIndexOf('if (import.meta.hot)');
  assert(start >= 0, `${file}: HMR disposal registration is present`);
  const code = source.slice(start).replaceAll('import.meta.hot', 'hot');
  let callback;
  runInNewContext(stripTypeScriptTypes(code), {
    hot: {
      dispose(value) {
        callback = value;
      },
    },
    engine: { dispose },
    dispose,
    console: {
      error(...args) {
        errors.push(args);
      },
    },
  });
  assert.equal(typeof callback, 'function');
  return callback;
}

for (const file of ['src/main.ts']) {
  let finish,
    disposed = false,
    imported = false;
  const errors = [];
  const callback = registration(
    file,
    async () => {
      await new Promise((resolve) => {
        finish = resolve;
      });
      disposed = true;
    },
    errors
  );
  const pending = callback({});
  assert.equal(typeof pending?.then, 'function', `${file}: return the disposal promise`);
  // Vite's fetchUpdate()/prunePaths() await the callback before replacement.
  const update = (async () => {
    await pending;
    imported = true;
  })();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed, false);
  assert.equal(imported, false, `${file}: replacement waits for teardown`);
  finish();
  await update;
  assert.equal(disposed, true);
  assert.equal(imported, true);
  assert.deepEqual(errors, []);

  const failure = new Error('deferred disposal failed');
  let reject;
  const failed = registration(
    file,
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
    errors
  )({});
  assert.equal(typeof failed?.then, 'function');
  reject(failure);
  await assert.doesNotReject(() => failed);
  assert.equal(errors.length, 1, `${file}: handle rejection exactly once`);
  assert.equal(errors[0][1], failure);
  assert.match(errors[0][0], /HMR disposal failed/);
}
console.log(
  'HMR disposal: main module callback remains awaited and handles asynchronous rejection'
);
