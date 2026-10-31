import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

import type { Minimap, MinimapState } from './minimap.ts';
import { clamp, clamp01 } from './util.ts';

const SIZE = 178,
  HALF = SIZE / 2;
const INK = 0xe7f2ef;

function label(value: string, size: number, color: number): Text {
  const text = new Text({
    text: value,
    style: { fontFamily: 'Arial', fontSize: size, fontWeight: '600', fill: color },
  });
  text.anchor.set(0.5);
  return text;
}

function move(node: Container, x: number, y: number): boolean {
  const changed = node.x !== x || node.y !== y;
  node.position.set(x, y);
  return changed;
}

/** Same authored map bake/data as HTML; no per-frame Canvas2D drawing/uploads. */
export class PixiMinimap {
  readonly stage = new Container();
  readonly viewport = new Container();
  private terrain = new Container();
  private pan = new Container();
  private grid = new Graphics();
  private cone = new Graphics();
  private player = new Graphics()
    .poly([0, -7.44, 5.52, 6.24, 0, 2.88, -5.52, 6.24])
    .fill(0xf6fcff)
    .stroke({ color: 0x02060a, width: 1.6 });
  private source: HTMLCanvasElement | null = null;
  private labels: {
    node: Container;
    x: number;
    z: number;
    halfW: number;
    halfH: number;
    fits: boolean;
  }[] = [];
  private contacts: Graphics[] = [];
  private objectives: { node: Container; text: Text }[] = [];
  private pulses: { node: Container; ring: Graphics; text: Text; radius: number }[] = [];
  private fov = -1;
  uploads = 0;

  constructor() {
    this.stage.eventMode = 'none';
    this.stage.addChild(new Graphics().rect(0, 0, SIZE, SIZE).fill(0x1b232a));
    const mask = new Graphics().rect(0, 0, SIZE, SIZE).fill(0xffffff);
    this.stage.addChild(this.viewport, mask);
    this.viewport.mask = mask;
    this.viewport.addChild(this.terrain, this.grid, this.cone, this.pan);
    for (let i = 0; i < 9; i++) {
      const n = (i * SIZE) / 6;
      this.grid.moveTo(n, 0).lineTo(n, SIZE + SIZE / 6);
      this.grid.moveTo(0, n).lineTo(SIZE + SIZE / 6, n);
    }
    this.grid.stroke({ color: 0x0a1117, alpha: 0.2, width: 0.5 });
    this.cone.position.set(HALF, HALF);
    // Pools grow only to the bounded gameplay snapshot sizes, never each frame.
    for (let i = 0; i < 48; i++) {
      const contact = new Graphics()
        .poly([0, -5.1, 3.91, 3.74, -3.91, 3.74])
        .fill(0xffffff)
        .stroke({ color: 0x060a0e, width: 1.1 });
      contact.visible = false;
      this.contacts.push(contact);
      this.viewport.addChild(contact);
    }
    this.player.position.set(HALF, HALF);
    // Add player last again after dynamic pools so it always owns the centre.
    this.viewport.addChild(this.player);
    this.stage.addChild(
      new Graphics().rect(0, 0, SIZE, SIZE).stroke({ color: 0x85a5ab, alpha: 0.7, width: 1 })
    );
    const north = label('N', 10, INK);
    north.position.set(HALF, 8);
    const zone = label('ZONE 07     ·     60M', 9, 0xa9bac5);
    zone.position.set(HALF, SIZE + 12);
    this.stage.addChild(north, zone);
  }

  private bake(map: Minimap): void {
    if (!map.baked || map.baked === this.source) return;
    this.source = map.baked;
    const ppm = SIZE / map.viewSpan;
    const sprite = new Sprite(Texture.from(map.baked));
    sprite.width = sprite.height = map.span * ppm;
    sprite.position.set((map.centre.x - map.span / 2) * ppm, (map.centre.y - map.span / 2) * ppm);
    this.terrain.addChild(sprite);
    for (const l of map.labels) {
      const node = new Container();
      let size = 9;
      const room = l.w * ppm + 2;
      const name = l.text ? label(l.text, size, 0x0c1319) : null;
      if (name && name.width > room) {
        size *= 0.8;
        name.style.fontSize = size;
      }
      const codeSize = Math.min(7.5, size * 0.85);
      const code = label(l.code, codeSize, l.text ? 0x0c1319 : 0xc4d6e2);
      code.alpha = l.text ? 0.6 : 0.28;
      if (name) {
        name.y = -size * 0.62;
        node.addChild(name);
      }
      code.y = name ? size * 0.78 : 0.5;
      node.addChild(code);
      node.position.set(l.x * ppm, l.z * ppm);
      this.pan.addChild(node);
      const width = Math.max(name?.width ?? 0, code.width);
      this.labels.push({
        node,
        x: l.x,
        z: l.z,
        halfW: width / 2,
        halfH: name ? size * 1.2 : codeSize / 2,
        fits: width <= room,
      });
    }
    this.uploads++;
  }

