import { Container, Graphics, Text, WebGPURenderer } from 'pixi.js';
import type { Renderer } from 'three/webgpu';

import type { AmmoState } from './ammo.ts';
import type { Crosshair } from './crosshair.ts';
import type { HealthFx, HealthState } from './health.ts';
import type { WorldMarkers } from './markers.ts';
import type { Minimap, MinimapState } from './minimap.ts';
import { PixiAmmoView, AMMO_WIDTH, AMMO_HEIGHT } from './pixi-ammo-view.ts';
import { initPixiRenderer, restrictPixiCanvases } from './pixi-device.ts';
import { PixiInjury } from './pixi-injury.ts';
import { PixiWorldMarkers } from './pixi-markers.ts';
import { PixiMinimap } from './pixi-minimap.ts';
import { clamp01, setStyle } from './util.ts';

function text(value: string, x: number, y: number, size: number, fill = 0xe7f2ef): Text {
  const node = new Text({
    text: value,
    style: {
      fontFamily: 'Arial',
      fontSize: size,
      fontWeight: '600',
      fill,
      stroke: { color: 0x080c10, width: size >= 20 ? 2 : 1, join: 'round' },
    },
  });
  node.position.set(x, y);
  return node;
}

const WATCH = [
  'health',
  'maxHealth',
  'armour',
  'maxArmour',
  'ammo',
  'reserve',
  'weaponName',
  'fireMode',
  'reloading',
  'reloadProgress',
  'time',
] as const;

/** Bounded gameplay HUD experiment, not a replacement UI framework. */
export class PixiHudSlice {
  readonly canvas = document.createElement('canvas');
  readonly renderer = new WebGPURenderer();
  readonly stage = new Container();
  readonly chrome = new Container();
  readonly injury = new PixiInjury();
  readonly worldMarkers = new PixiWorldMarkers();
  readonly gpuUnderlays: boolean;
  readonly ammo = new PixiAmmoView();
  readonly minimap = new PixiMinimap();
  readonly vitals = new Container();
  readonly reticle = new Container();
  private hp = text('100', 14, 24, 38);
  private hpScale = 1;
  private maxHp = text('/100', 108, 46, 12, 0xa9bac5);
  private hpFill = new Graphics().rect(0, 0, 168, 7).fill(0xffffff);
  private armour = new Container();
  private plates: Graphics[] = [];
  private blades: Graphics[] = [];
  private dot = new Graphics()
    .circle(0, 0, 1.1)
    .fill(0xffffff)
    .stroke({ color: 0x080c10, width: 1 });
  private restoreAdapter: () => void = (): void => {};
  private disposed = false;
  private dirty = true;
  private enabled = false;
  private lastState = new Map<string, unknown>();
  draws = 0;

  static async create(
    parent: HTMLElement,
    before: HTMLElement,
    game: Renderer,
    gpuUnderlays = true
  ): Promise<PixiHudSlice> {
    const restore = restrictPixiCanvases();
    let hud: PixiHudSlice | null = null;
    try {
      // Construct only after recording the restoration boundary: even field
      // initializer / text / graphics failures must restore the global adapter.
      hud = new PixiHudSlice(gpuUnderlays);
      hud.restoreAdapter = restore;
      await initPixiRenderer(
        hud.renderer,
        game,
        hud.canvas,
        parent.clientWidth || innerWidth,
        parent.clientHeight || innerHeight
      );
      parent.insertBefore(hud.canvas, before);
      return hud;
    } catch (error) {
      try {
        hud?.dispose();
      } finally {
        restore();
      }
      throw error;
    }
  }

  private constructor(gpuUnderlays: boolean) {
    this.gpuUnderlays = gpuUnderlays;
    this.canvas.className = 'ow-pixi-hud-slice';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute(
      'aria-label',
      'Experimental gameplay HUD: ammo, health, crosshair, minimap, injury and world markers'
    );
    this.canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;visibility:hidden';
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.injury.mesh.visible = false;
    this.worldMarkers.stage.visible = false;
    this.stage.addChild(this.injury.mesh, this.worldMarkers.stage, this.chrome);
    this.chrome.addChild(this.ammo.stage, this.vitals, this.minimap.stage, this.reticle);
    this.vitals.addChild(text('HEALTH', 14, 10, 10, 0xa9bac5), this.hp, this.maxHp);
    this.vitals.addChild(
      new Graphics().rect(14, 72, 168, 7).fill(0x35434c).stroke({ color: 0x080c10, width: 2 })
    );
    this.hpFill.position.set(14, 72);
    this.vitals.addChild(this.hpFill);
    const dividers = new Graphics();
    for (let i = 1; i < 5; i++) dividers.rect(14 + (i * 168) / 5, 72, 1, 7).fill(0x0a141c);
    this.vitals.addChild(dividers, this.armour);
    this.armour.addChild(text('ARMOUR', 14, 91, 9, 0x79d2ff));
    for (let i = 0; i < 3; i++) {
      const x = 78 + i * 36;
      this.armour.addChild(
        new Graphics().rect(x, 94, 31, 5).fill(0x35434c).stroke({ color: 0x080c10, width: 1 })
      );
      const plate = new Graphics().rect(0, 0, 31, 5).fill(0x79d2ff);
      plate.position.set(x, 94);
      this.plates.push(plate);
      this.armour.addChild(plate);
    }
    for (let i = 0; i < 4; i++) {
      const blade = new Graphics()
        .rect(-0.8, -4, 1.6, 8)
        .fill(0xffffff)
        .stroke({ color: 0x080c10, width: 1 });
      this.blades.push(blade);
      this.reticle.addChild(blade);
    }
    this.reticle.addChild(this.dot);
  }

