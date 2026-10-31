import { Container, Graphics, Text, WebGPURenderer } from 'pixi.js';
import type { Renderer } from 'three/webgpu';

import { filledMagazinePips, MAX_PIPS } from './ammo.ts';
import type { AmmoState } from './ammo.ts';
import { initPixiRenderer, restrictPixiCanvases } from './pixi-device.ts';
import { clamp01, ease } from './util.ts';

const WIDTH = 248;
const HEIGHT = 146;
const INK = 0xe7f2ef,
  MUTED = 0xa9bac5,
  AMBER = 0xffb02a,
  RED = 0xff5145;

/** Read-only, bounded canvas in the original ammo/chrome DOM layer. */
export class PixiAmmoHud {
  readonly canvas = document.createElement('canvas');
  readonly renderer = new WebGPURenderer();
  readonly stage = new Container();
  private current: Text;
  private reserve: Text;
  private name: Text;
  private mode: Text;
  private prompt: Text;
  private pips: Graphics[] = [];
  private bar = new Graphics().rect(0, 0, 216, 3).fill(0x263943);
  private fill = new Graphics().rect(0, 0, 216, 3).fill(0x85cbbb);
  private dirty = true;
  private disposed = false;
  private restoreAdapter: () => void = (): void => {};
  private parent: HTMLElement;
  enabled = false;
  draws = 0;
  punch = 0;
  private lastAmmo = -1;
  private lastReserve = -1;
  private lastMode: AmmoState['fireMode'] | null = null;

  static async create(parent: HTMLElement, game: Renderer): Promise<PixiAmmoHud> {
    const restore = restrictPixiCanvases();
    let hud: PixiAmmoHud | null = null;
    try {
      hud = new PixiAmmoHud(parent);
      hud.restoreAdapter = restore;
      await initPixiRenderer(hud.renderer, game, hud.canvas, WIDTH, HEIGHT);
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
    this.parent = parent;
    this.canvas.className = 'ow-pixi-ammo';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Ammo and reload status');
    this.canvas.style.cssText = 'display:block;pointer-events:none;visibility:hidden';
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.stage.addChild(
      new Graphics()
        .roundRect(0, 0, WIDTH, HEIGHT, 6)
        .fill({ color: 0x0a141c, alpha: 0.88 })
        .stroke({ color: 0x526e70, alpha: 0.7, width: 1 })
    );
    this.stage.addChild(new Graphics().roundRect(0, 8, 2, HEIGHT - 16, 1).fill(0x85cbbb));
    this.mode = this.text('AUTO', 14, 12, 10, MUTED);
    this.name = this.text('M4A1', WIDTH - 14, 11, 12);
    this.name.anchor.x = 1;
    this.current = this.text('30', 119, 34, 54);
    this.current.anchor.set(1, 0);
    this.current.style.fill = 0xffffff;
    this.reserve = this.text('/ 210', 131, 62, 21, MUTED);
    this.prompt = this.text('', WIDTH / 2, 119, 11, AMBER);
    this.prompt.anchor.x = 0.5;
    for (let i = 0; i < MAX_PIPS; i++) {
      const pip = new Graphics().rect(0, 0, 5, 7).fill(0xffffff);
      pip.y = 101;
      this.pips.push(pip);
      this.stage.addChild(pip);
    }
    this.bar.position.set(16, 138);
    this.fill.position.copyFrom(this.bar.position);
    this.stage.addChild(this.bar, this.fill);
  }

  private text(value: string, x: number, y: number, fontSize: number, fill = INK): Text {
    const text = new Text({
      text: value,
      style: { fontFamily: 'Arial', fontSize, fontWeight: '600', fill },
    });
    text.position.set(x, y);
    this.stage.addChild(text);
    return text;
  }

  private label(text: Text, value: string): void {
    if (text.text === value) return;
    text.text = value;
    this.dirty = true;
  }

  setVisible(visible: boolean): void {
    if (visible === this.enabled) return;
    this.enabled = visible;
    this.canvas.style.visibility = visible ? '' : 'hidden';
  }

  resize(): void {
    const width = Math.max(1, this.parent.clientWidth);
    this.renderer.resize(width, (width * HEIGHT) / WIDTH, Math.min(devicePixelRatio || 1, 2));
    this.stage.scale.set(width / WIDTH);
    this.dirty = true;
  }

  update(dt: number, s: AmmoState): void {
    if (this.disposed) return;
    const ammo = Math.max(0, s.ammo | 0),
      mag = Math.max(1, s.magSize | 0 || 30);
    if (ammo !== this.lastAmmo) {
      if (this.lastAmmo >= 0 && ammo < this.lastAmmo) this.punch = 1;
      this.lastAmmo = ammo;
      this.current.text = String(ammo);
      this.dirty = true;
    }
    const reserve = Math.max(0, s.reserve | 0);
    if (reserve !== this.lastReserve) {
      this.lastReserve = reserve;
      this.reserve.text = `/ ${reserve}`;
      this.dirty = true;
    }
    const name = s.weaponName ?? s.name ?? 'M4A1';
    if (this.name.text !== name) {
      this.name.text = name;
      // Measure only on a swap; keep long authored names inside the column.
      this.name.scale.set(1);
      this.name.scale.set(Math.min(1, 166 / Math.max(1, this.name.width)));
      this.dirty = true;
    }
    const mode = s.fireMode ?? 'auto';
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      this.label(this.mode, mode.toUpperCase());
    }
    this.punch = Math.max(0, this.punch - dt * 6.5);
    const scale = Math.round((1 - 0.075 * ease.outQuad(this.punch)) * 1000) / 1000;
    if (this.current.scale.x !== scale) {
      this.current.scale.set(scale);
      this.dirty = true;
    }
    const color = ammo === 0 ? RED : ammo / mag <= 0.34 ? AMBER : INK;
    if (this.current.tint !== color) {
      this.current.tint = color;
      this.dirty = true;
    }
    const reloading = !!s.reloading,
      progress = clamp01(s.reloadProgress ?? 0);
    const count = Math.min(MAX_PIPS, mag);
    const filled = filledMagazinePips(ammo, mag, reserve, reloading, progress);
    for (let i = 0; i < MAX_PIPS; i++) {
      const pip = this.pips[i],
        visible = i < count;
      const tint = i < filled ? (!reloading && filled / count <= 0.34 ? AMBER : INK) : 0x35434c;
      const x = WIDTH - 16 - count * 7 + i * 7;
      if (pip.visible !== visible || pip.tint !== tint || pip.x !== x) {
        pip.visible = visible;
        pip.tint = tint;
        pip.x = x;
        this.dirty = true;
      }
    }
    this.label(this.prompt, reloading ? 'RELOADING' : ammo === 0 ? 'PRESS R TO RELOAD' : '');
    const alpha =
      !reloading && ammo === 0
        ? Math.round((0.55 + 0.45 * Math.abs(Math.sin((s.time ?? 0) * 3.8))) * 1000) / 1000
        : 1;
    const fill = Math.round(progress * 1000) / 1000;
    if (
      this.prompt.alpha !== alpha ||
      this.bar.visible !== reloading ||
      this.fill.scale.x !== fill
    ) {
      this.prompt.alpha = alpha;
      this.bar.visible = this.fill.visible = reloading;
      this.fill.scale.x = fill;
      this.dirty = true;
    }
    if (!this.enabled || !this.dirty) return;
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
