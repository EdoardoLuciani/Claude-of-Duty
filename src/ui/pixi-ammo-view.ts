import { Container, Graphics, type BitmapText } from 'pixi.js';

import { clamp01 } from '../core/math.ts';
import type { AmmoState } from './ammo.ts';
import { HUD_TYPE, hudText, writeHudText } from './pixi-type.ts';

export const AMMO_WIDTH = 248;
// Align the magazine bar with the health widget's lower (armour) bar.
export const AMMO_HEIGHT = 110;
const WIDTH = AMMO_WIDTH;
const INK = 0xe7f2ef,
  MUTED = 0xa9bac5,
  AMBER = 0xffb02a,
  RED = 0xff5145;

/** Retained read-only ammo graphics; the owner decides when/where to render. */
export class PixiAmmoView {
  readonly stage = new Container();
  private current: BitmapText;
  private reserve: BitmapText;
  private spares = new Graphics();
  private spareCount: BitmapText;
  private spareLevels: number[] = [];
  private name: BitmapText;
  private mode: BitmapText;
  private prompt: BitmapText;
  private magFill = new Graphics().rect(0, 0, 216, 4).fill(0xffffff);
  private bar = new Graphics()
    .rect(0, 0, 216, 3)
    .fill(0x263943)
    .stroke({ color: 0x080c10, width: 1 });
  private fill = new Graphics().rect(0, 0, 216, 3).fill(INK);
  dirty = true;
  private lastAmmo = -1;
  private lastReserve = -1;
  private lastSpareCount = -1;
  private lastMode: AmmoState['fireMode'] | null = null;

  constructor() {
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.mode = this.text('AUTO', 14, 40, HUD_TYPE.label, MUTED);
    this.name = this.text('M4A1', WIDTH - 14, 40, HUD_TYPE.label);
    this.name.anchor.x = 1;
    this.current = this.text('30', 119, 96, HUD_TYPE.value, 0xffffff);
    this.current.anchor.set(1, 1);
    this.reserve = this.text('/ 210', 131, 96, HUD_TYPE.secondary, MUTED);
    this.reserve.anchor.y = 1;
    this.spareCount = this.text('', 78, 55, HUD_TYPE.label, MUTED);
    this.spareCount.visible = this.spares.visible = false;
    this.spares.position.set(78, 73);
    this.stage.addChild(this.spares);
    // Warnings/reload feedback live above the readout, not below the bottom bar.
    this.prompt = this.text('', WIDTH / 2, 4, HUD_TYPE.label, AMBER);
    this.prompt.anchor.x = 0.5;
    this.stage.addChild(new Graphics().rect(16, 102, 216, 4).fill(0x35434c));
    this.magFill.position.set(16, 102);
    this.stage.addChild(this.magFill);
    this.bar.position.set(16, 22);
    this.fill.position.copyFrom(this.bar.position);
    this.stage.addChild(this.bar, this.fill);
  }

  private text(value: string, x: number, y: number, fontSize: number, fill = INK): BitmapText {
    const text = hudText(value, x, y, fontSize, fill);
    this.stage.addChild(text);
    return text;
  }

  private label(text: BitmapText, value: string, width = 0): void {
    this.dirty = writeHudText(text, value, width) || this.dirty;
  }

  private updateSpares(magazines: readonly number[] | null, capacity: number): void {
    const visible = magazines !== null;
    if (this.spares.visible !== visible) {
      this.spares.visible = this.spareCount.visible = visible;
      this.reserve.visible = !visible;
      this.current.x = visible ? 60 : 119;
      this.dirty = true;
    }
    if (!magazines) return;
    const count = magazines.length;
    const levels = this.spareLevels;
    let changed = count !== this.lastSpareCount;
    if (changed) {
      this.lastSpareCount = count;
      levels.length = count;
      this.label(this.spareCount, `${count} ${count === 1 ? 'SPARE' : 'SPARES'}`);
    }
    for (let i = 0; i < count; i++) {
      const rounds = magazines[i];
      const level =
        rounds === capacity ? 4 : Math.min(3, Math.max(1, Math.round((4 * rounds) / capacity)));
      if (level !== levels[i]) {
        levels[i] = level;
        changed = true;
      }
    }
    if (!changed) return;
    this.spares.clear();
    for (let i = 0; i < count; i++) this.drawSpare(i * 22, levels[i], i === 0);
    if (!count) {
      this.drawSpare(0, 0, false);
      this.spares.moveTo(2, 22).lineTo(14, 2).stroke({ color: MUTED, width: 1.5 });
    }
    this.dirty = true;
  }

  private drawSpare(x: number, level: number, next: boolean): void {
    const g = this.spares;
    const outline = [x, 0, x + 12, 0, x + 12, 9, x + 17, 24, x + 5, 24, x, 9];
    g.poly(outline).fill(0x111b22);
    if (level > 0) {
      // Both sides of the silhouette bend below the shoulder. Clip the fill
      // to those same edges rather than scaling a rectangle inside the icon.
      const top = 24 - level * 6;
      const left = x + Math.max(0, top - 9) / 3;
      g.moveTo(left, top).lineTo(left + 12, top);
      if (top < 9) g.lineTo(x + 12, 9);
      g.lineTo(x + 17, 24).lineTo(x + 5, 24);
      if (top < 9) g.lineTo(x, 9);
      g.closePath().fill(INK);
    }
    g.poly(outline).stroke({ color: next ? AMBER : MUTED, width: 1.2 });
    if (next) g.rect(x + 5, 26, 12, 1.5).fill(AMBER);
  }

  update(_dt: number, s: AmmoState): void {
    const ammo = Math.max(0, s.ammo | 0),
      mag = Math.max(1, s.magSize | 0 || 30),
      reserve = Math.max(0, s.reserve | 0),
      mode = s.fireMode ?? 'auto';
    // Build per-frame label strings only when their source value changes.
    if (ammo !== this.lastAmmo) this.label(this.current, String((this.lastAmmo = ammo)));
    const spares = s.spareMagazines ?? null;
    this.updateSpares(spares, mag);
    if (!spares && reserve !== this.lastReserve)
      this.label(this.reserve, `/ ${(this.lastReserve = reserve)}`);
    this.label(this.name, s.weaponName ?? 'M4A1', 166);
    if (mode !== this.lastMode) this.label(this.mode, (this.lastMode = mode).toUpperCase());
    const color = ammo === 0 ? RED : ammo / mag <= 0.34 ? AMBER : INK;
    if (this.current.tint !== color) {
      this.current.tint = color;
      this.dirty = true;
    }
    const reloading = !!s.reloading,
      progress = clamp01(s.reloadProgress ?? 0);
    const fraction = s.magazineOut ? 0 : clamp01(ammo / mag);
    if (this.magFill.scale.x !== fraction || this.magFill.tint !== color) {
      this.magFill.scale.x = fraction;
      this.magFill.tint = color;
      this.dirty = true;
    }
    this.label(
      this.prompt,
      reloading
        ? 'RELOADING'
        : ammo === 0
          ? spares?.length === 0
            ? 'NO SPARE MAG'
            : 'PRESS R TO RELOAD'
          : ''
    );
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
  }
}
