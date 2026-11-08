/**
 * Eager model prefetches must not become unhandled rejections before boot awaits them.
 *
 *   node tests/smoke/smoke-prefetch-reject.ts
 */
import assert from 'node:assert/strict';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ModelSystem } from '../../src/core/models.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';

const delay = (ms: number): Promise<void> => new Promise((resolve): void => { setTimeout(resolve, ms); });

globalThis.fetch = async (url): Promise<Response> => {
  const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  if (href.includes('soldiers/breacher.json')) {
    await delay(20);
    return new Response(null, { status: 503 });
  }
  if (href.includes('level.json')) {
    await delay(80);
    return Response.json({ version: 2, assets: { visual: 'v.glb', collision: 'c.glb' } });
  }
  return new Response(null, { status: 404 });
};

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): number => unhandled.push(reason);
process.on('unhandledRejection', onUnhandled);

const models = new ModelSystem();
models.loader = fixture<GLTFLoader>({ load(): void {} });
await models.init(createTestContext());
await delay(60);
process.off('unhandledRejection', onUnhandled);

assert.equal(unhandled.length, 0, `unhandled rejection before consumer await: ${String(unhandled[0])}`);
await assert.rejects((): ReturnType<ModelSystem['getSoldier']> => models.getSoldier('breacher'));
console.log('smoke-prefetch-reject: ok');