  resize(w: number, h: number, k: number): void {
    if (this.disposed) return;
    this.renderer.resize(Math.max(1, w), Math.max(1, h), Math.min(devicePixelRatio || 1, 2));
    this.stage.scale.set(k);
    this.injury.resize(w, h, k);
    this.ammo.stage.position.set(w / k - 26 - AMMO_WIDTH, h / k - 26 - AMMO_HEIGHT);
    this.vitals.position.set(26, h / k - 26 - 112);
    this.minimap.stage.position.set(26, 26 * 0.8);
    this.reticle.position.set(w / k / 2, h / k / 2);
    this.dirty = true;
  }

  setVisible(visible: boolean): void {
    if (this.enabled === visible) return;
    this.enabled = visible;
    setStyle(this.canvas, 'visibility', visible ? '' : 'hidden');
    this.dirty = true;
  }

  update(
    dt: number,
    s: AmmoState & HealthState,
    health: HealthFx,
    crosshair: Crosshair,
    map: Minimap,
    mapState: MinimapState,
    opacity: number,
    markers: WorldMarkers
  ): void {
    if (this.disposed) return;
    if (!this.enabled) return;
    // Injury opacity is independent of HUD/menu/death fading, as in HTML.
    const alpha = Number(opacity.toFixed(3));
    if (this.chrome.alpha !== alpha) this.dirty = true;
    this.chrome.alpha = this.worldMarkers.stage.alpha = alpha;
    this.chrome.visible = alpha >= 0.004;
    this.worldMarkers.stage.visible = this.gpuUnderlays && this.chrome.visible;
    if (this.gpuUnderlays) {
      this.dirty = this.injury.update(health) || this.dirty;
      this.dirty = this.worldMarkers.update(markers, this.stage.scale.x) || this.dirty;
    }
    const visible = this.chrome.visible || this.injury.mesh.visible;
    setStyle(this.canvas, 'visibility', visible ? '' : 'hidden');
    if (!visible) return;
    for (const key of WATCH) {
      if (this.lastState.get(key) !== s[key]) {
        this.lastState.set(key, s[key]);
        this.dirty = true;
      }
    }
    this.ammo.update(dt, s);
    const max = s.maxHealth || 100,
      hp = Math.round(Math.max(0, Math.min(max, s.health ?? max)));
    if (this.hp.text !== String(hp)) {
      this.hp.text = String(hp);
      this.hp.scale.set(1);
      this.hpScale = Math.min(1, 84 / Math.max(1, this.hp.width));
      this.dirty = true;
    }
    if (this.maxHp.text !== '/' + Math.round(max)) {
      this.maxHp.text = '/' + Math.round(max);
      this.dirty = true;
    }
    const fraction = clamp01((s.health ?? max) / max),
      tint = fraction <= 0.28 ? 0xff5145 : fraction < 0.5 ? 0xffb02a : 0xe7f2ef;
    this.hp.tint = this.hpFill.tint = tint;
    this.hp.scale.set(this.hpScale * (1 + health.beatEnergy * 0.05));
    this.hpFill.scale.x = clamp01(health.hpShown);
    const plateTint = health.armourFlash > 0.01 ? 0xc9efff : 0xffffff;
    if (this.armour.alpha !== health.armourShown || this.plates[0]?.tint !== plateTint)
      this.dirty = true;
    this.armour.alpha = health.armourShown;
    this.armour.visible = health.armourShown >= 0.01;
    for (let i = 0; i < 3; i++) {
      this.plates[i].scale.x = clamp01(
        ((s.armour ?? 0) - (i * (s.maxArmour || 150)) / 3) / ((s.maxArmour || 150) / 3)
      );
      this.plates[i].tint = plateTint;
    }
    for (let i = 0; i < this.blades.length; i++) {
      const blade = this.blades[i],
        angle = (i * Math.PI) / 2,
        gap = crosshair.gap / crosshair.k;
      blade.position.set(Math.sin(angle) * gap, -Math.cos(angle) * gap);
      blade.rotation = angle;
      blade.scale.y = crosshair.bladeLength;
      blade.alpha = crosshair.bladeAlpha;
    }
    this.dot.scale.set(crosshair.dotScale);
    this.dot.alpha = crosshair.dotAlpha;
    this.reticle.visible = crosshair.visible >= 0.004;
    this.dirty = this.minimap.update(map, mapState) || this.ammo.dirty || this.dirty;
    // One render driven by the engine, never an Application/ticker. During a
    // paused static frame only resize/reveal/value changes require a redraw.
    if (dt <= 0 && !this.dirty) return;
    this.renderer.render(this.stage);
    this.draws++;
    this.dirty = false;
    this.ammo.dirty = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      try {
        this.injury.dispose();
      } finally {
        this.stage.destroy({ children: true, texture: true, textureSource: true });
      }
    } finally {
      try {
        this.renderer.destroy();
      } finally {
        this.restoreAdapter();
        this.canvas.remove();
      }
    }
  }
}
