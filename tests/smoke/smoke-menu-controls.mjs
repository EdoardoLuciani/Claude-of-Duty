import assert from 'node:assert/strict';
import { ACTIONS } from '../../src/core/input.ts';
import { CONTROL_SECTIONS, controlKeyLabel } from '../../src/ui/controls.ts';
import { PauseMenu } from '../../src/ui/menu.ts';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { Rng } from '../../src/core/rng.ts';
import { EventBus } from '../../src/core/registry.ts';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.ts';
import { IntelSystem } from '../../src/intel/index.ts';
import { INTEL } from '../../src/intel/tuning.ts';

function makeEl(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), children: [], attributes: {}, textContent: '', value: '0',
    style: { setProperty() {} }, classList: { toggle() {} },
    appendChild(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener() {}, focus() { this.focused = true; }, remove() { this.removed = true; },
  };
}
const controls = CONTROL_SECTIONS.flatMap((section) => section.controls);
const codes = new Set(controls.flatMap((control) => control.keys));
for (const [action, bindings] of Object.entries(ACTIONS)) {
  for (const code of bindings) assert.ok(codes.has(code), `${action}: missing ${code}`);
}
for (const code of ['MouseMove', 'Mouse0', 'Mouse2', 'Wheel', 'KeyB', 'KeyI', 'Digit3', 'Enter', 'ShiftTab', 'PageUp', 'PageDown']) {
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
assert.match(description(ACTIONS.use[0], 'Equipment & interaction'), /Hold near ammo.*hold still while aiming at a visible intel case/);
assert.match(description(ACTIONS.heal[0], 'Equipment & interaction'), /walking allowed.*release, sprint, jump \/ fall, slide, mantle, use weapons, take health damage or pause to cancel/i);
for (const code of ['PageUp', 'PageDown']) {
  assert.match(description(code, 'Menus'), /Adjust focused settings sliders.*reference when focused.*mouse wheel/);
}
assert.ok(!CONTROL_SECTIONS.find(section => section.title === 'Menus').controls
  .some(control => control.keys.some(code => code.startsWith('Arrow'))), 'do not advertise suppressed slider arrows');

// Real interaction consumers: ammo only needs proximity; intel needs a still,
// camera-facing, unobstructed target. No input mapping or gameplay changes.
const player = {
  dead: false, controlEnabled: true, horizontalSpeed: 0,
  feetPosition: new Vector3(), eyePosition: new Vector3(0, 1.65, 0),
};
const interactionCtx = {
  config: { deterministic: true }, time: { elapsed: 1, scale: 1, frame: 1 },
  rng: new Rng(1), scene: new Scene(), camera: new PerspectiveCamera(), events: new EventBus(),
  input: { enabled: true, frozen: false, action: name => name === 'use' },
  player, market: { open: false }, physics: { lineOfSight: () => true },
  world: { intelMarkers: [], levelToWorld: (x, y, z) => new Vector3(x, y, z) },
  get(id) { return this[id]; }, peek(id) { return this[id]; },
};
const intel = new IntelSystem();
interactionCtx.intel = intel;
await intel.init(interactionCtx);
const cache = intel._spawn({ id: 'controls-reference', x: 0, y: 0, z: -1 });
interactionCtx.camera.position.copy(player.eyePosition);
interactionCtx.camera.lookAt(cache.x, cache.y + INTEL.targetHeight, cache.z);
interactionCtx.camera.updateMatrixWorld();
assert.equal(intel._target(), cache, 'visible aimed nearby intel is eligible');
intel.update(1, interactionCtx);
assert.equal(intel._hold, 1, 'holding still progresses intel');
player.horizontalSpeed = 1;
intel.update(0.1, interactionCtx);
assert.equal(intel._hold, 0, 'walking interrupts intel');
player.horizontalSpeed = 0;
interactionCtx.physics.lineOfSight = () => false;
assert.equal(intel._target(), null, 'hidden intel is ineligible');
interactionCtx.physics.lineOfSight = () => true;
interactionCtx.camera.rotateY(Math.PI);
assert.equal(intel._target(), null, 'looking away makes nearby intel ineligible');
const ammoOwner = {
  ctx: interactionCtx, rng: new Rng(2), player, current: 'rifle',
  state: { reserve: 0, def: { reserve: 90, magSize: 30 } },
  addReserve(n) { this.state.reserve += n; return n; },
};
const pickups = new AmmoPickups(ammoOwner);
pickups.spawn(new Vector3(0, 0, -1));
pickups.update(1);
assert.equal(ammoOwner.state.reserve, 45, 'holding near ammo collects it even while looking away');
pickups.dispose();
intel.dispose();

globalThis.document = { createElement: makeEl, exitPointerLock() {} };
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