  update(map: Minimap, s: MinimapState): boolean {
    const uploads = this.uploads;
    this.bake(map);
    let changed = uploads !== this.uploads;
    const ppm = SIZE / map.viewSpan,
      x = s.x ?? 0,
      z = s.z ?? 0;
    const ox = HALF - x * ppm,
      oy = HALF - z * ppm;
    changed = move(this.terrain, ox, oy) || changed;
    changed = move(this.pan, ox, oy) || changed;
    const step = ppm * 10;
    changed =
      move(this.grid, (((ox % step) + step) % step) - step, (((oy % step) + step) % step) - step) ||
      changed;
    const fov = Math.round((s.fov ?? 80) * 10) / 10;
    if (fov !== this.fov) {
      changed = true;
      this.fov = fov;
      const angle = (fov * Math.PI) / 360;
      this.cone
        .clear()
        .moveTo(0, 0)
        .arc(0, 0, SIZE * 0.42, -Math.PI / 2 - angle, -Math.PI / 2 + angle)
        .closePath()
        .fill({ color: 0xdef2ff, alpha: 0.12 })
        .stroke({ color: 0xe2f4ff, alpha: 0.17, width: 0.5 });
    }
    const heading = ((s.heading ?? 0) * Math.PI) / 180;
    if (this.player.rotation !== heading) changed = true;
    this.cone.rotation = this.player.rotation = heading;
    for (const l of this.labels) {
      const dx = l.x * ppm + ox,
        dy = l.z * ppm + oy;
      const edge = Math.min(dx - l.halfW, SIZE - dx - l.halfW, dy - l.halfH, SIZE - dy - l.halfH);
      const alpha = clamp01((edge - 1) / 10);
      if (l.node.alpha !== alpha) changed = true;
      l.node.alpha = alpha;
      l.node.visible = l.fits && l.node.alpha > 0.02;
    }
    for (let i = 0; i < this.contacts.length; i++) {
      const node = this.contacts[i],
        b = s.blips?.[i];
      const dx = b ? (b.x - x) * ppm + HALF : 0,
        dy = b ? (b.z - z) * ppm + HALF : 0;
      const visible =
        !!b && dx >= 9 && dx <= SIZE - 9 && dy >= 9 && dy <= SIZE - 9 && (b.fade ?? 1) > 0.01;
      if (node.visible !== visible) changed = true;
      node.visible = visible;
      if (!b || !visible) continue;
      changed = move(node, dx, dy) || changed;
      const rotation = ((b.heading ?? 0) * Math.PI) / 180,
        tint = b.kind === 'friend' ? 0x7ec4ff : 0xff4a3a,
        alpha = clamp01(b.fade ?? 1);
      if (node.rotation !== rotation || node.tint !== tint || node.alpha !== alpha) changed = true;
      node.rotation = rotation;
      node.tint = tint;
      node.alpha = alpha;
    }
    const objectives = s.objectives;
    for (let i = 0; i < Math.max(objectives?.length ?? 0, this.objectives.length); i++) {
      let entry = this.objectives[i];
      const objective = objectives?.[i];
      if (!entry && objective) {
        const node = new Container(),
          text = label('', 9.5, 0x06171f);
        node.addChild(
          new Graphics().rect(-6, -6, 12, 12).fill(0x79d2ff).stroke({ color: 0x040e14, width: 1 }),
          text
        );
        entry = { node, text };
        this.objectives.push(entry);
        this.viewport.addChild(node);
      }
      if (!entry) continue;
      if (entry.node.visible !== !!objective) changed = true;
      entry.node.visible = !!objective;
      if (!objective) continue;
      changed =
        move(
          entry.node,
          clamp((objective.x - x) * ppm + HALF, 7, SIZE - 7),
          clamp((objective.z - z) * ppm + HALF, 7, SIZE - 7)
        ) || changed;
      if (entry.text.text !== (objective.label ?? '')) {
        entry.text.text = objective.label ?? '';
        changed = true;
      }
    }
    const pulses = s.pulses;
    for (let i = 0; i < Math.max(pulses?.length ?? 0, this.pulses.length); i++) {
      let entry = this.pulses[i];
      const pulse = pulses?.[i];
      if (!entry && pulse) {
        const node = new Container(),
          ring = new Graphics(),
          text = label('', 13, 0xffd660);
        node.addChild(ring, text);
        entry = { node, ring, text, radius: -1 };
        this.pulses.push(entry);
        this.viewport.addChild(node);
      }
      if (!entry) continue;
      if (entry.node.visible !== !!pulse) changed = true;
      entry.node.visible = !!pulse;
      if (!pulse) continue;
      const radius = (pulse.radius ?? 12) * ppm;
      changed = move(entry.node, (pulse.x - x) * ppm + HALF, (pulse.z - z) * ppm + HALF) || changed;
      const alpha = 0.62 + 0.38 * Math.sin((s.pulseTime ?? 0) * 3.4);
      if (entry.node.alpha !== alpha) changed = true;
      entry.node.alpha = alpha;
      if (entry.radius !== radius) {
        changed = true;
        entry.radius = radius;
        entry.ring
          .clear()
          .circle(0, 0, radius)
          .fill({ color: 0xffa820, alpha: 0.13 })
          .stroke({ color: 0xffd660, alpha: 0.92, width: 1.5 });
        entry.text.y = -radius - 8;
      }
      const height = (pulse.y ?? 0) - (s.playerY ?? 0),
        text = Math.abs(height) > 2 ? (height > 0 ? '↑' : '↓') : '';
      if (entry.text.text !== text) {
        entry.text.text = text;
        changed = true;
      }
    }
    if (this.viewport.children.at(-1) !== this.player)
      this.viewport.setChildIndex(this.player, this.viewport.children.length - 1);
    return changed;
  }
}
