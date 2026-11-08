import assert from 'node:assert/strict';

import { PlayerSystem } from '../../src/player/index.ts';
import { StartGate } from '../../src/ui/start.ts';
import { createTestContext } from '../lib/context.ts';
import { createCoreFixture } from '../lib/core-fixture.ts';
import { fixture } from '../lib/fixture.ts';

const listeners = new Map<string, EventListenerOrEventListenerObject>();
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
globalThis.requestAnimationFrame = (fn): number => {
  frames.set(++nextFrame, fn);
  return nextFrame;
};
globalThis.cancelAnimationFrame = (id): void => {
  frames.delete(id);
};
const flush = (): void => {
  const pending = [...frames.values()];
  frames.clear();
  for (const fn of pending) fn(0);
};
const elements: HTMLElement[] = [];
function createElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
/** @deprecated Mirrors the native overload, not an additional test capability. */
function createElement<K extends keyof HTMLElementDeprecatedTagNameMap>(
  tag: K
): HTMLElementDeprecatedTagNameMap[K];
function createElement(tag: string): HTMLElement;
function createElement(tag: string): HTMLElement {
  const members = {
    style: fixture<CSSStyleDeclaration>({}),
    onclick: null,
    setAttribute(): void {},
    append(): void {},
    focus(): void {},
    remove(): void {},
  };
  let node: HTMLElement;
  switch (tag) {
    case 'dialog': {
      const dialog = fixture<HTMLDialogElement>({
        ...members,
        open: false,
        showModal(): void {
          dialog.open = true;
        },
        close(): void {
          dialog.open = false;
        },
      });
      node = dialog;
      break;
    }
    case 'button':
      node = fixture<HTMLButtonElement>(members);
      break;
    case 'p':
      node = fixture<HTMLParagraphElement>(members);
      break;
    case 'h1':
      node = fixture<HTMLHeadingElement>(members);
      break;
    default:
      throw new Error(`Unexpected test element: ${tag}`);
  }
  elements.push(node);
  return node;
}
let pointerLockElement: Element | null = null;
globalThis.document = fixture<Document>({
  get pointerLockElement(): Element | null {
    return pointerLockElement;
  },
  createElement,
  body: fixture<HTMLElement>({ append(): void {} }),
  addEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
    if (fn) listeners.set(type, fn);
  },
  removeEventListener(type: string): void {
    listeners.delete(type);
  },
});
function dispatch(type: string): void {
  const listener = listeners.get(type);
  assert(listener);
  const event = new Event(type);
  if (typeof listener === 'function') listener(event);
  else listener.handleEvent(event);
}
function createStartFixture(visible = true): {
  engine: ReturnType<typeof createCoreFixture>['engine'];
  gate: StartGate;
  click: () => void;
  lock: () => void;
  fail: () => void;
  order: string[];
} {
  const order: string[] = [];
  const { engine } = createCoreFixture();
  engine._running = true;
  engine.viewScene.visible = visible;
  engine.canvas.requestPointerLock = async (): Promise<void> => {};
  const player = new PlayerSystem();
  player.setControlEnabled = (value): void => {
    order.push(`control:${value}`);
  };
  engine.ctx = createTestContext({
    engine,
    providers: { player },
  });
  const suspend = engine.setGameplaySuspended.bind(engine);
  engine.setGameplaySuspended = (value): void => {
    suspend(value);
    order.push(`suspend:${value}`);
  };
  engine.events.on('game:restart', (): void => {
    assert.equal(engine.gameplaySuspended, true, 'suspend BEFORE reset listeners');
    assert.equal(engine.viewScene.visible, false);
    order.push('reset');
  });
  const gate = new StartGate(engine);
  gate.ready();
  const button = [...elements]
    .reverse()
    .find((node): boolean => typeof node.onclick === 'function');
  assert(button);
  const click = (): void => {
    assert(button.onclick);
    button.onclick(fixture<PointerEvent>({}));
  };
  const lock = (): void => {
    pointerLockElement = engine.canvas;
    dispatch('pointerlockchange');
  };
  const fail = (): void => {
    engine.error = { system: 'fixture', method: 'test', message: 'terminal failure' };
    engine.events.emit('engine:error', engine.error);
  };
  return { engine, gate, click, lock, fail, order };
}
let f = createStartFixture();
assert.equal(f.engine.viewScene.visible, false);
assert.equal(f.gate.afterPose(), false);
f.lock();
flush();
assert.equal(f.engine.gameplaySuspended, true, 'actual lock without intent is insufficient');
pointerLockElement = null;
f.click();
flush();
assert.equal(f.engine.gameplaySuspended, true, 'request is not acquisition');
dispatch('pointerlockerror');
f.click();
f.lock();
assert.equal(f.engine.gameplaySuspended, true, 'lock event must not resume mid-dispatch');
flush();
assert.equal(f.engine.gameplaySuspended, false);
assert.equal(f.engine.viewScene.visible, false, 'keep hidden until normal pose hooks');
assert.equal(f.gate.afterPose(), true);
assert.equal(f.engine.viewScene.visible, true);
f.order.length = 0;
f.gate.restart(); // Even a retained lock cannot bypass the new run's Start dialog.
assert.deepEqual(f.order.slice(0, 3), ['suspend:true', 'control:false', 'reset']);
assert.equal(f.engine.gameplaySuspended, true);
flush();
assert.equal(f.engine.gameplaySuspended, true, 'New Game is not implicit Start intent');
assert.equal(f.engine.input.enabled, false);
assert.equal(f.gate.afterPose(), false);
f.lock();
flush();
assert.equal(f.engine.gameplaySuspended, true, 'lock changes alone still cannot start a reset run');
f.click(); // Already-held lock can activate after explicit intent, without another lock event.
flush();
assert.equal(f.engine.gameplaySuspended, false);
f.gate.afterPose();
// A lock lost between confirmation and the next frame cannot authorize a run.
f.gate.restart();
f.click();
pointerLockElement = null;
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

f = createStartFixture(false);
f.click();
f.lock();
flush();
f.gate.afterPose();
assert.equal(f.engine.viewScene.visible, false, 'do not override prior root visibility');
f.gate.restart();
f.gate.dispose();
flush();
assert.equal(f.engine.gameplaySuspended, true, 'disposed queued callback cannot activate');
f = createStartFixture();
f.click();
f.lock();
f.engine._running = false;
flush();
assert.equal(f.engine.gameplaySuspended, true, 'stopped/disposal loop cannot activate');
f.gate.dispose();
console.log(
  'smoke-start-gate: ok (intent, actual lock, retry, frame boundary, reset, pose, terminal, teardown)'
);
