/**
 * Eager model prefetches must not become unhandled rejections before boot awaits them.
 *
 *   node tools/smoke-prefetch-reject.mjs
 */
import assert from 'node:assert/strict';
import { ModelSystem } from '../src/core/models.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

globalThis.fetch = async (url) => {
  const href = String(url);
  if (href.includes('soldiers/breacher.json')) {
    await delay(20);
    return { ok: false, status: 503 };
  }
  if (href.includes('level.json')) {
    await delay(80);
    return {
      ok: true,
      json: async () => ({ version: 2, assets: { visual: 'v.glb', collision: 'c.glb' } }),
    };
  }
  return { ok: false, status: 404 };
};

const unhandled = [];
const onUnhandled = (reason) => unhandled.push(reason);
process.on('unhandledRejection', onUnhandled);

const models = new ModelSystem();
models.loader = { load() {} };
await models.init({});
await delay(60);
process.off('unhandledRejection', onUnhandled);

assert.equal(unhandled.length, 0, `unhandled rejection before consumer await: ${unhandled[0]}`);
await assert.rejects(() => models.getSoldier('breacher'));
console.log('smoke-prefetch-reject: ok');
