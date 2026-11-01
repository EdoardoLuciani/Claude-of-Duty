import { Container, Graphics, Text } from 'pixi.js';

import type { AmmoPanel } from './ammo.ts';
import type { Compass } from './compass.ts';
import { SEG, SEG_ARC, SEG_STEP, R_MAIN } from './damage.ts';
import type { DamageArcs } from './damage.ts';
import { KINDS, R_IN, R_OUT } from './hitmarkers.ts';
import type { Hitmarkers, HitmarkerKind } from './hitmarkers.ts';
import { accessoryIcon } from './pixi-accessory-icons.ts';
import { HUD_TYPE } from './pixi-type.ts';

export interface CombatModels {
  hit: Hitmarkers;
  arcs: DamageArcs;
  compass: Compass;
  ammo: AmmoPanel;
  fpsText: string;
}

function glyph(): Graphics {
  const g = new Graphics();
  for (const [width, color, alpha] of [
    [4, 0, 0.7],
    [2, 0xffffff, 1],
  ]) {
    for (let q = 0; q < 4; q++) {
      const sx = q === 0 || q === 3 ? 1 : -1,
        sy = q < 2 ? -1 : 1;
      g.moveTo(R_IN * Math.SQRT1_2 * sx, R_IN * Math.SQRT1_2 * sy).lineTo(
        R_OUT * Math.SQRT1_2 * sx,
        R_OUT * Math.SQRT1_2 * sy
      );
    }
    g.stroke({ color, width, alpha, cap: 'square' });
  }
  return g;
}

function arc(): Graphics {
  const g = new Graphics();
  const half = ((((SEG - 1) * SEG_STEP + SEG_ARC) / 2) * Math.PI) / 180;
  for (const [width, color, alpha] of [
    [9.5, 0, 0.45],
    [5.6, 0xff3f31, 1],
  ]) {
    g.moveTo(-Math.sin(half) * R_MAIN, -Math.cos(half) * R_MAIN)
      .arc(0, 0, R_MAIN, -Math.PI / 2 - half, -Math.PI / 2 + half)
      .stroke({ color, width, alpha });
  }
  return g;
}

/** Retained presentation only; native owners advance all combat lifetimes. */
interface HitSlot {
  node: Container;
  mark: Graphics;
  kind: HitmarkerKind | null;
  ring: Graphics;
}
interface EquipmentView {
  node: Container;
  label: Text;
  symbol: Graphics;
  count: number;
}
export class PixiCombat {
  readonly hits = new Container();
  readonly arcs = new Container();
  readonly equipment = new Container();
  readonly fps = new Text({
    text: '— FPS',
    style: {
      fontFamily: 'monospace',
      fontSize: 12,
      fontWeight: '600',
      fill: 0xe7f2ef,
      stroke: { color: 0x080c10, width: 1.5 },
    },
  });
  readonly hitSlots = Array.from({ length: 10 }, (): HitSlot => {
    const node = new Container(),
      mark = glyph();
    const ring = new Graphics().circle(0, 0, 30).stroke({ color: 0xffffff, width: 1.4 });
    node.addChild(ring, mark);
    node.visible = false;
    this.hits.addChild(node);
    return { node, mark, ring, kind: null };
  });
  readonly arcSlots = Array.from({ length: 6 }, (): Graphics => {
    const node = arc();
    node.visible = false;
    this.arcs.addChild(node);
    return node;
  });
  readonly slots: EquipmentView[];

  constructor() {
    this.fps.anchor.set(1, 0);
    this.slots = Array.from({ length: 2 }, (_, i): EquipmentView => {
      const label = new Text({
        text: '',
        style: {
          fontFamily: 'Arial',
          fontSize: HUD_TYPE.secondary,
          fontWeight: '600',
          fill: 0xffffff,
          stroke: { color: 0x080c10, width: 1.5 },
        },
      });
      const symbol = accessoryIcon(i),
        node = new Container();
      label.position.set(26, 0);
      node.addChild(symbol, label);
      this.equipment.addChild(node);
      return { node, label, symbol, count: -1 };
    });
  }

  update(models: CombatModels): boolean {
    let dirty = false;
    for (let i = 0; i < this.hitSlots.length; i++) {
      const slot = this.hitSlots[i],
        { node, mark, ring } = slot,
        v = models.hit.visuals[i];
      const alive = models.hit.pool.items[i].alive;
      if (
        node.visible !== alive ||
        (alive &&
          (node.scale.x !== v.scale ||
            node.rotation !== v.rotation ||
            node.alpha !== v.alpha ||
            ring.scale.x !== v.ringScale ||
            ring.alpha !== v.ringAlpha ||
            slot.kind !== v.kind))
      )
        dirty = true;
      if (alive && slot.kind !== v.kind) {
        slot.kind = v.kind;
        mark.tint = ring.tint = Number.parseInt(KINDS[v.kind].c.slice(1), 16);
      }
      node.visible = alive;
      if (!alive) continue;
      node.scale.set(v.scale);
      node.rotation = v.rotation;
      node.alpha = v.alpha;
      ring.scale.set(v.ringScale);
      ring.alpha = v.ringAlpha;
    }
    for (let i = 0; i < this.arcSlots.length; i++) {
      const node = this.arcSlots[i],
        v = models.arcs.visuals[i],
        alive = models.arcs.pool.items[i].alive;
      if (
        node.visible !== alive ||
        (alive &&
          (node.scale.x !== v.scale || node.rotation !== v.rotation || node.alpha !== v.alpha))
      )
        dirty = true;
      node.visible = alive;
      if (!alive) continue;
      node.scale.set(v.scale);
      node.rotation = v.rotation;
      node.alpha = v.alpha;
    }
    let layout = false;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i],
        v = models.ammo.equipment[i];
      if (slot.count !== v.count) {
        slot.count = v.count;
        slot.label.text = String(v.count);
        layout = dirty = true;
      }
      const tint = v.active ? 0xffb02a : 0xa9bac5;
      const iconTint = v.active ? 0xffb02a : 0xffffff;
      if (slot.node.alpha !== v.alpha || slot.label.tint !== tint || slot.symbol.tint !== iconTint)
        dirty = true;
      slot.node.alpha = v.alpha;
      slot.label.tint = tint;
      slot.symbol.tint = iconTint;
    }
    if (layout) {
      let right = 0;
      for (let i = this.slots.length - 1; i >= 0; i--) {
        const node = this.slots[i].node;
        node.x = right - node.width;
        right = node.x - 16;
      }
    }
    if (this.fps.text !== models.fpsText) {
      this.fps.text = models.fpsText;
      dirty = true;
    }
    return dirty;
  }
}
