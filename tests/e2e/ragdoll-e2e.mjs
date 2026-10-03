/** Real death handoff, fixed-step physics and skeleton read-back in the game. */
import assert from 'node:assert/strict';
import { verifyNative, captureNative } from './native-render.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5199);
const out = resolve(args.out ?? '/tmp/ragdoll-gameplay');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { timeout: 120000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await verifyNative(page);
  await page.evaluate(() => window.__PUMP__(30));
  for (const variant of ['vanguard', 'irregular', 'breacher']) {
    await page.evaluate(async name => {
      const { combatLane } = await import('/tools/lib/combat-fixture.js');
      const e = window.__ENGINE__, ctx = e.ctx, ai = ctx.get('ai');
      for (const a of ai.agents.slice()) a.dispose();
      ai.agents.length = 0;
      ai.squads.length = 0;
      const { positions } = combatLane(ai, ctx.get('world'), ctx.get('physics'), [[5, 0]]);
      const p = positions[1], a = ai.spawn(name, p, 0);
      a.animator.update(1 / 60, ctx.time.elapsed);
      a.group.updateMatrixWorld(true);
      const rest = a.skeleton.bones.map(b => b.position.length());
      const player = ctx.get('player');
      e.input.frozen = true;
      e.input.enabled = false;
      player.setControlEnabled(false);
      player.teleport({ x: p.x + 3, y: p.y + 3, z: p.z + 4 }, 0);
      e.camera.position.set(p.x + 3, p.y + 3, p.z + 4);
      e.camera.lookAt(p.x, p.y + 0.7, p.z);
      e.camera.fov = 55;
      e.camera.updateProjectionMatrix();
      e.viewScene.visible = false;
      document.getElementById('ui').style.display = 'none';
      a.applyDamage(260, 'torso', p.clone().setY(p.y + 1.35), p.clone().set(1, 0, 0));
      const t = window.__RAGDOLL_TEST__ = { a, floor: p.y, maxSkin: 0, steps: 0 };
      const rd = a.ragdoll, step = rd.step.bind(rd);
      rd.step = h => { t.steps++; step(h); };
      ctx.get('physics').lateUpdate(0, ctx);
      // Observe every physics read-back, rather than only the photographed pose.
      const write = rd.writeToSkeleton.bind(rd);
      rd.writeToSkeleton = () => {
        write();
        for (let i = 1; i < a.skeleton.bones.length; i++) {
          t.maxSkin = Math.max(t.maxSkin, Math.abs(a.skeleton.bones[i].position.length() - rest[i]));
        }
      };
    }, variant);
    for (let frames = 60; frames <= 180; frames += 60) {
      await page.evaluate(() => window.__PUMP__(60));
      const result = await page.evaluate(() => {
        const t = window.__RAGDOLL_TEST__, rd = t.a.ragdoll;
        return { steps: t.steps, maxSkin: t.maxSkin, lowest: rd.aabb.miny - t.floor, sleeping: rd.sleeping };
      });
      assert.ok(result.steps >= frames, 'normal engine physics steps are advancing');
      assert.ok(result.maxSkin < 1e-5, `${variant}: no rendered joint separation`);
      assert.ok(Number.isFinite(result.lowest) && result.lowest > -0.2, `${variant}: corpse stays above the world floor`);
      results.push({ variant, frames, ...result });
      await captureNative(page, resolve(out, `${variant}-${frames}.png`));
    }
  }
  assert.deepEqual(errors, [], 'no browser exceptions');
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ out, results }, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
