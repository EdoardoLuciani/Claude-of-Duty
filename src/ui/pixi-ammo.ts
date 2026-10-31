import { WebGPURenderer } from 'pixi.js';
import type { Renderer } from 'three/webgpu';

import type { AmmoState } from './ammo.ts';
import { PixiAmmoView, AMMO_WIDTH, AMMO_HEIGHT } from './pixi-ammo-view.ts';
import { initPixiRenderer, restrictPixiCanvases } from './pixi-device.ts';

/** Original bounded ammo-only comparison; HUD slice reuses its retained view. */
export class PixiAmmoHud extends PixiAmmoView {
  readonly canvas = document.createElement('canvas');
  readonly renderer = new WebGPURenderer();
  private restoreAdapter: () => void = (): void => {};
  private parent: HTMLElement;
  enabled = false;
  draws = 0;

  static async create(parent: HTMLElement, game: Renderer): Promise<PixiAmmoHud> {
    const restore = restrictPixiCanvases();
    let hud: PixiAmmoHud | null = null;
    try {
      hud = new PixiAmmoHud(parent);
      hud.restoreAdapter = restore;
      await initPixiRenderer(hud.renderer, game, hud.canvas, AMMO_WIDTH, AMMO_HEIGHT);
      parent.classList.add('ow-ammo-pixi');
      parent.append(hud.canvas);
      hud.resize();
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

  private constructor(parent: HTMLElement) {
    super();
    this.parent = parent;
    this.canvas.className = 'ow-pixi-ammo';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Ammo and reload status');
    this.canvas.style.cssText = 'display:block;pointer-events:none;visibility:hidden';
  }

  setVisible(visible: boolean): void {
    if (visible === this.enabled) return;
    this.enabled = visible;
    this.canvas.style.visibility = visible ? '' : 'hidden';
  }

  resize(): void {
    const width = Math.max(1, this.parent.clientWidth);
    this.renderer.resize(
      width,
      (width * AMMO_HEIGHT) / AMMO_WIDTH,
      Math.min(devicePixelRatio || 1, 2)
    );
    this.stage.scale.set(width / AMMO_WIDTH);
    this.dirty = true;
  }

  override update(dt: number, s: AmmoState): void {
    super.update(dt, s);
    if (this.disposed || !this.enabled || !this.dirty) return;
    this.renderer.render(this.stage);
    this.draws++;
    this.dirty = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.stage.destroy({ children: true, texture: true, textureSource: true });
    } finally {
      try {
        this.renderer.destroy();
      } finally {
        this.restoreAdapter();
        this.parent.classList.remove('ow-ammo-pixi');
        this.canvas.remove();
      }
    }
  }
}
