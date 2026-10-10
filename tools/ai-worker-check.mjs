#!/usr/bin/env node
// Native worker oracle and collision/lifecycle controls. Duplicate main-thread
// execution makes this a correctness tool, never a performance measurement.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from './lib/browser-harness.mjs';
import { waitForGame } from './lib/native-render.mjs';
import { combatLane } from './lib/combat-fixture.js';
import { createCombatProfile, validateCombatProfile } from './lib/profile-combat.js';
const args = parseArgs(), port = Number(args.port ?? 5445), frames = Number(args.frames ?? 1800);
const server = await ensureViteServer({ port }); assert(server, 'choose an unused port');
let browser;
try {
  browser = await launchChromium({ headless: true, args: ['--mute-audio', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=high`); await waitForGame(page);
  await page.addScriptTag({ content: `window.__WORKER_FIXTURE__={create:${createCombatProfile.toString()},lane:${combatLane.toString()}};` });
  const result = await page.evaluate(async ({ frames, delay, negative }) => {
    const engine = window.__ENGINE__, nav = engine.ctx.get('ai').grid, service = nav.worker;
    const api = window.__WORKER_FIXTURE__, fixture = api.create(engine, api.lane);
    const receive = service.receive, remember = service.remember, timers = new Set();
    let verified = 0, immediateVerified = 0, failure = null;
    service.remember = function (key, value) {
      const k = key.split(',').map(Number);
      const native = nav._checkAttachment({ x: k[0], y: k[1], z: k[2] }, { x: k[3], y: k[4], z: k[5] }, k[6], k[7], k[8]);
      verified++; if (this.current) immediateVerified++;
      if (native !== value) failure = `worker/prefix differs from native attachment ${key}`;
      return remember.call(this, key, value);
    };
    service.receive = function (message) {
      const deliver = () => receive.call(this, message);
      if (delay) { const timer = setTimeout(() => { timers.delete(timer); deliver(); }, delay); timers.add(timer); }
      else deliver();
    };
    const before = window.__NATIVE_BUILDS__;
    try {
      for (let i = -120; i < frames; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve)); fixture.before(i); engine.step(); fixture.after();
        if (failure || engine.error) throw new Error(failure ?? String(engine.error));
      }
    } finally { service.receive = receive; service.remember = remember; for (const timer of timers) clearTimeout(timer); fixture.dispose(); }
    if (!verified) throw new Error('native oracle did not execute');
    const combat = fixture.report, stats = { ...service.stats }, builders = window.__NATIVE_BUILDS__ - before;

    const { StaticWorld } = await import('/src/physics/bvh.js');
    const { CharacterController } = await import('/src/physics/character.js');
    const { AttachmentQueries, NAV_PENDING } = await import('/src/ai/attachment-queries.js');
    const { canStand, checkAttachment } = await import('/src/ai/attachment.js');
    const vector = () => engine.ctx.get('ai').agents[0].position.clone();
    const world = new StaticWorld();
    world.addTriangles(new Float32Array([-3,0,-3,-3,0,3,3,0,3,3,0,3,3,0,-3,-3,0,-3]), 2, 'concrete'); world.build();
    const physics = { staticWorld: world, gravity: -20, MASK: { CHARACTER: 259 },
      checkCapsule: (a,b,r,m) => world.overlapCapsule(a.x,a.y,a.z,b.x,b.y,b.z,r,m,0) === 0 };
    const probe = { physics, _probe: new CharacterController(world), _p0: vector(), _p1: vector(), canStand, stats: { endpointChecks: 0 } };
    const worker = new AttachmentQueries(probe), a = vector().set(0,.008,0), b = vector().set(1,.008,0);
    const native = () => checkAttachment.call(probe,a,b,.32,1.78,80);
    const query = () => worker.run(1,'control',() => worker.request(a,b,.32,1.78,80));
    const wait = async () => { const end = performance.now()+5000; let value;
      while ((value=query()) === NAV_PENDING) { if (performance.now()>end) throw new Error('control query stalled'); await new Promise(r=>setTimeout(r,0)); }
      return value;
    };
    try {
      await worker.start();
      if (!native() || !(await wait())) throw new Error('floor control must be reachable');
      worker.paused = true; if (query() !== NAV_PENDING) throw new Error('pause admitted a planning result'); worker.paused = false;
      world.addTriangles(new Float32Array([.5,0,-2,.5,0,2,.5,3,2,.5,3,2,.5,3,-2,.5,0,-2]),2,'concrete'); world.build();
      if (native()) throw new Error('wall control must block movement');
      if (negative) worker.config = worker.signature();
      if (query() !== NAV_PENDING) throw new Error('changed collision retained stale worker success');
      await worker.start();
      if (await wait()) throw new Error('rebuilt worker ignored real collision wall');
      worker.clear(); query(); const id = [...worker.jobs.keys()][0]; worker.cancel('1:control');
      worker.receive({ type:'result', id, value:true, ms:0, moves:0 });
      if (worker.proofs.size || worker.jobs.size) throw new Error('cancelled request resurrected');
      worker.worker.onerror({ message:'intentional worker failure' });
      let failed = false; try { query(); } catch (error) { failed = error.message.includes('intentional worker failure'); }
      if (!failed) throw new Error('worker failure was not propagated');
    } finally { worker.dispose(); }
    return { verified, immediateVerified, combat, stats, builders, delay, controls: ['real collision revision', 'pause', 'cancellation', 'worker failure', 'disposal'] };
  }, { frames, delay: Number(args.delay ?? 0), negative: !!args.negative });
  assert.deepEqual(errors, []); validateCombatProfile(result.combat); assert.equal(result.builders, 0);
  writeFileSync(String(args.out ?? '/tmp/ai-worker-check.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  await page.evaluate(() => window.__ENGINE__.dispose());
} finally { try { await browser?.close(); } finally { stopViteServer(server); } }
