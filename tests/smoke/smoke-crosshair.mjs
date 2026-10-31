import assert from 'node:assert/strict';

import { Crosshair } from '../../src/ui/crosshair.ts';

let elements = 0;
const oldDocument = globalThis.document;
globalThis.document = {
  createElement: () => {
    elements++;
    return { style: { setProperty() {} }, appendChild() {}, remove() {} };
  },
};
try {
  const parent = { appendChild() {} };
  const dom = new Crosshair(parent);
  assert.equal(elements, 6);
  const gpu = new Crosshair(parent, true);
  assert.equal(elements, 6, 'GPU path creates no DOM elements');
  assert.equal(gpu.root, null);
  const fields = ['kick', 'kickVel', 'moveSpread', 'adsBlend', 'hitPulse', 'visible', 'k'];
  const state = {};
  for (let i = 0; i < 1200; i++) {
    state.move = (i % 90) / 90;
    state.sprint = i % 160 < 30;
    state.crouch = i % 140 < 20;
    state.airborne = i % 170 < 12;
    state.ads = i % 100 < 40;
    state.hidden = i > 900;
    state.baseSpread = 6;
    if (i % 11 === 0) {
      dom.onFire(0.8);
      gpu.onFire(0.8);
    }
    if (i % 43 === 0) {
      dom.onFlinch();
      gpu.onFlinch();
      dom.onHit();
      gpu.onHit();
    }
    dom.setScale(0.5 + (i % 3) * 0.5);
    gpu.setScale(dom.k);
    const dt = i % 70 === 0 ? 0 : 1 / 60;
    dom.update(dt, state);
    gpu.update(dt, state);
    for (const field of fields) assert.equal(gpu[field], dom[field], field);
  }
  assert(gpu.visible < 0.004, 'hidden reticle settles to invisible');
  const presenter = gpu.gpu;
  presenter.update(6, 1, 1, 1, 0, 1);
  const originalDraw = () => {};
  const originalMrt = {};
  const renderer = {
    autoClear: true,
    toneMapping: 4,
    outputColorSpace: 'srgb',
    mrt: originalMrt,
    draw: originalDraw,
    getPixelRatio: () => 0.72,
    getMRT() {
      return this.mrt;
    },
    setMRT(value) {
      this.mrt = value;
    },
    getRenderObjectFunction() {
      return this.draw;
    },
    setRenderObjectFunction(value) {
      this.draw = value;
    },
    render() {
      assert.equal(this.autoClear, false, 'never clear the world attachment');
      assert.equal(this.toneMapping, 0);
      assert.equal(this.outputColorSpace, 'srgb-linear', 'no implicit output target');
      assert.equal(this.mrt, null);
      assert.equal(this.draw, null);
      throw new Error('test draw failure');
    },
  };
  presenter.draw(renderer, 1920, 1080, 1); // disabled until UI publishes an active pose
  presenter.enabled = true;
  presenter.draw(renderer, 1920, 1080, 0); // fully faded HUD also skips submission
  assert.throws(() => presenter.draw(renderer, 1920, 1080, 1), /test draw failure/);
  assert.equal(renderer.autoClear, true);
  assert.equal(renderer.toneMapping, 4);
  assert.equal(renderer.outputColorSpace, 'srgb');
  assert.equal(renderer.mrt, originalMrt);
  assert.equal(renderer.draw, originalDraw);
  let disposals = 0;
  presenter.geometry.addEventListener('dispose', () => disposals++);
  presenter.material.addEventListener('dispose', () => disposals++);
  gpu.dispose();
  dom.dispose();
  assert.equal(disposals, 2);
  assert.equal(presenter.enabled, false);
  console.log(
    'ok crosshair: shared animation, zero DOM GPU path, visibility, draw state and disposal'
  );
} finally {
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
}
