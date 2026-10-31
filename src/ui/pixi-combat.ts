import { Container, Graphics, Text } from 'pixi.js';

import type { AmmoPanel } from './ammo.ts';
import type { Compass } from './compass.ts';
import { BELL, SEG, SEG_ARC, SEG_STEP, R_MAIN, R_THIN } from './damage.ts';
import type { DamageArcs } from './damage.ts';
import { KINDS, R_IN, R_OUT } from './hitmarkers.ts';
import type { Hitmarkers, HitmarkerKind } from './hitmarkers.ts';

export interface CombatModels {
  hit: Hitmarkers;
  arcs: DamageArcs;
  compass: Compass;
  ammo: AmmoPanel;
  fpsText: string;
}

const HIT_KINDS: HitmarkerKind[] = ['hit', 'armour', 'head', 'kill'];

function glyph(kind: HitmarkerKind): Graphics {
  const g = new Graphics(),
    style = KINDS[kind];
  for (const [width, color, alpha] of [
    [4, 0, 0.7],
    [style.w, Number.parseInt(style.c.slice(1), 16), 1],
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
  for (const [radius, width, color, opacity] of [
    [R_MAIN, 9.5, 0, 0.45],
    [R_MAIN, 5.6, 0xff3f31, 1],
    [R_THIN, 1.5, 0xff6a52, 0.4],
  ]) {
    for (let i = 0; i < SEG; i++) {
      const centre = (i - (SEG - 1) / 2) * SEG_STEP - 90;
      const a = ((centre - SEG_ARC / 2) * Math.PI) / 180;
      const b = ((centre + SEG_ARC / 2) * Math.PI) / 180;
      g.moveTo(Math.cos(a) * radius, Math.sin(a) * radius)
        .arc(0, 0, radius, a, b)
        .stroke({ color, width, alpha: BELL[i] * opacity });
    }
  }
  return g;
}

function icon(index: number): Graphics {
  const g = new Graphics();
  if (index === 0) {
    g.roundRect(2.2, 5.2, 11.6, 7.4, 1.6)
      .fill(0xffffff)
      .roundRect(3.6, 6.6, 8.8, 4.6, 0.8)
      .fill({ color: 0, alpha: 0.4 })
      .poly([6.4, 12.6, 8.4, 12.6, 9.6, 18, 7.2, 18])
      .fill(0xffffff);
  } else if (index === 1) {
    g.poly([6.4, 0, 9.6, 0, 9.6, 2.1, 11.1, 2.1, 12.2, 4.1, 3.8, 4.1, 4.9, 2.1, 6.4, 2.1])
      .fill(0xffffff)
      .moveTo(8, 4.6)
      .bezierCurveTo(11.1, 4.6, 13.6, 7.5, 13.6, 11.7)
      .bezierCurveTo(13.6, 15.9, 11.1, 20, 8, 20)
      .bezierCurveTo(4.9, 20, 2.4, 15.9, 2.4, 11.7)
      .bezierCurveTo(2.4, 7.5, 4.9, 4.6, 8, 4.6)
      .fill(0xffffff);
    for (const y of [9.5, 13, 16.2])
      g.moveTo(3, y).lineTo(13, y).stroke({ color: 0, alpha: 0.5, width: 0.9 });
    g.moveTo(8, 5).lineTo(8, 19.6).stroke({ color: 0, alpha: 0.5, width: 0.9 });
  } else {
    g.poly([6, 1.2, 10, 1.2, 10, 2.4, 11.3, 2.4, 12.1, 3.9, 3.9, 3.9, 4.7, 2.4, 6, 2.4])
      .fill(0xffffff)
      .roundRect(2.6, 4.4, 10.8, 13.6, 1.6)
      .fill(0xffffff)
      .roundRect(4.4, 7, 7.2, 4.4, 0.5)
      .fill({ color: 0, alpha: 0.55 })
      .roundRect(12.2, 4.6, 1.4, 2.6, 0.6)
      .fill(0xffffff);
    for (let i = 0; i < 3; i++)
      g.roundRect(5, 13.4 + i * 1.4, 6, 0.7, 0.35).fill({ color: 0, alpha: 0.4 });
  }
  return g;
}

/** Retained presentation only; native owners advance all combat lifetimes. */
interface HitSlot {
  node: Container;
  variants: Record<HitmarkerKind, Graphics>;
  ring: Graphics;
}
interface EquipmentView {
  node: Container;
  symbol: Graphics;
  count: Text;
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
      variants = {
        hit: glyph('hit'),
        armour: glyph('armour'),
        head: glyph('head'),
        kill: glyph('kill'),
      };
    const ring = new Graphics().circle(0, 0, 30).stroke({ color: 0xffffff, width: 1.4 });
    node.addChild(ring, ...Object.values(variants));
    node.visible = false;
    this.hits.addChild(node);
    return { node, variants, ring };
  });
  readonly arcSlots = Array.from({ length: 6 }, (): Graphics => {
    const node = arc();
    node.visible = false;
    this.arcs.addChild(node);
    return node;
  });
  readonly slots = Array.from({ length: 3 }, (_, i): EquipmentView => {
    const node = new Container(),
      symbol = icon(i);
    symbol.scale.set(13 / 16, 16.5 / 20);
    const count = new Text({
      text: '0',
      style: {
        fontFamily: 'Arial',
        fontSize: 11,
        fill: 0xa9bac5,
        stroke: { color: 0x080c10, width: 1.5 },
      },
    });
    count.position.set(21, 1);
    node.addChild(symbol, count);
    this.equipment.addChild(node);
    return { node, symbol, count };
  });

  constructor() {
    this.fps.anchor.set(1, 0);
  }

  update(models: CombatModels): boolean {
    let dirty = false;
    for (let i = 0; i < this.hitSlots.length; i++) {
      const { node, variants, ring } = this.hitSlots[i],
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
            !variants[v.kind].visible))
      )
        dirty = true;
      if (alive && (!node.visible || !variants[v.kind].visible))
        ring.tint = Number.parseInt(KINDS[v.kind].c.slice(1), 16);
      node.visible = alive;
      if (!alive) continue;
      node.scale.set(v.scale);
      node.rotation = v.rotation;
      node.alpha = v.alpha;
      for (const kind of HIT_KINDS) variants[kind].visible = kind === v.kind;
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
    let right = 0;
    for (let i = 2; i >= 0; i--) {
      const { node, symbol, count } = this.slots[i],
        v = models.ammo.equipment[i];
      const value = String(v.count),
        tint = v.active ? 0xffb02a : 0xffffff;
      if (count.text !== value || node.alpha !== v.alpha || symbol.tint !== tint) dirty = true;
      count.text = value;
      node.alpha = v.alpha;
      symbol.tint = tint;
      const width = 21 + Math.max(7, count.width);
      node.x = right - width;
      right = node.x - 16;
    }
    if (this.fps.text !== models.fpsText) {
      this.fps.text = models.fpsText;
      dirty = true;
    }
    return dirty;
  }
}
