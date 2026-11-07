import { Container, Graphics, WebGPURenderer } from 'pixi.js';
import type { Renderer } from 'three/webgpu';

import type { AmmoState } from './ammo.ts';
import type { Crosshair } from './crosshair.ts';
import type { HealthFx, HealthState } from './health.ts';
import type { Minimap, MinimapState } from './minimap.ts';
import { PixiAmmoView, AMMO_WIDTH, AMMO_HEIGHT } from './pixi-ammo-view.ts';
import { PixiCombat } from './pixi-combat.ts';
import type { CombatModels } from './pixi-combat.ts';
import { PixiCompass } from './pixi-compass.ts';
import { initPixiRenderer, restrictPixiCanvases } from './pixi-device.ts';
import { PixiFeedback } from './pixi-feedback.ts';
import type { FeedbackModels } from './pixi-feedback.ts';
import { PixiInjury } from './pixi-injury.ts';
import { PixiMinimap } from './pixi-minimap.ts';
import { HUD_TYPE, hudText as text, setHudTextResolution, writeHudText } from './pixi-type.ts';
import { clamp01, setStyle } from './util.ts';

/** Gameplay HUD presentation on one passive, borrowed-device WebGPU canvas. */
export class PixiHud {
  readonly canvas = document.createElement('canvas');
  readonly renderer = new WebGPURenderer();
  readonly stage = new Container();
  readonly chrome = new Container();
  readonly injury = new PixiInjury();
  readonly combat = new PixiCombat();
  readonly feedback = new PixiFeedback();
  readonly compass = new PixiCompass();
  readonly ammo = new PixiAmmoView();
  readonly minimap = new PixiMinimap();
  readonly vitals = new Container();
  readonly reticle = new Container();
  private hp = text('100', 14, 62, HUD_TYPE.value);
  private maxHp = text('/100', 102, 62, HUD_TYPE.secondary, 0xa9bac5);
  private hpFill = new Graphics().rect(0, 0, 168, 4).fill(0xffffff);
  private armour = new Container();
  private armourFill = new Graphics().rect(0, 0, 168, 4).fill(0x79d2ff);
  private armourText = text('ARMOUR', 14, 88, HUD_TYPE.label, 0x79d2ff);
  private blades: Graphics[] = [];
  private dot = new Graphics()
    .circle(0, 0, 1.1)
    .fill(0xffffff)
    .stroke({ color: 0x080c10, width: 1 });
  private restoreAdapter: () => void = (): void => {};
  private disposed = false;
  private dirty = true;
  private enabled = false;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private lastHp = -1;
  private lastMaxHp = -1;
  draws = 0;

