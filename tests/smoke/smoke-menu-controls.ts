import assert from 'node:assert/strict';

import { DEFAULT_BINDINGS, bindingLabels, bindingLabel } from '../../src/core/bindings.ts';
import type { ActionId } from '../../src/core/bindings.ts';
import { CONTROL_SECTIONS } from '../../src/ui/controls.ts';
import { PauseMenu } from '../../src/ui/menu.ts';
import { Prompt } from '../../src/ui/prompts.ts';
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
const labels = new Set(controls.flatMap((control): readonly string[] => control.keys));
for (const action of Object.keys(DEFAULT_BINDINGS)) {
  if (!isActionId(action)) continue;
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
const lockRequests: string[] = [];
const providers: TestProviders = {};
const input = createTestInput();
input.requestPointerLock = (): void => {
  lockRequests.push('pointer');
};
input.requestFullscreen = (): void => {
  lockRequests.push('fullscreen');
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
assert.equal(menu.pages[2].tabIndex, 0, 'reference is keyboard scrollable');
assert.equal(nodes.filter((node): boolean => node.tagName === 'DD').length, controls.length);
assert.equal(controls.length, 24, 'only the concise grouped reference is rendered');
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
  'Mounted weapon laser (toggle; weapon out)',
  'Bandage (hold 3s)',
  'Equip grenade (weapon keys stow)',
  'Grenade out: cook long / short (hold); release to throw',
  'Equip radio (weapon keys stow)',
  'Radio out: select request',
  'Radio out: send selected request',
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
const visiblePages = (): boolean[] => menu.pages.map((page): boolean => !page.hidden);
assert.deepEqual(visiblePages(), [true, false, false], 'opens on Gameplay');
menu.selectTab('Controls');
assert.deepEqual(visiblePages(), [false, false, true], 'one page at a time');
assert.equal(menu.tabs[2].getAttribute('aria-selected'), 'true');
menu.show();
assert.equal(ctx.time.scale, 0);
assert.equal(menu.root.open, true, 'pause menu is a native modal');
assert.equal(menu.resumeBtn.autofocus, true, 'modal opens on Resume');
menu.show(); // idempotent: do not overwrite the pre-pause scale
menu.close();
assert.equal(menu.root.open, false);
assert.equal(ctx.time.scale, 0.5);
assert.deepEqual(lockRequests, ['pointer', 'fullscreen'], 'resume requests mouse capture first');
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
console.log(
  'smoke-menu-controls: ok (concise reference, canonical labels, native rows, contextual prompts)'
);
