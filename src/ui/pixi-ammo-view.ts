import { Container, Graphics, type BitmapText } from 'pixi.js';

import { clamp01 } from '../core/math.ts';
import type { AmmoState } from './ammo.ts';
import { hudText } from './pixi-glyphs.ts';
import { HUD_TYPE, hudPanel, writeHudText } from './pixi-type.ts';

export const AMMO_WIDTH = 248;
// Align the magazine bar with the health widget's lower (armour) bar.
export const AMMO_HEIGHT = 110;
const INK = 0xe7f2ef,
  MUTED = 0xa9bac5,
  AMBER = 0xffb02a,
  RED = 0xff5145;

/** Retained read-only ammo graphics; the owner decides when/where to render. */
export class PixiAmmoView {
  readonly stage = new Container();
  private current = hudText('30', 119, 96, HUD_TYPE.value, 0xffffff);
  private reserve = hudText('/ 210', 131, 96, HUD_TYPE.secondary, MUTED);
  private name = hudText('M4A1', AMMO_WIDTH - 16, 40, HUD_TYPE.label);
  private mode = hudText('AUTO', 16, 40, HUD_TYPE.label, MUTED);
  private prompt = hudText('', AMMO_WIDTH / 2, 4, HUD_TYPE.label, AMBER);
  private magFill = new Graphics().rect(0, 0, 216, 4).fill(0xffffff);
  private bar = new Graphics()
    .rect(0, 0, 216, 3)
    .fill(0x263943)
    .stroke({ color: 0x080c10, width: 1 });
  private fill = new Graphics().rect(0, 0, 216, 3).fill(INK);
  dirty = true;
  private lastAmmo = -1;
  private lastReserve = -1;
  private lastMode: AmmoState['fireMode'] | null = null;

  constructor() {
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.name.anchor.x = 1;
    this.current.anchor.set(1, 1);
    this.reserve.anchor.y = 1;
    this.prompt.anchor.x = 0.5;
    this.magFill.position.set(16, 102);
    this.bar.position.set(16, 22);
    this.fill.position.copyFrom(this.bar.position);
    this.stage.addChild(
      hudPanel(AMMO_WIDTH, AMMO_HEIGHT),
      this.mode,
      this.name,
      this.current,
      this.reserve,
      this.prompt,
      new Graphics().rect(16, 102, 216, 4).fill(0x35434c),
      this.magFill,
      this.bar,
      this.fill
    );
  }

  private label(text: BitmapText, value: string): void {
    this.dirty = writeHudText(text, value) || this.dirty;
  }

  update(_dt: number, s: AmmoState): void {
    const ammo = Math.max(0, s.ammo | 0),
      mag = Math.max(1, s.magSize | 0 || 30),
      reserve = Math.max(0, s.reserve | 0),
      mode = s.fireMode ?? 'auto';
    // Build per-frame label strings only when their source value changes.
    if (ammo !== this.lastAmmo) this.label(this.current, String((this.lastAmmo = ammo)));
    if (reserve !== this.lastReserve) this.label(this.reserve, `/ ${(this.lastReserve = reserve)}`);
    this.label(this.name, s.weaponName ?? 'M4A1');
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
    this.label(this.prompt, reloading ? 'RELOADING' : ammo === 0 ? 'PRESS R TO RELOAD' : '');
    const fill = Math.round(progress * 1000) / 1000;
    if (this.bar.visible !== reloading || this.fill.scale.x !== fill) {
      this.bar.visible = this.fill.visible = reloading;
      this.fill.scale.x = fill;
      this.dirty = true;
    }
  }
}
