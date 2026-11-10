import assert from 'node:assert/strict';

import { Container, Text } from 'pixi.js';

import { Rng } from '../../src/core/rng.ts';
import { AmmoPanel } from '../../src/ui/ammo.ts';
import type { AmmoState } from '../../src/ui/ammo.ts';
import { Compass, ScoreBar } from '../../src/ui/compass.ts';
import { Crosshair } from '../../src/ui/crosshair.ts';
import { DamageArcs } from '../../src/ui/damage.ts';
import { HealthFx } from '../../src/ui/health.ts';
import type { HealthState } from '../../src/ui/health.ts';
import { Hitmarkers } from '../../src/ui/hitmarkers.ts';
import { Killfeed } from '../../src/ui/killfeed.ts';
import { MarketCountdown } from '../../src/ui/market.ts';
import { Minimap } from '../../src/ui/minimap.ts';
import type { PixiHud } from '../../src/ui/pixi-hud.ts';
import { Banner, Prompt } from '../../src/ui/prompts.ts';
import { createRetainedHud, installUiDocument, deleteGlobal } from '../lib/ui-fixture.ts';

const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const dprDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
let hud: PixiHud | undefined;
try {
  installUiDocument();
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true });
  const activeHud = createRetainedHud();
  hud = activeHud;
  // Real retained presenters, with only GPU rendering/glyph measurement stubbed.
  Object.defineProperty(hud.renderer, 'resolution', { value: 1 });
  hud.renderer.render = (): void => {};
  const measure = (node: Container): void => {
    if (node instanceof Text)
      Object.defineProperty(node, 'width', {
        get: (): number => node.text.length * 8 * node.scale.x,
      });
    for (const child of node.children) measure(child);
  };
  measure(hud.stage);
  for (const slot of hud.combat.slots)
    Object.defineProperty(slot.node, 'width', { get: (): number => 40 });
  hud.setVisible(true);
  const health = new HealthFx(),
    crosshair = new Crosshair();
  const state: AmmoState & HealthState & { time: number } = {
    health: 100,
    maxHealth: 100,
    armour: 0,
    ammo: 30,
    reserve: 210,
    magSize: 30,
    time: 0,
  };
  const map = new Minimap(new Rng(1));
  map.viewSpan = 60;
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
  const frame = (dt = 1 / 60, opacity = 1): void => {
    state.time += dt;
    activeHud.update(dt, state, health, crosshair, map, mapState, opacity, models);
  };
  frame();
  const initial = hud.draws;
  let healthTextWrites = 0,
    healthTextReads = 0;
  for (const node of [hud['hp'], hud['maxHp']]) {
    const value = node.text;
    Object.defineProperty(node, 'text', {
      get: (): string => {
        healthTextReads++;
        return value;
      },
      set: (): void => {
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
  for (const node of [hud['hp'], hud['maxHp']]) Reflect.deleteProperty(node, 'text');
  const changes = [
    (): void => {
      health.hpShown = 0.9;
    }, // bar easing with unchanged health snapshot
    (): void => {
      state.health = 27;
    }, // text + tint
    (): void => {
      state.maxHealth = 120;
    },
    (): void => {
      health.armourShown = 1;
      state.armour = 50;
    },
    (): void => {
      state.armour = 40;
    },
    (): void => {
      health.armourFlash = 1;
    },
    (): void => {
      health.armourShown = 0;
    },
    (): void => {
      crosshair.gap += 2;
    },
    (): void => {
      crosshair.bladeLength = 1.4;
    },
    (): void => {
      crosshair.bladeAlpha = 0.5;
    },
    (): void => {
      crosshair.dotScale = 1.2;
    },
    (): void => {
      crosshair.dotAlpha = 0.5;
    },
    (): void => {
      crosshair.visible = 0;
    },
    (): void => {
      crosshair.visible = 1;
    },
    (): void => {
      health.flashAlpha = 0.5;
    },
    (): void => {
      health.flashAlpha = 0;
    },
    (): void => {
      state.ammo--;
    },
    (): void => {
      state.reloading = true;
      state.reloadProgress = 0.4;
    },
    (): void => {
      state.reloadProgress = 0.6;
    },
    (): void => {
      state.reloading = false;
    },
    (): void => {
      mapState.heading = 20;
    },
    (): void => {
      models.fpsText = '61 FPS';
    },
    (): void => {
      models.prompt.set({ text: 'test', progress: 0.4 });
      models.prompt.update(0.2);
    },
    (): void => {
      models.prompt.set({ text: 'test', progress: 0.8 });
    },
    (): void => {
      models.hit.spawn('head');
      models.hit.update(0.05);
    },
    (): void => {
      models.hit.update(1);
    },
    (): void => {
      models.arcs.spawn(1, 0);
      models.arcs.update(0.09, 1, 0, 0, -1);
    },
    (): void => {
      models.arcs.update(2, 1, 0, 0, -1);
    },
  ];
  for (const change of changes) {
    const before: number = hud.draws;
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
  else deleteGlobal('document');
  if (dprDescriptor) Object.defineProperty(globalThis, 'devicePixelRatio', dprDescriptor);
  else deleteGlobal('devicePixelRatio');
}
console.log(
  'ok HUD redraw: active/paused idle suppression, health, armour, reticle, injury, reload, feedback and reveal'
);
