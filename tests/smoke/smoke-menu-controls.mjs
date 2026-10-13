import assert from 'node:assert/strict';
import { ACTIONS } from '../../src/core/input.ts';
import { CONTROL_SECTIONS, controlKeyLabel } from '../../src/ui/controls.ts';
import { PauseMenu } from '../../src/ui/menu.ts';

function makeEl(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), children: [], attributes: {}, textContent: '', value: '0',
    style: { setProperty() {} }, classList: { toggle() {} },
    appendChild(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener() {}, focus() { this.focused = true; }, remove() { this.removed = true; },
  };
}
globalThis.document = { createElement: makeEl, exitPointerLock() {} };

const controls = CONTROL_SECTIONS.flatMap((section) => section.controls);
const codes = new Set(controls.flatMap((control) => control.keys));
for (const [action, bindings] of Object.entries(ACTIONS)) {
  for (const code of bindings) assert.ok(codes.has(code), `${action}: missing ${code}`);
}
for (const code of ['MouseMove', 'Mouse0', 'Mouse2', 'Wheel', 'KeyB', 'KeyI', 'Digit3', 'Enter', 'ShiftTab']) {
  assert.ok(codes.has(code), `missing direct/menu binding ${code}`);
}
assert.equal(controlKeyLabel('KeyB'), 'B');
assert.equal(controlKeyLabel('Digit3'), '3');
assert.equal(controlKeyLabel('ControlRight'), 'Right Ctrl');
assert.equal(controlKeyLabel('UnmappedCode'), 'UnmappedCode');
const description = (code, sectionTitle) => CONTROL_SECTIONS.find((section) => section.title === sectionTitle)
  .controls.find((control) => control.keys.includes(code)).description;
assert.match(description('KeyC', 'Movement & look'), /Toggle crouch.*sprinting.*slide/);
assert.match(description('KeyZ', 'Movement & look'), /Toggle prone \/ crouch/);
assert.match(description('ShiftLeft', 'Movement & look'), /Hold.*double-tap then hold/);
assert.match(description('Mouse2', 'Weapons'), /Hold to aim/);
assert.match(description('KeyG', 'Equipment & interaction'), /Equip \/ stow.*does not throw/);
assert.match(description('Mouse0', 'Equipment & interaction'), /hold to cook.*release to throw.*detonates/);
assert.match(description('Digit3', 'Equipment & interaction'), /radio equipped.*2 \/ 3 are locked.*not weapon selection/);
assert.match(description('KeyV', 'Weapons'), /not implemented/);
assert.match(description('Escape', 'Menus'), /shop.*skip/);

const events = [], controlChanges = [];
let locks = 0;
const ctx = {
  config: { quality: 'high', sensitivity: 0.0022, fov: 80, firingShake: 1, invertY: false },
  events: { emit(name, payload) { events.push([name, payload]); } },
  camera: { fov: 80, updateProjectionMatrix() {} }, time: { scale: 0.5 },
  input: { requestPointerLock() { locks++; } },
  peek: () => ({ setControlEnabled(value) { controlChanges.push(value); } }),
};
const menu = new PauseMenu(makeEl(), ctx);
const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const nodes = flatten(menu.root);
const reference = nodes.find((node) => node.attributes['aria-label'] === 'Gameplay controls');
assert.equal(reference.tabIndex, 0, 'reference is keyboard scrollable');
assert.equal(nodes.filter((node) => node.tagName === 'DD').length, controls.length);
for (const control of controls) {
  assert.ok(nodes.some((node) => node.textContent === control.description), 'description rendered');
  assert.ok(nodes.some((node) => node.textContent === control.keys.map(controlKeyLabel).join(' / ')), 'keys rendered');
}
for (const label of ['Mouse Sensitivity', 'Field Of View', 'Firing Camera Shake']) {
  assert.ok(nodes.some((node) => node.tagName === 'INPUT' && node.attributes['aria-label'] === label));
}
menu.show();
assert.equal(ctx.time.scale, 0);
assert.equal(menu.resumeBtn.focused, true);
menu.show(); // idempotent: do not overwrite the pre-pause scale
menu.close();
assert.equal(ctx.time.scale, 0.5);
assert.equal(locks, 1);
assert.deepEqual(controlChanges, [false, true]);
assert.deepEqual(events.filter(([name]) => name === 'ui:pause'), [
  ['ui:pause', { paused: true }], ['ui:pause', { paused: false }],
]);
menu.dispose();
assert.equal(menu.root.removed, true);
console.log('smoke-menu-controls: ok');
