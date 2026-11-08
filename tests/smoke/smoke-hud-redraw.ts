import assert from 'node:assert/strict';

import { Text } from 'pixi.js';

import { AmmoPanel } from '../../src/ui/ammo.ts';
import { Compass, ScoreBar } from '../../src/ui/compass.ts';
import { Crosshair } from '../../src/ui/crosshair.ts';
import { DamageArcs } from '../../src/ui/damage.ts';
import { HealthFx } from '../../src/ui/health.ts';
import { Hitmarkers } from '../../src/ui/hitmarkers.ts';
import { Killfeed } from '../../src/ui/killfeed.ts';
import { MarketCountdown } from '../../src/ui/market.ts';
import { PixiHud } from '../../src/ui/pixi-hud.ts';
import { Banner, Prompt } from '../../src/ui/prompts.ts';

const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const dprDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
let hud;
try {
  globalThis.document = {
    createElement: () => ({ style: { setProperty() {} }, setAttribute() {}, remove() {} }),
  };
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true });
  hud = new PixiHud();
  // Real retained presenters, with only GPU rendering/glyph measurement stubbed.
  Object.defineProperty(hud.renderer, 'resolution', { value: 1 });
  hud.renderer.render = () => {};
  const measure = (node) => {
    if (node instanceof Text)
      Object.defineProperty(node, 'width', { get: () => node.text.length * 8 * node.scale.x });
    for (const child of node.children) measure(child);
  };
  measure(hud.stage);
  for (const slot of hud.combat.slots) Object.defineProperty(slot.node, 'width', { get: () => 40 });
  hud.setVisible(true);
  const health = new HealthFx(),
    crosshair = new Crosshair();
  const state = {
    health: 100,
    maxHealth: 100,
    armour: 0,
    ammo: 30,
    reserve: 210,
    magSize: 30,
    time: 0,
  };
  const map = { baked: null, viewSpan: 60 };
  const mapState = { x: 0, z: 0, heading: 0, fov: 80 };
  const models = {
    hit: new Hitmarkers(),
    arcs: new DamageArcs(),
    compass: new Compass(),
    ammo: new AmmoPanel(),
    fpsText: '60 FPS',
    prompt: new Prompt(),
    banner: new Banner(),
    scoreBar: new ScoreBar(),
    killfeed: new Killfeed(),
    marketCountdown: new MarketCountdown(10),
  };
  const frame = (dt = 1 / 60, opacity = 1) => {
    state.time += dt;
    hud.update(dt, state, health, crosshair, map, mapState, opacity, models);
  };
  frame();
  const initial = hud.draws;
  let healthTextWrites = 0,
    healthTextReads = 0;
  for (const node of [hud.hp, hud.maxHp]) {
    const value = node.text;
    Object.defineProperty(node, 'text', {
      get: () => {
        healthTextReads++;
        return value;
      },
      set: () => {
        healthTextWrites++;
      },
      configurable: true,
    });
  }
  for (let i = 0; i < 120; i++) frame();
  state.health = 99.9;
  frame(); // unchanged rounded numeral; the controller's bar has not moved yet
  state.health = 100;
  frame();
  assert.equal(hud.draws, initial, 'active time alone does not redraw a settled HUD');
  assert.equal(healthTextWrites, 0, 'unchanged health numerals are not rewritten');
  assert.equal(healthTextReads, 0, 'unchanged integers skip formatting/text comparison entirely');
  for (const node of [hud.hp, hud.maxHp]) delete node.text;
  const changes = [
    () => {
      health.hpShown = 0.9;
    }, // bar easing with unchanged health snapshot
    () => {
      state.health = 27;
    }, // text + tint
    () => {
      state.maxHealth = 120;
    },
    () => {
      health.armourShown = 1;
      state.armour = 50;
    },
    () => {
      state.armour = 40;
    },
    () => {
      health.armourFlash = 1;
    },
    () => {
      health.armourShown = 0;
    },
    () => {
      crosshair.gap += 2;
    },
    () => {
      crosshair.bladeLength = 1.4;
    },
    () => {
      crosshair.bladeAlpha = 0.5;
    },
    () => {
      crosshair.dotScale = 1.2;
    },
    () => {
      crosshair.dotAlpha = 0.5;
    },
    () => {
      crosshair.visible = 0;
    },
    () => {
      crosshair.visible = 1;
    },
    () => {
      health.flashAlpha = 0.5;
    },
    () => {
      health.flashAlpha = 0;
    },
    () => {
      state.ammo--;
    },
    () => {
      state.reloading = true;
      state.reloadProgress = 0.4;
    },
    () => {
      state.reloadProgress = 0.6;
    },
    () => {
      state.reloading = false;
    },
    () => {
      mapState.heading = 20;
    },
    () => {
      models.fpsText = '61 FPS';
    },
    () => {
      models.prompt.set({ text: 'test', progress: 0.4 });
      models.prompt.update(0.2);
    },
    () => {
      models.prompt.set({ text: 'test', progress: 0.8 });
    },
    () => {
      models.hit.spawn('head');
      models.hit.update(0.05);
    },
    () => {
      models.hit.update(1);
    },
    () => {
      models.arcs.spawn(1, 0);
      models.arcs.update(0.09, 1, 0, 0, -1);
    },
    () => {
      models.arcs.update(2, 1, 0, 0, -1);
    },
  ];
  for (const change of changes) {
    const before = hud.draws;
    change();
    frame();
    assert.equal(hud.draws, before + 1, change.toString());
    frame();
    assert.equal(hud.draws, before + 1, 'unchanged presentation settles again');
  }
  state.ammo = 0;
  frame();
  const empty = hud.draws;
  frame(0.1);
  assert.equal(hud.draws, empty + 1, 'empty-ammo prompt still pulses');
  frame(0);
  assert.equal(hud.draws, empty + 1, 'paused prompt is static');
  state.ammo = 30;
  frame();
  const beforeFade = hud.draws;
  frame(1 / 60, 0.5);
  assert.equal(hud.draws, beforeFade + 1);
  frame(1 / 60, 0.5);
  assert.equal(hud.draws, beforeFade + 1);
  frame(1 / 60, 0);
  const hidden = hud.draws;
  frame(1 / 60, 0);
  assert.equal(hud.draws, hidden);
  frame();
  assert.equal(hud.draws, hidden + 1, 'reveal invalidates retained content');
  // Damped animations settle at rendered precision instead of drawing forever.
  state.health = state.maxHealth = 100;
  for (let i = 0; i < 600; i++) {
    health.update(1 / 60, state);
    crosshair.update(1 / 60, {});
    frame();
  }
  const settled = hud.draws;
  for (let i = 0; i < 60; i++) {
    health.update(1 / 60, state);
    crosshair.update(1 / 60, {});
    frame();
  }
  assert.equal(hud.draws, settled);
} finally {
  // No GPU was initialized in this fixture.
  hud?.injury.dispose();
  hud?.stage.destroy({ children: true });
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
  else delete globalThis.document;
  if (dprDescriptor) Object.defineProperty(globalThis, 'devicePixelRatio', dprDescriptor);
  else delete globalThis.devicePixelRatio;
}
console.log(
  'ok HUD redraw: active/paused idle suppression, health, armour, reticle, injury, reload, feedback and reveal'
);
