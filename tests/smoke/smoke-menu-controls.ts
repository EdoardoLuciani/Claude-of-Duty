import assert from 'node:assert/strict';

import {
  DEFAULT_BINDINGS,
  CONTROL_REFERENCE,
  bindingLabels,
  bindingLabel,
} from '../../src/core/bindings.ts';
import type { ActionId } from '../../src/core/bindings.ts';
import { CONTROL_SECTIONS } from '../../src/ui/controls.ts';
import { PauseMenu } from '../../src/ui/menu.ts';
import { Prompt } from '../../src/ui/prompts.ts';
import { RadioPanel } from '../../src/ui/radio.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { createTestContext, createTestInput } from '../lib/context.ts';
import type { TestProviders } from '../lib/context.ts';
import { installUiDocument, UiPlayer } from '../lib/ui-fixture.ts';

installUiDocument();
const makeEl = (): HTMLDivElement => document.createElement('div');
function isActionId(value: string): value is ActionId {
  return Object.hasOwn(DEFAULT_BINDINGS, value);
}
const controls = CONTROL_SECTIONS.flatMap(
  (section): (typeof CONTROL_SECTIONS)[number]['controls'] => section.controls
);
const movementActions: ActionId[] = ['forward', 'left', 'back', 'right'];
assert.deepEqual(
  controls[0].keys,
  [0, 1].map((alias): string =>
    movementActions.map((action): string => bindingLabels(action)[alias]).join(' ')
  ),
  'movement groups retain every canonical alias'
);
const labels = new Set(controls.flatMap((control): readonly string[] => control.keys));
for (const action of Object.keys(DEFAULT_BINDINGS)) {
  if (!isActionId(action) || movementActions.includes(action)) continue;
  for (const label of bindingLabels(action))
    assert.ok(labels.has(label), `${action}: missing ${label}`);
}
assert.ok(
  !labels.has('V') && !controls.some((control): boolean => /melee/i.test(control.description)),
  'inactive melee removed'
);
assert.ok(labels.has('Mouse') && labels.has('Mouse wheel'), 'mouse reference retained');
// Gameplay eligibility belongs to smoke-intel; this suite
// owns canonical labels, DOM accessibility, pause/focus and contextual prompts.
const events: ['ui:pause', { paused: boolean }][] = [];
const controlChanges: boolean[] = [];
let locks = 0;
const providers: TestProviders = {};
const input = createTestInput();
input.requestPointerLock = (): void => {
  locks++;
};
const ctx = createTestContext({ input, providers });
ctx.time.scale = 0.5;
const player = new UiPlayer(ctx);
player.setControlEnabled = (value: boolean): void => {
  controlChanges.push(value);
};
providers.player = player;
ctx.events.on('ui:pause', (payload): void => {
  events.push(['ui:pause', payload]);
});
const menu = new PauseMenu(makeEl(), ctx);
const flatten = (node: Element): Element[] => [node, ...Array.from(node.children).flatMap(flatten)];
const nodes = flatten(menu.root);
const reference = nodes.find(
  (node): boolean => node.getAttribute('aria-label') === 'Gameplay controls'
);
assert(reference);
assert('tabIndex' in reference);
assert.equal(reference.tabIndex, 0, 'reference is keyboard scrollable');
assert.equal(nodes.filter((node): boolean => node.tagName === 'DD').length, controls.length);
assert.equal(controls.length, 23, 'only the concise grouped reference is rendered');
assert.ok(
  !nodes.some((node): boolean => ['DETAILS', 'SUMMARY'].includes(node.tagName)),
  'no disclosure UI'
);
assert.ok(
  !nodes.some((node): boolean =>
    /expand|detailed|recovery help|gamepad sticks/i.test(node.textContent ?? '')
  ),
  'no detailed-help presentation'
);
for (const row of CONTROL_REFERENCE) {
  assert.ok(
    !nodes.some((node): boolean => node.textContent === `${row.label} — ${row.behavior}`),
    'full behavior paragraphs are not relocated'
  );
}
for (const control of controls) {
  assert.ok(control.description.length < 80, 'descriptions stay concise');
  assert.ok(
    nodes.some((node): boolean => node.textContent === control.description),
    'description rendered'
  );
  assert.ok(
    nodes.some((node): boolean => node.textContent === control.keys.join(' / ')),
    'canonical keys rendered'
  );
}
const text = controls.map((control): string => control.description).join(' ');
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
    nodes.some(
      (node): boolean => node.tagName === 'INPUT' && node.getAttribute('aria-label') === label
    )
  );
}
menu.show();
assert.equal(ctx.time.scale, 0);
assert('focused' in menu.resumeBtn);
assert.equal(menu.resumeBtn.focused, true);
menu.show(); // idempotent: do not overwrite the pre-pause scale
menu.close();
assert.equal(ctx.time.scale, 0.5);
assert.equal(locks, 1);
assert.deepEqual(controlChanges, [false, true]);
assert.deepEqual(
  events.filter(([name]): boolean => name === 'ui:pause'),
  [
    ['ui:pause', { paused: true }],
    ['ui:pause', { paused: false }],
  ]
);
menu.dispose();
assert('removed' in menu.root);
assert.equal(menu.root.removed, true);
const prompt = new Prompt();
assert.equal(prompt.key, bindingLabel('use'), 'initial prompt key derives from interact');
prompt.set({ text: 'ammo', progress: 0.4 });
assert.equal(prompt.key, bindingLabel('use'), 'fallback prompt key derives from interact');
assert.equal(prompt.progress, 0.4);
assert(prompt.hasProgress);
prompt.set({ key: bindingLabel('heal'), text: 'bandaging' });
assert.equal(prompt.key, bindingLabel('heal'), 'contextual prompt override preserved');
assert.equal(prompt.hasProgress, false);
const weapons = new WeaponSystem();
weapons.radioEquipped = true;
weapons.carpetBombs = 2;
providers.weapons = weapons;
const radio = new RadioPanel(makeEl(), ctx);
const radioNodes = flatten(radio.root);
assert.ok(
  radioNodes.some((node): boolean => node.textContent === `${bindingLabel('radio')} STOWS`)
);
for (const action of ['slot1', 'slot2', 'slot3'] as const) {
  assert.ok(radioNodes.some((node): boolean => node.textContent === bindingLabel(action)));
}
radio.update(1);
assert.equal(radio.rows[0].charge.textContent, 'x2');
radio.dispose();
console.log(
  'smoke-menu-controls: ok (concise reference, canonical labels, native rows, contextual prompts and radio labels)'
);
