import { Container, Graphics, type BitmapText } from 'pixi.js';

import { clamp, clamp01 } from '../core/math.ts';
import type { AmmoState } from './ammo.ts';
import { HUD_TYPE, hudText, writeHudText } from './pixi-type.ts';

export const AMMO_WIDTH = 248;
export const AMMO_HEIGHT = 110;
const WIDTH = AMMO_WIDTH;
const INK = 0xe7f2ef,
  MUTED = 0xa9bac5,
  AMBER = 0xffb02a;

function fillLevel(rounds: number, capacity: number): number {
  if (!rounds) return 0;
  return rounds >= capacity ? 4 : clamp(Math.round((4 * rounds) / capacity), 1, 3);
}

/** Retained read-only ammo graphics; the owner decides when/where to render. */
export class PixiAmmoView {
  readonly stage = new Container();
  private icons = new Graphics();
  private spareCount: BitmapText;
  private spareLevels: number[] = [];
  private name: BitmapText;
  private mode: BitmapText;
  private prompt: BitmapText;
  private bar = new Graphics()
    .rect(0, 0, 216, 3)
    .fill(0x263943)
    .stroke({ color: 0x080c10, width: 1 });
  private fill = new Graphics().rect(0, 0, 216, 3).fill(INK);
  dirty = true;
  private lastSpareCount = -1;
  private lastLoadedLevel = -1;
  private lastNextSpare = -1;
  private lastMode: AmmoState['fireMode'] | null = null;

  constructor() {
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.mode = this.text('AUTO', 14, 40, HUD_TYPE.label, MUTED);
    this.name = this.text('M4A1', WIDTH - 14, 40, HUD_TYPE.label);
    this.name.anchor.x = 1;
    this.text('LOADED', 16, 55, HUD_TYPE.label);
    this.spareCount = this.text('', 90, 55, HUD_TYPE.label, MUTED);
    this.icons.position.set(23, 73);
    this.stage.addChild(this.icons);
    // Warnings/reload feedback live above the readout, not below the bottom bar.
    this.prompt = this.text('', WIDTH / 2, 4, HUD_TYPE.label, AMBER);
    this.prompt.anchor.x = 0.5;
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

  private updateSpares(
    magazines: readonly number[],
    capacity: number,
    loadedRounds: number,
    next: number
  ): void {
    const count = magazines.length;
    const levels = this.spareLevels;
    const loadedLevel = fillLevel(loadedRounds, capacity);
    let changed = loadedLevel !== this.lastLoadedLevel || next !== this.lastNextSpare;
    this.lastLoadedLevel = loadedLevel;
    this.lastNextSpare = next;
    if (count !== this.lastSpareCount) {
      changed = true;
      this.lastSpareCount = count;
      levels.length = count;
      this.label(this.spareCount, `${count} ${count === 1 ? 'SPARE' : 'SPARES'}`);
    }
    for (let i = 0; i < count; i++) {
      const level = fillLevel(magazines[i], capacity);
      if (level !== levels[i]) {
        levels[i] = level;
        changed = true;
      }
    }
    if (!changed) return;
    this.icons.clear();
    this.drawMagazine(0, loadedLevel, INK);
    const start = 67;
    for (let i = 0; i < count; i++) {
      const x = start + i * 27;
      this.drawMagazine(x, levels[i], i === next ? AMBER : MUTED);
      if (i === next) this.icons.rect(x + 5, 26, 12, 1.5).fill(AMBER);
    }
    if (!count) {
      this.drawMagazine(start, 0, MUTED);
      this.icons
        .moveTo(start + 2, 22)
        .lineTo(start + 14, 2)
        .stroke({ color: MUTED, width: 1.5 });
    }
    this.dirty = true;
  }

  private drawMagazine(x: number, level: number, outlineColor: number): void {
    const g = this.icons;
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
    g.poly(outline).stroke({ color: outlineColor, width: 1.2 });
  }

  update(_dt: number, s: AmmoState): void {
    const mode = s.fireMode ?? 'auto';
    const spares = s.spares;
    const empty = s.loadedRounds === 0;
    this.updateSpares(spares, s.magSize, s.magazineOut ? 0 : s.loadedRounds, s.nextSpare ?? 0);
    this.label(this.name, s.weaponName ?? 'M4A1', 166);
    if (mode !== this.lastMode) this.label(this.mode, (this.lastMode = mode).toUpperCase());
    const reloading = !!s.reloading,
      progress = clamp01(s.reloadProgress ?? 0);
    let prompt = '';
    if (reloading) prompt = 'RELOADING';
    else if (empty) prompt = spares.length ? 'PRESS R TO RELOAD' : 'NO SPARE AMMO';
    this.label(this.prompt, prompt);
    const alpha =
      !reloading && empty
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
