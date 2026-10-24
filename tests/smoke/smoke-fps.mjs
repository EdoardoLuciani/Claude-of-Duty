import assert from 'node:assert/strict';

import { UiSystem } from '../../src/ui/index.ts';

const ui = new UiSystem();
ui.fps = { textContent: '— FPS' };

// The first frame starts sampling; startup/prewarm time is not counted.
ui._updateFps(10000);
for (let i = 1; i < 30; i++) ui._updateFps(10000 + (i * 500) / 30);
assert.equal(ui.fps.textContent, '— FPS', 'avoid per-frame text updates');
ui._updateFps(10500);
assert.equal(ui.fps.textContent, '60 FPS');

// Sampling resets each window and is independent of paused/scaled game time.
ui.ctx = { time: { dt: 0, scale: 0, raw: 0 } };
for (let i = 1; i <= 15; i++) ui._updateFps(10500 + (i * 500) / 15);
assert.equal(ui.fps.textContent, '30 FPS');

// A long frame is measured in full, not clamped to the engine's 100 ms limit.
ui._updateFps(12000);
assert.equal(ui.fps.textContent, '1 FPS');
assert.equal(ui._fpsFrames, 0);
console.log('FPS counter smoke passed');
