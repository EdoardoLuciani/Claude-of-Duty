import { Container, FillGradient, Graphics, Text } from 'pixi.js';

import { CARD, PPD, STRIP_W } from './compass.ts';
import type { Compass } from './compass.ts';
import { clamp01 } from './util.ts';

const fade = (x: number): number => clamp01(Math.min(x, STRIP_W - x) / (STRIP_W * 0.16));

const xFor = (bearing: number, heading: number): number =>
  STRIP_W / 2 + (((bearing - heading + 540) % 360) - 180) * PPD;

/** Fixed tick/cardinal objects: no scrolling text rasterization or fullscreen mask. */
export class PixiCompass {
  readonly stage = new Container();
  readonly ticks: Graphics[] = [];
  readonly labels: { bearing: number; node: Text }[] = [];
  readonly pings: Graphics[] = [];
  private heading = NaN;
  private gradient = new FillGradient({
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: 'rgba(3,6,9,0)' },
      { offset: 0.2, color: 'rgba(3,6,9,0.45)' },
      { offset: 0.66, color: 'rgba(3,6,9,0.45)' },
      { offset: 0.88, color: 'rgba(3,6,9,0.2)' },
      { offset: 1, color: 'rgba(3,6,9,0)' },
    ],
  });

  constructor() {
    const scrim = new Graphics(),
      base = new Graphics();
    // Static horizontal feather, shared vertical gradient texture. No filter pass.
    for (let i = 0; i < 64; i++) {
      const x = ((i + 0.5) * STRIP_W) / 64;
      scrim.rect((i * STRIP_W) / 64, 0, STRIP_W / 64, 41).fill({
        fill: this.gradient,
        alpha: fade(x) * clamp01(Math.min(x, STRIP_W - x) / (STRIP_W * 0.2)),
      });
      base
        .rect((i * STRIP_W) / 64, 18, STRIP_W / 64, 1)
        .fill({ color: 0xffffff, alpha: 0.4 * fade(x) * (1 - Math.abs((2 * x) / STRIP_W - 1)) });
    }
    this.stage.addChild(scrim, base);
    for (let a = 0; a < 360; a += 5) {
      const major = a % 15 === 0;
      const tick = new Graphics()
        .rect(0, 19, major ? 1.5 : 1, major ? 7.5 : 4)
        .fill({ color: 0xffffff, alpha: major ? 0.95 : 0.7 })
        .stroke({ color: 0x04080b, alpha: 0.6, width: 1 });
      this.ticks.push(tick);
      this.stage.addChild(tick);
      if (CARD[a]) {
        const sub = CARD[a].length > 1;
        const node = new Text({
          text: CARD[a],
          style: {
            fontFamily: 'Arial',
            fontSize: sub ? 10 : 13.5,
            fontWeight: '700',
            fill: sub ? 0xe9f3f9 : 0xffffff,
            stroke: { color: 0x04080b, width: 2, join: 'round' },
          },
        });
        node.anchor.set(0.5, 0);
        node.y = sub ? 3.5 : 1;
        this.labels.push({ bearing: a, node });
        this.stage.addChild(node);
      }
    }
    for (let i = 0; i < 8; i++) {
      const ping = new Graphics()
        .rect(-2, 13, 4, 14)
        .fill({ color: 0xff3c28, alpha: 0.25 })
        .rect(-1, 14, 2, 12)
        .fill({ color: 0xff4a3a, alpha: 0.95 });
      ping.visible = false;
      this.pings.push(ping);
      this.stage.addChild(ping);
    }
    this.stage.addChild(new Graphics().poly([230.5, 12.5, 239.5, 12.5, 235, 18]).fill(0xffb02a));
  }

  update(model: Compass): boolean {
    let dirty = this.heading !== model.heading;
    if (dirty) {
      this.heading = model.heading;
      for (let i = 0; i < this.ticks.length; i++) {
        const node = this.ticks[i],
          x = xFor(i * 5, model.heading);
        node.x = x;
        node.visible = x >= 0 && x <= STRIP_W;
        node.alpha = fade(x);
      }
      for (const { bearing, node } of this.labels) {
        const x = xFor(bearing, model.heading);
        node.x = x;
        node.visible = x >= 0 && x <= STRIP_W;
        node.alpha = fade(x);
      }
    }
    for (let i = 0; i < this.pings.length; i++) {
      const node = this.pings[i],
        state = model.pings[i];
      const visible = model.pingPool.items[i].alive;
      const alpha = state.alpha * fade(STRIP_W / 2 + state.x);
      if (
        node.visible !== visible ||
        (visible && (node.x !== STRIP_W / 2 + state.x || node.alpha !== alpha))
      )
        dirty = true;
      node.visible = visible;
      node.x = STRIP_W / 2 + state.x;
      node.alpha = alpha;
    }
    return dirty;
  }

  dispose(): void {
    this.gradient.destroy();
  }
}
