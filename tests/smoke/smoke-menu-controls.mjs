import assert from 'node:assert/strict';

import {
  DEFAULT_BINDINGS,
  CONTROL_REFERENCE,
  bindingLabels,
  bindingLabel,
} from '../../src/core/bindings.ts';
import { CONTROL_SECTIONS } from '../../src/ui/controls.ts';
import { CombatDemo } from '../../src/ui/demo.ts';
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
const labels = new Set(controls.flatMap((control) => control.keys));
for (const action of Object.keys(DEFAULT_BINDINGS)) {
  for (const label of bindingLabels(action))
    assert.ok(labels.has(label), `${action}: missing ${label}`);
}
for (const row of CONTROL_REFERENCE) {
  const control = controls.find(
    (control) => control.description === `${row.label} — ${row.behavior}`
  );
  assert.ok(control, `canonical meaning rendered: ${row.label}`);
  assert.deepEqual(
    control.keys,
    row.action === 'cycleWeapon'
      ? [...bindingLabels(row.action), 'Mouse wheel']
      : bindingLabels(row.action)
  );
}
assert.ok(
  !labels.has('V') && !controls.some((control) => /melee/i.test(control.description)),
  'inactive melee removed'
);
for (const label of [
  'Mouse',
  'Mouse wheel',
  'Enter',
  'Shift + Tab',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]) {
  assert.ok(labels.has(label), `native/mouse reference: ${label}`);
}
const description = (label) =>
  controls.find((control) => control.description.startsWith(`${label} —`)).description;
assert.match(description('Pick up ammo'), /Hold 0.45 seconds in range.*Aimed intel has priority/);
assert.match(
  description('Secure intel'),
  /Hold 4 seconds while aimed, visible, stationary.*requires release/
);
assert.match(description('Cycle equipped weapons'), /independently request.*guards/);
assert.match(
  description('Jump / mantle / vault'),
  /stands up first.*ceiling fit.*Hold while moving forward.*Holding does not auto-repeat/
);
assert.ok(
  controls.some(
    (control) =>
      control.keys.includes('↑') && /native keys.*reference when focused/.test(control.description)
  )
);
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
for (const control of controls) {
  assert.ok(
    nodes.some((node) => node.textContent === control.description),
    'description rendered'
  );
  assert.ok(
    nodes.some((node) => node.textContent === control.keys.join(' / ')),
    'keys rendered'
  );
}
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
let demoPrompt;
const demo = new CombatDemo();
demo.start({
  state: {},
  health: {},
  killfeed: {
    clear() {},
    push() {
      return {};
    },
  },
  arcs: { clear() {} },
  hit: { clear() {} },
  markers: { clear() {} },
  setObjectives() {},
  setBlips() {},
  setPrompt(value) {
    demoPrompt = value;
  },
});
assert.equal(demoPrompt.key, bindingLabel('use'), 'capture demo cannot show stale F interaction');
console.log(
  'smoke-menu-controls: ok (canonical adapter, native rows, contextual prompts and radio/demo labels)'
);
