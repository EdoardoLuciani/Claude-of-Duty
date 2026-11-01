import { Container, Graphics, Text } from 'pixi.js';

import { filledMagazinePips, MAX_PIPS } from './ammo.ts';
import type { AmmoState } from './ammo.ts';
import { HUD_TYPE } from './pixi-type.ts';
import { clamp01 } from './util.ts';

export const AMMO_WIDTH = 248;
export const AMMO_HEIGHT = 146;
const WIDTH = AMMO_WIDTH;
const INK = 0xe7f2ef,
  MUTED = 0xa9bac5,
  AMBER = 0xffb02a,
  RED = 0xff5145;

/** Retained read-only ammo graphics; the owner decides when/where to render. */
export class PixiAmmoView {
  readonly stage = new Container();
  private current: Text;
  private reserve: Text;
  private name: Text;
  private mode: Text;
  private prompt: Text;
  private magFill = new Graphics().rect(0, 0, 216, 4).fill(0xffffff);
  private bar = new Graphics()
    .rect(0, 0, 216, 3)
    .fill(0x263943)
    .stroke({ color: 0x080c10, width: 1 });
  private fill = new Graphics().rect(0, 0, 216, 3).fill(INK);
  dirty = true;
  protected disposed = false;
  private lastAmmo = -1;
  private lastReserve = -1;
  private lastMode: AmmoState['fireMode'] | null = null;

  constructor() {
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.mode = this.text('AUTO', 14, 40, HUD_TYPE.label, MUTED);
    this.name = this.text('M4A1', WIDTH - 14, 40, HUD_TYPE.label);
    this.name.anchor.x = 1;
    this.current = this.text('30', 119, 96, HUD_TYPE.value);
    this.current.anchor.set(1, 1);
    this.current.style.fill = 0xffffff;
    this.reserve = this.text('/ 210', 131, 96, HUD_TYPE.secondary, MUTED);
    this.reserve.anchor.y = 1;
    this.prompt = this.text('', WIDTH / 2, 119, HUD_TYPE.label, AMBER);
    this.prompt.anchor.x = 0.5;
    this.stage.addChild(new Graphics().rect(16, 102, 216, 4).fill(0x35434c));
    this.magFill.position.set(16, 102);
    this.stage.addChild(this.magFill);
    this.bar.position.set(16, 138);
    this.fill.position.copyFrom(this.bar.position);
    this.stage.addChild(this.bar, this.fill);
  }

  private text(value: string, x: number, y: number, fontSize: number, fill = INK): Text {
    const text = new Text({
      text: value,
      style: {
        fontFamily: 'Arial',
        fontSize,
        fontWeight: '600',
        fill,
        stroke: { color: 0x080c10, width: fontSize >= 20 ? 2 : 1, join: 'round' },
      },
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

  update(_dt: number, s: AmmoState): void {
    if (this.disposed) return;
    const ammo = Math.max(0, s.ammo | 0),
      mag = Math.max(1, s.magSize | 0 || 30);
    if (ammo !== this.lastAmmo) {
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
    const color = ammo === 0 ? RED : ammo / mag <= 0.34 ? AMBER : INK;
    if (this.current.tint !== color) {
      this.current.tint = color;
      this.dirty = true;
    }
    const reloading = !!s.reloading,
      progress = clamp01(s.reloadProgress ?? 0);
    const count = Math.min(MAX_PIPS, mag);
    const filled = filledMagazinePips(ammo, mag, reserve, reloading, progress);
    const fraction = clamp01(filled / count);
    if (this.magFill.scale.x !== fraction || this.magFill.tint !== color) {
      this.magFill.scale.x = fraction;
      this.magFill.tint = color;
      this.dirty = true;
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
  }
}
