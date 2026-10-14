import assert from 'node:assert/strict';
import {
  DEFAULT_BINDINGS,
  CONTROL_REFERENCE,
  bindingLabel,
  bindingLabels,
} from '../../src/core/bindings.ts';
import { ACTIONS, Input } from '../../src/core/input.ts';

// Node-only DOM stand-ins: exercise real handlers and frame snapshots, not a second input implementation.
const listeners = new Map();
globalThis.addEventListener = (name, handler) => listeners.set(name, handler);
globalThis.removeEventListener = (name) => listeners.delete(name);
globalThis.document = { pointerLockElement: null, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', {
  value: { getGamepads: () => [] },
  configurable: true,
});

const defaults = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  prone: ['KeyZ'],
  sprint: ['ShiftLeft'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyE'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  fireMode: ['KeyB'],
  inspect: ['KeyI'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  cycleWeapon: ['Tab'],
  use: ['KeyT'],
  flashlight: ['KeyF'],
  heal: ['KeyH'],
  grenade: ['KeyG'],
  radio: ['KeyX'],
  pause: ['Escape'],
};
assert.deepEqual(
  DEFAULT_BINDINGS,
  defaults,
  'approved complete defaults, including raw weapon/mouse inputs'
);
assert.ok(!('melee' in DEFAULT_BINDINGS) && !('swapWeapon' in DEFAULT_BINDINGS));
assert.deepEqual(
  ACTIONS.swapWeapon,
  ['Digit1', 'Digit2', 'Tab'],
  'legacy aggregate derived from canonical actions'
);
assert.equal(bindingLabel('use'), 'T');
assert.equal(bindingLabel('flashlight'), 'F');
assert.deepEqual(bindingLabels('crouch'), ['Left Ctrl', 'Right Ctrl', 'C']);
assert.equal(bindingLabel('sprint'), 'Left Shift');
assert.equal(bindingLabel('forward'), 'W / ↑');
assert.equal(bindingLabel('fire'), 'LMB');
assert.equal(bindingLabel('ads'), 'RMB');
assert.equal(bindingLabel('cycleWeapon'), 'Tab');
assert.match(
  CONTROL_REFERENCE.find((row) => row.action === 'cycleWeapon').behavior,
  /nonzero mouse-wheel frame/
);
assert.equal(bindingLabel('jump'), 'Space');
assert.equal(bindingLabel('pause'), 'Esc');

// Distinct actions must never share a physical binding. Contextual meanings reuse ONE action.
function conflicts(bindings) {
  const owners = new Map();
  const duplicates = [];
  for (const [action, codes] of Object.entries(bindings)) {
    for (const code of codes) {
      if (owners.has(code)) duplicates.push([code, owners.get(code), action]);
      owners.set(code, action);
    }
  }
  return duplicates;
}
assert.deepEqual(conflicts(DEFAULT_BINDINGS), []);
assert.deepEqual(
  conflicts({ ...DEFAULT_BINDINGS, use: ['KeyE'] }),
  [['KeyE', 'leanRight', 'use']],
  'detect unintended E-lean/interact conflict'
);
assert.deepEqual(
  new Set(CONTROL_REFERENCE.map((row) => row.action)),
  new Set(Object.keys(DEFAULT_BINDINGS))
);
for (const row of CONTROL_REFERENCE) {
  assert.ok(DEFAULT_BINDINGS[row.action] && row.label && row.context && row.behavior);
  assert.ok(
    bindingLabels(row.action).every((label) => typeof label === 'string' && label.length > 0)
  );
}
for (const action of ['slot1', 'slot2', 'slot3']) {
  assert.deepEqual(
    CONTROL_REFERENCE.filter((row) => row.action === action).map((row) => row.context),
    ['weapon', 'radio']
  );
}
assert.deepEqual(
  CONTROL_REFERENCE.filter((row) => row.action === 'ads').map((row) => row.context),
  ['weapon', 'grenade']
);
assert.match(
  CONTROL_REFERENCE.find((row) => row.action === 'slot3' && row.context === 'weapon').behavior,
  /No action/
);
assert.match(CONTROL_REFERENCE.find((row) => row.action === 'crouch').behavior, /Toggle on press/);
assert.match(
  CONTROL_REFERENCE.find((row) => row.action === 'use' && row.label === 'Secure intel').behavior,
  /requires release/
);
assert.ok(!CONTROL_REFERENCE.some((row) => /melee/i.test(row.label)));

function makeInput() {
  document.pointerLockElement = null;
  const canvas = {
    requests: 0,
    requestPointerLock() {
      this.requests++;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return new Input(canvas, { sensitivity: 0.002, invertY: false });
}
function key(code, options = {}) {
  return {
    code,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...options,
  };
}
function click(input, button = 0, target = input.canvas) {
  input._onMouseDown({ button, target });
}
function wheel(input, deltaY, target = input.canvas) {
  input._onWheel({ deltaY, target });
}

for (const [action, bindings] of Object.entries(DEFAULT_BINDINGS)) {
  for (const binding of bindings) {
    const input = makeInput();
    input._gameplayFocus = true;
    if (binding.startsWith('Mouse')) click(input, Number(binding.slice(5)));
    else input._onKeyDown(key(binding));
    input.beginFrame();
    assert.ok(
      input.action(action) && input.actionPressed(action),
      `${binding} dispatches ${action}`
    );
    if (binding.startsWith('Mouse')) input._onMouseUp({ button: Number(binding.slice(5)) });
    else input._onKeyUp(key(binding));
    input.beginFrame();
    assert.ok(
      !input.action(action) && input.actionReleased(action),
      `${binding} releases ${action}`
    );
  }
}

{
  const input = makeInput();
  input.attach();
  assert.ok(listeners.has('keydown') && listeners.has('wheel'));
  input.detach();
  assert.equal(listeners.size, 0);
}
// The target guard alone admits canvas clicks; only unlocked left clicks request a lock.
for (const pointerLocked of [false, true]) {
  for (const canvasTarget of [false, true]) {
    for (const button of [0, 1, 2]) {
      const input = makeInput();
      input.pointerLocked = pointerLocked;
      click(input, button, canvasTarget ? input.canvas : {});
      input.beginFrame();
      const context = `locked=${pointerLocked}, canvas=${canvasTarget}, button=${button}`;
      assert.equal(
        input.canvas.requests,
        Number(canvasTarget && !pointerLocked && button === 0),
        context
      );
      assert.deepEqual([...input.down], canvasTarget ? [`Mouse${button}`] : [], context);
      assert.equal(input._gameplayFocus, canvasTarget, context);
    }
  }
}
{
  const input = makeInput();
  click(input); // denied/in-flight lock still owns keyboard input
  assert.equal(input.canvas.requests, 1);
  for (const code of Object.values(defaults)
    .flat()
    .filter((code) => !code.startsWith('Mouse'))) {
    for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const down = key(code, modifiers),
        up = key(code, modifiers);
      input._preventBrowserShortcut(down);
      input._preventBrowserShortcut(up);
      assert.ok(down.prevented && up.prevented, `active game suppresses ${code} down/up`);
    }
  }
  for (const code of ['KeyV', 'ShiftRight', 'KeyN', 'F7', 'F8', 'Enter', 'Home', 'End']) {
    const event = key(code, { ctrlKey: true });
    input._preventBrowserShortcut(event);
    assert.ok(!event.prevented, `unbound shortcut ${code} is native`);
  }
  const event = key('KeyW', { ctrlKey: true });
  input._onKeyDown(event);
  assert.ok(event.prevented);
  const release = key('KeyW', { ctrlKey: true });
  input._onKeyUp(release);
  assert.ok(release.prevented);
}
{
  const input = makeInput();
  for (const code of [
    'Tab',
    'Space',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'Enter',
    'KeyW',
  ]) {
    const event = key(code);
    input._onKeyDown(event);
    input._onKeyUp(event);
    assert.ok(!event.prevented, `native menu key ${code} not suppressed or queued`);
  }
  input.beginFrame();
  assert.equal(input.down.size, 0);
  assert.equal(input._pressed.size, 0);
  click(input, 0, {});
  wheel(input, 1, {});
  input.beginFrame();
  assert.equal(input.canvas.requests, 0);
  assert.ok(!input.fire && !input.actionPressed('cycleWeapon'));
  const escape = key('Escape');
  input._onKeyDown(escape);
  input.beginFrame();
  assert.ok(
    input.actionPressed('pause') && !escape.prevented,
    'Escape remains a contextual UI action'
  );
}
{
  const input = makeInput();
  input._gameplayFocus = true;
  input._onKeyDown(key('KeyF'));
  assert.ok(!input.action('flashlight'), 'pending events do not mutate snapshot');
  input.beginFrame();
  assert.ok(
    input.action('flashlight') && input.actionPressed('flashlight') && !input.action('use')
  );
  for (let step = 0; step < 4; step++)
    assert.ok(input.actionPressed('flashlight'), 'multiple fixed reads are stable');
  input._onKeyDown(key('KeyF', { repeat: true }));
  input._onKeyDown(key('KeyT'));
  assert.ok(!input.action('use'), 'new events wait for next frame');
  input.endFrame();
  input.beginFrame();
  assert.ok(!input.actionPressed('flashlight') && input.action('flashlight'));
  assert.ok(input.action('use') && input.actionPressed('use'));
  input._onKeyUp(key('KeyF'));
  input._onKeyUp(key('KeyT'));
  input.beginFrame();
  assert.ok(!input.action('flashlight') && !input.action('use'));
  assert.ok(input.actionReleased('flashlight') && input.actionReleased('use'));
  input.beginFrame();
  assert.ok(
    !input.actionReleased('flashlight'),
    'edges expire next frame even without fixed updates'
  );
  input._onKeyDown(key('KeyT'));
  input.beginFrame();
  assert.ok(
    input.action('use') && !input.action('flashlight') && !input.actionPressed('flashlight'),
    'T alone only interacts'
  );
}
{
  const input = makeInput();
  input._gameplayFocus = true;
  input._onKeyDown(key('ControlLeft'));
  input.beginFrame();
  assert.ok(input.action('crouch') && input.actionPressed('crouch'));
  input._onKeyDown(key('KeyC'));
  input.beginFrame();
  assert.ok(
    input.action('crouch') && input.actionPressed('crouch'),
    'alias query preserves per-key pressed semantics'
  );
  input._onKeyUp(key('ControlLeft'));
  input.beginFrame();
  assert.ok(
    input.action('crouch') && input.actionReleased('crouch'),
    'alias release does not end union-held action'
  );
  input._onKeyUp(key('KeyC'));
  input.beginFrame();
  assert.ok(!input.action('crouch') && input.actionReleased('crouch'));
  input._onKeyDown(key('KeyZ'));
  input._onKeyUp(key('KeyZ'));
  input.beginFrame();
  assert.ok(
    !input.action('prone') && input.actionPressed('prone') && input.actionReleased('prone'),
    'same-frame tap retains both edges'
  );
}
{
  const input = makeInput();
  click(input);
  input.beginFrame();
  assert.ok(input.fire && input.firePressed && input.actionPressed('fire'));
  click(input, 2);
  input.beginFrame();
  assert.ok(input.ads && input.actionPressed('ads') && !input.firePressed);
  input._onMouseUp({ button: 2 });
  input.beginFrame();
  assert.ok(
    !input.ads && input.actionReleased('ads') && input.released('Mouse2'),
    'grenade initiating button release'
  );
  input._onMouseUp({ button: 0 });
  input.beginFrame();
  assert.ok(!input.fire && input.actionReleased('fire'));
  wheel(input, -20);
  input.beginFrame();
  assert.equal(input.wheel, -1);
  assert.ok(
    !input.action('cycleWeapon') &&
      !input.actionPressed('cycleWeapon') &&
      !input.actionReleased('cycleWeapon'),
    'wheel is separate from Tab action'
  );
  input.beginFrame();
  assert.equal(input.wheel, 0);
  wheel(input, 20);
  wheel(input, 20);
  input._onKeyDown(key('Tab'));
  input.beginFrame();
  assert.equal(input.wheel, 2);
  assert.ok(input.actionPressed('cycleWeapon'));
  let requests = 0;
  if (input.actionPressed('cycleWeapon')) requests++;
  if (input.wheel) requests++;
  assert.equal(
    requests,
    2,
    'simultaneous Tab and wheel retain independent requests (not guaranteed successful switches)'
  );
  input._onKeyUp(key('Tab'));
  input.beginFrame();
  assert.ok(input.actionReleased('cycleWeapon') && input.wheel === 0);
  input._onKeyDown(key('Digit1'));
  input._onKeyDown(key('Digit3'));
  input.beginFrame();
  assert.ok(
    input.actionPressed('slot1') &&
      input.actionPressed('slot3') &&
      input.actionPressed('swapWeapon')
  );
}
{
  const input = makeInput();
  click(input);
  input._onKeyDown(key('KeyW'));
  input.beginFrame();
  input._onKeyDown(key('KeyT'));
  wheel(input, 1);
  input._rawLook.x = 40;
  input._onBlur();
  assert.ok(input.fire && input.action('forward'), 'blur does not mutate current snapshot');
  input.beginFrame();
  assert.equal(input.down.size, 0);
  assert.ok(input.actionReleased('fire') && input.actionReleased('forward'));
  assert.ok(!input.actionPressed('use') && !input.action('cycleWeapon'));
  assert.equal(input.look.x, 0);
  wheel(input, 1, {});
  input.requestPointerLock(); // UI resume/skip request, before browser lockchange
  input.beginFrame();
  assert.ok(!input.fire && input.wheel === 0, 'resume does not inherit UI click or wheel');
  document.pointerLockElement = input.canvas;
  input._onLockChange();
  assert.ok(input.pointerLocked);
  input._onMouseMove({ movementX: 3, movementY: 4 });
  input.beginFrame();
  assert.deepEqual(input.look, { x: 0.006, y: 0.008 });
  input.config.invertY = true;
  input._onMouseMove({ movementX: 1, movementY: 2 });
  input.beginFrame();
  assert.equal(input.look.y, -0.004);
  input._onKeyDown(key('KeyS'));
  wheel(input, 1);
  document.pointerLockElement = null;
  input._onLockChange();
  input.beginFrame();
  assert.ok(!input.action('back') && input.wheel === 0, 'lock loss drops pending presses/wheel');
}
{
  const input = makeInput();
  click(input);
  input.beginFrame();
  wheel(input, 1);
  click(input, 0, {}); // fallback focus -> native DOM menu, even if lock was denied
  input.beginFrame();
  assert.ok(!input.fire && input.wheel === 0 && !input._gameplayFocus);
  const arrow = key('ArrowRight');
  input._onKeyDown(arrow);
  assert.ok(!arrow.prevented);
  input._gameplayFocus = true;
  wheel(input, 1);
  input._onKeyDown(key('Escape'));
  input._onLockChange(); // browser can report unlock before the pending Escape snapshot
  input.beginFrame();
  assert.ok(
    input.actionPressed('pause') && !input.action('cycleWeapon') && !input.action('right'),
    'Escape survives lock loss while clearing pending gameplay transitions'
  );
  document.pointerLockElement = input.canvas;
  input.pointerLocked = false;
  const event = key('KeyA', { ctrlKey: true });
  input._onKeyDown(event);
  assert.ok(event.prevented, 'DOM lock state handles cached flag lag');
  input.pointerLocked = true;
  click(input, 0, {});
  wheel(input, 1, {});
  input.beginFrame();
  assert.ok(
    !input.fire && input.wheel === 0,
    'DOM UI never fires or queues wheel even during lock transition'
  );
}
{
  const input = makeInput();
  input._gameplayFocus = true;
  for (const mode of ['enabled', 'frozen']) {
    input.enabled = mode !== 'enabled';
    input.frozen = mode === 'frozen';
    const down = key('KeyW', { ctrlKey: true });
    input._onKeyDown(down);
    const up = key('KeyW', { ctrlKey: true });
    input._onKeyUp(up);
    assert.equal(
      down.prevented && up.prevented,
      mode === 'frozen',
      'frozen active input keeps shortcut safety; disabled handlers stay inert'
    );
    click(input);
    wheel(input, 1);
    input._onMouseMove({ movementX: 9, movementY: 9 });
    input.beginFrame();
    assert.equal(input.down.size, 0);
    assert.equal(input.wheel, 0);
    assert.deepEqual(input.look, { x: 0, y: 0 });
  }
  input._pendingDown.add('Mouse0'); // existing capture fixtures inject snapshots even with real DOM input disabled
  input.beginFrame();
  assert.ok(input.fire && input.firePressed);
  input._onBlur();
  input.beginFrame();
  assert.ok(
    !input.fire && input.actionReleased('fire'),
    'blur releases snapshot keys even while disabled/frozen'
  );
}
{
  const input = makeInput();
  input.down.add('KeyW');
  input.down.add('KeyD');
  const out = {};
  assert.equal(input.moveVector(out), out);
  assert.ok(Math.abs(Math.hypot(out.x, out.y) - 1) < 1e-12);
}
console.log(
  'ALL PASS: canonical controls, contextual metadata, snapshot edges, native menus and input transitions'
);
