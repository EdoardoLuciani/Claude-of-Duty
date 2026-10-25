import assert from 'node:assert/strict';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const port = 5548;
const server = await ensureViteServer({ port });
assert(server, 'Audio/Start regression requires a dedicated server');
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio', '--autoplay-policy=user-gesture-required'],
  });
  for (const activation of ['Enter', 'Space', 'mouse', 'unavailable']) {
    // A fresh context per activation: no earlier pointer/key gesture can unlock audio.
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/audio-start-fixture', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' })
    );
    await page.goto(`http://127.0.0.1:${port}/audio-start-fixture`);
    await page.evaluate(async (unavailable) => {
      const [{ AudioSystem }, { StartGate }, { EventBus }, { Rng }] = await Promise.all([
        import('/src/audio/index.ts'),
        import('/src/ui/start.ts'),
        import('/src/core/registry.ts'),
        import('/src/core/rng.ts'),
      ]);
      if (unavailable) window.AudioContext = undefined;
      const audio = new AudioSystem();
      window.audio = audio;
      window.starts = [];
      window.keys = [];
      const startGraph = audio._startGraph.bind(audio);
      audio._startGraph = () => {
        window.starts.push(navigator.userActivation.isActive);
        return startGraph();
      };
      window.addEventListener('keydown', (event) => window.keys.push(event.code));
      window.addEventListener('keyup', (event) => window.keys.push(event.code));
      const events = new EventBus();
      const engine = (window.engine = {
        events,
        error: null,
        _running: true,
        canvas: document.querySelector('canvas'),
        viewScene: { visible: true },
        input: { enabled: false },
        ctx: {
          events,
          rng: new Rng(520),
          peek: () => null,
          get: () => ({ setControlEnabled() {} }),
        },
        setGameplaySuspended(value) {
          this.gameplaySuspended = value;
        },
      });
      await audio.init(engine.ctx);
      // No gameplay pump: native audio keeps ticking independently of gameplay hooks.
      window.gate = new StartGate(engine);
      window.gate.ready();
    }, activation === 'unavailable');
    assert.deepEqual(
      await page.evaluate(() => [window.audio.actx, window.starts.length]),
      [null, 0],
      'fresh load has never started audio'
    );
    if (activation === 'mouse') await page.getByRole('button', { name: 'START' }).click();
    else await page.keyboard.press(activation === 'unavailable' ? 'Enter' : activation);
    await page.waitForFunction(() => !window.engine.gameplaySuspended);
    await page.waitForFunction(() => window.audio.running || window.audio.failed, null, {
      timeout: 10000,
    });
    assert.deepEqual(await page.evaluate(() => window.starts), [true], 'one graph, in gesture');
    assert.deepEqual(await page.evaluate(() => window.keys), [], 'dialog keys stay isolated');
    if (activation === 'unavailable') {
      assert.equal(await page.evaluate(() => window.audio.failed), true);
      assert.equal(await page.evaluate(() => window.engine.input.enabled), true);
    } else {
      assert.equal(await page.evaluate(() => window.audio.running), true);
      assert.deepEqual(
        await page.evaluate(() => Promise.all([window.audio.start(), window.audio.start()])),
        [true, true]
      );
      assert.equal(await page.evaluate(() => window.starts.length), 1);
      const before = await page.evaluate(async () => {
        const { audio, engine } = window;
        const mixer = audio.mixer;
        window.hearingUpdates = 0;
        const update = mixer.update.bind(mixer);
        mixer.update = (...args) => {
          window.hearingUpdates++;
          return update(...args);
        };
        engine.events.emit('explosion', { position: { x: 0, y: 0, z: 0 }, radius: 6 });
        await new Promise((resolve) => setTimeout(resolve, 250));
        mixer.update(0); // Deliver the initial delayed concussion before the death/restart.
        audio.deafness = mixer.deafness;
        audio.stats.deafness = mixer.deafness;
        // A second explosion also leaves a pending concussion to cancel.
        engine.events.emit('explosion', { position: { x: 0, y: 0, z: 0 }, radius: 6 });
        const analyser = (window.ringAnalyser = audio.actx.createAnalyser());
        analyser.fftSize = 2048;
        // Isolate the tinnitus from the finite explosion tail.
        mixer._tin.g.connect(analyser);
        window.endedTones = 0;
        for (const node of mixer._tin.nodes)
          if ('onended' in node) node.onended = () => window.endedTones++;
        await new Promise((resolve) => setTimeout(resolve, 150));
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        const peak = Math.max(...samples.map(Math.abs));
        engine.events.emit('ui:pause', { paused: true });
        const paused = mixer.deafness > 0 && mixer._tin !== null;
        engine.events.emit('player:death', {});
        const pending = mixer._pendingConcussion !== null;
        window.gate.restart();
        return { peak, paused, pending, clock: audio.actx.currentTime };
      });
      assert(before.peak > 0.001, 'real native tinnitus is sounding before restart');
      assert(before.paused, 'ordinary pause preserves transient hearing state');
      assert(before.pending, 'restart also has delayed concussion work to cancel');
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => {
        const { audio, engine } = window;
        const mixer = audio.mixer;
        const samples = new Float32Array(window.ringAnalyser.fftSize);
        window.ringAnalyser.getFloatTimeDomainData(samples);
        return {
          suspended: engine.gameplaySuspended,
          clock: audio.actx.currentTime,
          updates: window.hearingUpdates,
          deafness: [audio.deafness, audio.stats.deafness, mixer.deafness],
          pending: mixer._pendingConcussion,
          tinnitus: mixer._tin !== null,
          ended: window.endedTones,
          peak: Math.max(...samples.map(Math.abs)),
          hearing: [
            mixer.muffleDry.gain.value,
            mixer.muffleWet.gain.value,
            mixer.muffleGain.gain.value,
          ],
        };
      });
      assert(after.suspended);
      assert(after.clock > before.clock, 'native clock advances while gameplay is suspended');
      assert.equal(after.updates, 1, 'no hearing update can clean up after restart');
      assert.deepEqual(after.deafness, [0, 0, 0]);
      assert.equal(after.pending, null);
      assert.equal(after.tinnitus, false);
      assert.equal(after.ended, 4, 'all three tones and their LFO are explicitly stopped');
      assert(after.peak < 1e-6, 'no ringing survives without gameplay hooks');
      assert.deepEqual(after.hearing, [1, 0, 1], 'healthy bypass settles without gameplay hooks');
    }
    assert.deepEqual(errors, []);
    await page.evaluate(() => {
      window.gate.dispose();
      window.audio.dispose();
    });
    await context.close();
    console.log(`audio-start-gate: ${activation} passed`);
  }
} finally {
  await browser?.close();
  stopViteServer(server);
}