  static async create(parent: HTMLElement, before: HTMLElement, game: Renderer): Promise<PixiHud> {
    const restore = restrictPixiCanvases();
    let hud: PixiHud | null = null;
    try {
      // Construct only after recording the restoration boundary: even field
      // initializer / text / graphics failures must restore the global adapter.
      hud = new PixiHud();
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
      } catch (cleanupError) {
        console.warn('[ui] HUD initialization cleanup failed', cleanupError);
      } finally {
        restore();
      }
      throw error;
    }
  }

  private constructor() {
    this.canvas.className = 'ow-pixi-hud';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute(
      'aria-label',
      'Gameplay HUD: ammo, health, crosshair, minimap, injury, compass, combat feedback, equipment, FPS and messages'
    );
    this.canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;visibility:hidden';
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.injury.mesh.visible = false;
    this.stage.addChild(this.injury.mesh, this.chrome);
    this.chrome.addChild(
      this.ammo.stage,
      this.vitals,
      this.minimap.stage,
      this.combat.arcs,
      this.reticle,
      this.combat.hits,
      this.compass.stage,
      this.combat.equipment,
      this.combat.fps,
      this.feedback.stage
    );
    this.hp.anchor.y = this.maxHp.anchor.y = 1;
    this.vitals.addChild(text('HEALTH', 14, 6, HUD_TYPE.label, 0xa9bac5), this.hp, this.maxHp);
    this.vitals.addChild(
      new Graphics().rect(14, 68, 168, 4).fill(0x35434c).stroke({ color: 0x080c10, width: 2 })
    );
    this.hpFill.position.set(14, 68);
    this.vitals.addChild(this.hpFill);
    this.vitals.addChild(this.armour);
    this.armour.addChild(
      this.armourText,
      new Graphics().rect(14, 104, 168, 4).fill(0x35434c),
      this.armourFill
    );
    this.armourFill.position.set(14, 104);
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
    this.viewportWidth = w;
    this.viewportHeight = h;
    this.renderer.resize(Math.max(1, w), Math.max(1, h), Math.min(devicePixelRatio || 1, 2));
    this.stage.scale.set(k);
    const textResolution = this.renderer.resolution * Math.max(1, k);
    setHudTextResolution(this.stage, textResolution);
    this.minimap.textResolution = textResolution;
    this.injury.resize(w, h, k);
    this.feedback.resize(w, h, k);
    this.ammo.stage.position.set(w / k - 26 - AMMO_WIDTH, h / k - 26 - AMMO_HEIGHT);
    this.vitals.position.set(26, h / k - 26 - 112);
    this.minimap.stage.position.set(26, 26 * 0.8);
    this.reticle.position.set(w / k / 2, h / k / 2);
    this.combat.hits.position.copyFrom(this.reticle.position);
    this.combat.arcs.position.copyFrom(this.reticle.position);
    this.compass.stage.position.set(w / k / 2 - 235, 26 * 0.7);
    this.combat.equipment.position.set(w / k - 40, h / k - 170);
    this.combat.fps.position.set(w / k - 26, 4 / k);
    this.combat.fps.style.fontSize = Math.max(10 / k, 12);
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
    models: CombatModels & FeedbackModels
  ): void {
    if (this.disposed) return;
    if (!this.enabled) return;
    // Moving between monitors can change DPR without a window resize event.
    // Reuse logical inputs, not renderer.screen dimensions rounded through physical pixels.
    if (this.renderer.resolution !== Math.min(devicePixelRatio || 1, 2))
      this.resize(this.viewportWidth, this.viewportHeight, this.stage.scale.x);
    // Injury opacity stays independent of readout/menu/death fading.
    const alpha = Math.round(opacity * 1000) / 1000;
    if (this.chrome.alpha !== alpha) this.dirty = true;
    this.chrome.alpha = alpha;
    this.chrome.visible = alpha >= 0.004;
    this.dirty = this.injury.update(health) || this.dirty;
    const visible = this.chrome.visible || this.injury.mesh.visible;
    setStyle(this.canvas, 'visibility', visible ? '' : 'hidden');
    if (!visible) return;
    this.dirty = this.combat.update(models) || this.dirty;
    this.dirty = this.feedback.update(models) || this.dirty;
    this.dirty = this.compass.update(models.compass) || this.dirty;
    this.ammo.update(dt, s);
    const max = s.maxHealth || 100,
      hp = Math.round(Math.max(0, Math.min(max, s.health ?? max)));
    if (hp !== this.lastHp) {
      this.lastHp = hp;
      this.dirty = writeHudText(this.hp, String(hp), 80) || this.dirty;
    }
    const maxHp = Math.round(max);
    if (maxHp !== this.lastMaxHp) {
      this.lastMaxHp = maxHp;
      this.dirty = writeHudText(this.maxHp, '/' + maxHp) || this.dirty;
    }
    const fraction = clamp01((s.health ?? max) / max),
      tint = fraction <= 0.28 ? 0xff5145 : fraction < 0.5 ? 0xffb02a : 0xe7f2ef;
    // Quantize rendered poses, not controller state: exponential easing must
    // eventually settle rather than invalidating for invisible floating-point tails.
    const hpFill = Math.round(clamp01(health.hpShown) * 10000) / 10000;
    if (this.hp.tint !== tint || this.hpFill.scale.x !== hpFill) this.dirty = true;
    this.hp.tint = this.hpFill.tint = tint;
    this.hpFill.scale.x = hpFill;
    const plateTint = health.armourFlash > 0.01 ? 0xc9efff : 0xffffff,
      armourAlpha = Math.round(health.armourShown * 1000) / 1000,
      armourVisible = health.armourShown >= 0.01,
      armourFill = clamp01((s.armour ?? 0) / (s.maxArmour || 150));
    if (
      this.armour.visible !== armourVisible ||
      (armourVisible &&
        (this.armour.alpha !== armourAlpha ||
          this.armourFill.tint !== plateTint ||
          this.armourFill.scale.x !== armourFill))
    )
      this.dirty = true;
    this.armour.alpha = armourAlpha;
    this.armour.visible = armourVisible;
    this.armourFill.scale.x = armourFill;
    this.armourFill.tint = plateTint;
    const reticleVisible = crosshair.visible >= 0.004;
    if (this.reticle.visible !== reticleVisible) this.dirty = true;
    this.reticle.visible = reticleVisible;
    if (reticleVisible) {
      const gap = Math.round((crosshair.gap / crosshair.k) * 1000) / 1000,
        length = Math.round(crosshair.bladeLength * 10000) / 10000,
        bladeAlpha = Math.round(crosshair.bladeAlpha * 1000) / 1000,
        dotScale = Math.round(crosshair.dotScale * 10000) / 10000,
        dotAlpha = Math.round(crosshair.dotAlpha * 1000) / 1000;
      for (let i = 0; i < this.blades.length; i++) {
        const blade = this.blades[i],
          angle = (i * Math.PI) / 2,
          x = Math.sin(angle) * gap,
          y = -Math.cos(angle) * gap;
        if (
          blade.x !== x ||
          blade.y !== y ||
          blade.scale.y !== length ||
          blade.alpha !== bladeAlpha
        )
          this.dirty = true;
        blade.position.set(x, y);
        blade.rotation = angle;
        blade.scale.y = length;
        blade.alpha = bladeAlpha;
      }
      if (this.dot.scale.x !== dotScale || this.dot.alpha !== dotAlpha) this.dirty = true;
      this.dot.scale.set(dotScale);
      this.dot.alpha = dotAlpha;
    }
    this.dirty = this.minimap.update(map, mapState) || this.ammo.dirty || this.dirty;
    // Controllers still advance every frame. Draw only when their presentation
    // changes, including during gameplay; time alone is not a visual change.
    if (!this.dirty) return;
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
