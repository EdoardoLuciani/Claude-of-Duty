// Exercise the real CLI/browser loop, including failures before any samples and
// after ten measured steps. No source-string mutation or production test flags.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { portOpen } from '../../tools/lib/browser-harness.mjs';

const port = Number(process.env.OW_E2E_PORT ?? 5398);
const out = join(mkdtempSync(join(tmpdir(), 'cod-profile-failure-')), 'report.json');
const launch = chromium.launch.bind(chromium), argv = process.argv;
for (const failAt of [130, 1]) {
  assert.equal(await portOpen(port), false, 'choose an unused OW_E2E_PORT');
  writeFileSync(out, JSON.stringify({ failure: null, previousRun: true }));
  let browser;
  const markers = [];
  chromium.launch = async (...args) => {
    browser = await launch(...args);
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...args) => {
      const page = await newPage(...args), addScriptTag = page.addScriptTag.bind(page);
      page.on('console', m => { if (m.text().startsWith('profile-failure:')) markers.push(m.text()); });
      page.addScriptTag = async (...args) => {
        const result = await addScriptTag(...args);
        await page.evaluate(failAt => {
          const create = window.__PROFILE__?.create;
          if (!create) throw new Error('profile fixture injection failed');
          window.__PROFILE__.create = (...args) => {
            const engine = args[0], render = engine.ctx.get('render');
            const originalRender = render.render;
            const fixture = create(...args), after = fixture.after, dispose = fixture.dispose;
            let steps = 0;
            fixture.after = () => {
              if (++steps === failAt) {
                engine.ctx.get('ai').agents[0].staged = true;
                console.log('profile-failure:injected');
              }
              after(); // The real living-combat gate must reject the staged actor.
            };
            fixture.dispose = () => {
              dispose();
              const input = engine.input;
              if (render.render !== originalRender || input._rawLook.x || input._rawLook.y ||
                  ['KeyW', 'KeyS', 'Mouse0', 'KeyR', 'Tab'].some(key =>
                    input.down.has(key) || input._pendingDown.has(key) || input._pendingUp.has(key)))
                throw new Error('profile cleanup failed');
              console.log('profile-failure:cleaned');
            };
            return fixture;
          };
        }, failAt);
        return result;
      };
      return page;
    };
    return browser;
  };
  try {
    process.argv = [process.execPath, 'tools/profile.mjs', `--port=${port}`, '--frames=900', `--out=${out}`];
    await assert.rejects(import(`../../tools/profile.mjs?failAt=${failAt}`), /living-combat fixture died or used staged AI/);
    assert.deepEqual(markers, ['profile-failure:injected', 'profile-failure:cleaned']);
    assert.equal(browser.isConnected(), false, 'CLI must close its browser');
    for (let i = 0; i < 20 && await portOpen(port); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await portOpen(port), false, 'CLI must release its server port');
    const report = JSON.parse(readFileSync(out, 'utf8'));
    assert.notEqual(report.previousRun, true, 'mid-run failure retained the stale successful report');
    assert.match(report.failure, /living-combat fixture died or used staged AI/);
    assert.equal(report.summary, null, 'failed runs must not present benchmark percentiles');
    assert.equal(report.samples.length, Math.max(0, failAt - 120));
    assert.equal(report.combat.frames, Math.max(0, failAt - 121));
    if (report.samples.length) {
      assert.equal(report.samples.at(-1).dt, null, 'no fabricated final interval');
      assert(report.samples.slice(0, -1).every(s => Number.isFinite(s.dt)));
    }
    assert.deepEqual(report.errors, []);
    console.log(`failure at step ${failAt}: partial report, original error and cleanup preserved`);
  } finally {
    process.argv = argv;
    chromium.launch = launch;
    await browser?.close();
  }
}
