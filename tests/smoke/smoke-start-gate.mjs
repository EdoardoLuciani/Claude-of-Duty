import assert from 'node:assert/strict';

import { StartGate } from '../../src/ui/start.ts';

const listeners = new Map();
const frames = new Map();
let nextFrame = 0;
globalThis.requestAnimationFrame = (fn) => {
  frames.set(++nextFrame, fn);
  return nextFrame;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const flush = () => {
  const pending = [...frames.values()];
  frames.clear();
  for (const fn of pending) fn();
};
const elements = [];
globalThis.document = {
  pointerLockElement: null,
  createElement: () => {
    const node = {
      style: {},
      open: false,
      setAttribute() {},
      append() {},
      focus() {},
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
      remove() {},
    };
    elements.push(node);
    return node;
  },
  body: { append() {} },
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type) => listeners.delete(type),
};
function fixture(visible = true) {
  const order = [];
  let errorListener;
  const engine = {
    error: null,
    _running: true,
    gameplaySuspended: true,
    viewScene: { visible },
    input: { enabled: false },
    canvas: { requestPointerLock() {} },
    ctx: { get: () => ({ setControlEnabled: (value) => order.push(`control:${value}`) }) },
    setGameplaySuspended(value) {
      this.gameplaySuspended = value;
      order.push(`suspend:${value}`);
    },
    events: {
      on: (_type, fn) => {
        errorListener = fn;
        return () => {};
      },
      emit: () => {
        assert.equal(engine.gameplaySuspended, true, 'suspend BEFORE reset listeners');
        assert.equal(engine.viewScene.visible, false);
        order.push('reset');
      },
    },
  };
  const gate = new StartGate(engine);
  gate.ready();
  const button = elements.findLast((node) => typeof node.onclick === 'function');
  const click = () => button.onclick();
  const lock = () => {
    document.pointerLockElement = engine.canvas;
    listeners.get('pointerlockchange')();
  };
  const fail = () => {
    engine.error = {};
    errorListener();
  };
  return { engine, gate, click, lock, fail, order };
}
let f = fixture();
assert.equal(f.engine.viewScene.visible, false);
assert.equal(f.gate.afterPose(), false);
f.lock();
flush();
assert.equal(f.engine.gameplaySuspended, true, 'actual lock without intent is insufficient');
document.pointerLockElement = null;
f.click();
flush();
assert.equal(f.engine.gameplaySuspended, true, 'request is not acquisition');
listeners.get('pointerlockerror')();
f.click();
f.lock();
assert.equal(f.engine.gameplaySuspended, true, 'lock event must not resume mid-dispatch');
flush();
assert.equal(f.engine.gameplaySuspended, false);
assert.equal(f.engine.viewScene.visible, false, 'keep hidden until normal pose hooks');
assert.equal(f.gate.afterPose(), true);
assert.equal(f.engine.viewScene.visible, true);
f.order.length = 0;
f.gate.restart(); // Already-held-lock New Game must not wait for a new change event.
assert.deepEqual(f.order.slice(0, 3), ['suspend:true', 'control:false', 'reset']);
assert.equal(f.engine.gameplaySuspended, true);
flush();
assert.equal(f.engine.gameplaySuspended, false);
f.gate.afterPose();
// A lock lost between confirmation and the next frame cannot authorize a run.
f.gate.restart();
document.pointerLockElement = null;
flush();
assert.equal(f.engine.gameplaySuspended, true);
f.click();
f.lock();
f.fail();
flush();
assert.equal(f.engine.gameplaySuspended, true);
assert.equal(f.engine.input.enabled, false);
assert.equal(f.gate.afterPose(), false);
f.gate.dispose();
assert.equal(f.engine.viewScene.visible, true, 'disposal restores borrowed visibility');
assert.equal(listeners.size, 0);

f = fixture(false);
f.click();
f.lock();
flush();
f.gate.afterPose();
assert.equal(f.engine.viewScene.visible, false, 'do not override prior root visibility');
f.gate.restart();
f.gate.dispose();
flush();
assert.equal(f.engine.gameplaySuspended, true, 'disposed queued callback cannot activate');
f = fixture();
f.click();
f.lock();
f.engine._running = false;
flush();
assert.equal(f.engine.gameplaySuspended, true, 'stopped/disposal loop cannot activate');
f.gate.dispose();
console.log(
  'smoke-start-gate: ok (intent, actual lock, retry, frame boundary, reset, pose, terminal, teardown)'
);
