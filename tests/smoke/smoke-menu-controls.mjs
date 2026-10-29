import assert from 'node:assert/strict';

import {
  DEFAULT_BINDINGS,
  CONTROL_REFERENCE,
  bindingLabels,
  bindingLabel,
} from '../../src/core/bindings.ts';
import { CONTROL_SECTIONS } from '../../src/ui/controls.ts';
import { PauseMenu } from '../../src/ui/menu.ts';
import { Prompt } from '../../src/ui/prompts.ts';
import { RadioPanel } from '../../src/ui/radio.ts';

function makeEl(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    attributes: {},
    textContent: '',
    value: '0',
    style: { setProperty() {} },
    classList: { toggle() {} },
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    addEventListener() {},
    focus() {
      this.focused = true;
    },
    remove() {
      this.removed = true;
    },
  };
}
const controls = CONTROL_SECTIONS.flatMap((section) => section.controls);
const movementActions = ['forward', 'left', 'back', 'right'];
assert.deepEqual(
  controls[0].keys,
  [0, 1].map((alias) => movementActions.map((action) => bindingLabels(action)[alias]).join(' ')),
  'movement groups retain every canonical alias'
);
const labels = new Set(controls.flatMap((control) => control.keys));
for (const action of Object.keys(DEFAULT_BINDINGS).filter(
  (action) => !movementActions.includes(action)
)) {
  for (const label of bindingLabels(action))
    assert.ok(labels.has(label), `${action}: missing ${label}`);
}
assert.ok(
  !labels.has('V') && !controls.some((control) => /melee/i.test(control.description)),
  'inactive melee removed'
);
assert.ok(labels.has('Mouse') && labels.has('Mouse wheel'), 'mouse reference retained');
// Gameplay eligibility belongs to smoke-intel; this suite
// owns canonical labels, DOM accessibility, pause/focus and contextual prompts.
globalThis.document = { createElement: makeEl, exitPointerLock() {} };
const events = [],
  controlChanges = [];
let locks = 0;
const ctx = {
  config: { quality: 'high', sensitivity: 0.0022, fov: 80, firingShake: 1, invertY: false },
  events: {
    emit(name, payload) {
      events.push([name, payload]);
    },
  },
  camera: { fov: 80, updateProjectionMatrix() {} },
  time: { scale: 0.5 },
  input: {
    requestPointerLock() {
      locks++;
    },
  },
  peek: () => ({
    setControlEnabled(value) {
      controlChanges.push(value);
    },
  }),
};
const menu = new PauseMenu(makeEl(), ctx);
const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const nodes = flatten(menu.root);
const reference = nodes.find((node) => node.attributes['aria-label'] === 'Gameplay controls');
assert.equal(reference.tabIndex, 0, 'reference is keyboard scrollable');
assert.equal(nodes.filter((node) => node.tagName === 'DD').length, controls.length);
assert.equal(controls.length, 23, 'only the concise grouped reference is rendered');
assert.ok(!nodes.some((node) => ['DETAILS', 'SUMMARY'].includes(node.tagName)), 'no disclosure UI');
assert.ok(
  !nodes.some((node) => /expand|detailed|recovery help|gamepad sticks/i.test(node.textContent)),
  'no detailed-help presentation'
);
for (const row of CONTROL_REFERENCE) {
  assert.ok(
    !nodes.some((node) => node.textContent === `${row.label} — ${row.behavior}`),
    'full behavior paragraphs are not relocated'
  );
}
for (const control of controls) {
  assert.ok(control.description.length < 80, 'descriptions stay concise');
  assert.ok(
    nodes.some((node) => node.textContent === control.description),
    'description rendered'
  );
  assert.ok(
    nodes.some((node) => node.textContent === control.keys.join(' / ')),
    'canonical keys rendered'
  );
}
const text = controls.map((control) => control.description).join(' ');
for (const distinction of [
  'Jump (press) · mantle / vault (hold + move forward)',
  'Crouch / slide (toggle)',
  'Prone (toggle)',
  'Sprint (hold) · tactical sprint (double-tap + hold)',
  'Lean left / right (hold)',
  'Fire: auto (hold) · semi (press) · burst (press starts burst); weapon out',
  'Aim down sights (hold; weapon out)',
  'Interact (hold): ammo 0.45s / aimed intel 4s',
  'Flashlight (toggle)',
  'Bandage (hold 3s)',
  'Equip / stow grenade (toggle)',
  'Grenade out: cook long / short (hold); release to throw',
  'Equip / stow radio (toggle)',
  'Radio out: carpet-bomb request (immediate)',
  'Radio out: locked requests',
  'Request weapon cycle',
  'in shop: close shop',
])
  assert.ok(text.includes(distinction), `essential distinction: ${distinction}`);
for (const label of ['Mouse Sensitivity', 'Field Of View', 'Firing Camera Shake']) {
  assert.ok(
    nodes.some((node) => node.tagName === 'INPUT' && node.attributes['aria-label'] === label)
  );
}
menu.show();
assert.equal(ctx.time.scale, 0);
assert.equal(menu.resumeBtn.focused, true);
menu.show(); // idempotent: do not overwrite the pre-pause scale
menu.close();
assert.equal(ctx.time.scale, 0.5);
assert.equal(locks, 1);
assert.deepEqual(controlChanges, [false, true]);
assert.deepEqual(
  events.filter(([name]) => name === 'ui:pause'),
  [
    ['ui:pause', { paused: true }],
    ['ui:pause', { paused: false }],
  ]
);
menu.dispose();
assert.equal(menu.root.removed, true);
const prompt = new Prompt(makeEl());
assert.equal(
  prompt.key.textContent,
  bindingLabel('use'),
  'initial prompt key derives from interact'
);
prompt.set({ text: 'ammo', progress: 0.4 });
assert.equal(
  prompt.key.textContent,
  bindingLabel('use'),
  'fallback prompt key derives from interact'
);
prompt.set({ key: bindingLabel('heal'), text: 'bandaging' });
assert.equal(prompt.key.textContent, bindingLabel('heal'), 'contextual prompt override preserved');
prompt.dispose();
const radio = new RadioPanel(makeEl(), { peek: () => ({ radioEquipped: true, carpetBombs: 2 }) });
const radioNodes = flatten(radio.root);
assert.ok(radioNodes.some((node) => node.textContent === `${bindingLabel('radio')} STOWS`));
for (const action of ['slot1', 'slot2', 'slot3']) {
  assert.ok(radioNodes.some((node) => node.textContent === bindingLabel(action)));
}
radio.update(1);
assert.equal(radio.rows[0].charge.textContent, 'x2');
radio.dispose();
console.log(
  'smoke-menu-controls: ok (concise reference, canonical labels, native rows, contextual prompts and radio labels)'
);
