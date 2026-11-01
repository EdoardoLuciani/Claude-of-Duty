import { Container, Graphics, Text } from 'pixi.js';

import type { ScoreBar } from './compass.ts';
import { KILLFEED_CAPACITY } from './killfeed.ts';
import type { Killfeed } from './killfeed.ts';
import type { MarketCountdown } from './market.ts';
import { HUD_TYPE } from './pixi-type.ts';
import type { Prompt, Banner } from './prompts.ts';
import { clamp01 } from './util.ts';

export interface FeedbackModels {
  prompt: Prompt;
  banner: Banner;
  scoreBar: ScoreBar;
  killfeed: Killfeed;
  marketCountdown: MarketCountdown;
}
interface FeedView {
  node: Container;
  back: Graphics;
  edge: Graphics;
  attacker: Text;
  victim: Text;
  head: Graphics;
  gun: Graphics;
  sequence: number;
  width: number;
}
const INK = 0xe7f2ef,
  MUTED = 0xa9bac5,
  AMBER = 0xffb02a;
function label(value = '', size: number = HUD_TYPE.label, color = INK): Text {
  return new Text({
    text: value,
    style: {
      fontFamily: 'Arial',
      fontSize: size,
      fontWeight: '600',
      fill: color,
      stroke: { color: 0x080c10, width: size >= 20 ? 2 : 1, join: 'round' },
    },
  });
}
function rect(color: number, alpha = 1): Graphics {
  return new Graphics().rect(0, 0, 1, 1).fill({ color, alpha });
}
function keybox(color = 0xffffff): Graphics {
  return new Graphics()
    .roundRect(0, 0, 22, 22, 2)
    .fill({ color: 0x080b0e, alpha: 0.6 })
    .stroke({ color, width: 1, alpha: 0.8 });
}
function write(node: Text, value: string): boolean {
  if (node.text === value) return false;
  node.text = value;
  return true;
}
function fit(node: Text, width: number): number {
  width = Math.max(1, width);
  node.scale.set(1);
  const natural = node.width;
  node.scale.set(Math.min(1, width / Math.max(1, natural)));
  return Math.min(width, natural);
}
function pose(
  node: Container,
  visible: boolean,
  alpha: number,
  x: number,
  y: number,
  scale = 1
): boolean {
  const changed =
    node.visible !== visible ||
    (visible && (node.alpha !== alpha || node.x !== x || node.y !== y || node.scale.x !== scale));
  node.visible = visible;
  if (visible) {
    node.alpha = alpha;
    node.position.set(x, y);
    node.scale.set(scale);
  }
  return changed;
}
function rifle(): Graphics {
  return new Graphics()
    .poly([0.5, 4.2, 6, 4.2, 6, 8, 2.2, 8])
    .rect(6, 3.6, 8.2, 3.4)
    .rect(14.2, 4.2, 6.4, 2.1)
    .rect(20.6, 4.6, 6.9, 1.2)
    .rect(23.6, 2.6, 1.1, 2)
    .poly([9, 7, 12.6, 7, 11.9, 11, 9.7, 11])
    .poly([13, 7, 15, 7, 14.1, 10.2, 12.5, 10.2])
    .fill(0xf0f6fa);
}
function skull(): Graphics {
  return new Graphics()
    .circle(5.5, 4.8, 4.1)
    .rect(3, 7, 5, 2.1)
    .rect(3.4, 9.2, 1.4, 1.5)
    .rect(6.2, 9.2, 1.4, 1.5)
    .fill(0xffc247)
    .circle(3.9, 4.6, 1.15)
    .circle(7.1, 4.6, 1.15)
    .rect(5.05, 6.1, 0.9, 1.3)
    .fill(0x0a0c0e);
}

/** Passive messages share the HUD renderer, fade group and existing model clocks. */
export class PixiFeedback {
  readonly stage = new Container();
  readonly prompt = new Container();
  readonly banner = new Container();
  readonly countdown = new Container();
  readonly score = new Container();
  private key = label();
  private keyFrame = keybox();
  private verb = label();
  private sub = label('', HUD_TYPE.label, MUTED);
  private progressTrack = rect(0xffffff, 0.16);
  private progressFill = rect(AMBER);
  private title = label('', HUD_TYPE.value);
  private subtitle = label('', HUD_TYPE.label, AMBER);
  private bannerBack = rect(0x04070a, 0.6);
  private rule = rect(0xffffff, 0.5);
  private seconds = label('', HUD_TYPE.label, AMBER);
  private countLabel = label('SUPPLY MARKET IN');
  private countTrack = rect(0xffffff, 0.16);
  private countFill = rect(AMBER);
  private scoreLabel = label('SCORE', HUD_TYPE.label, MUTED);
  private scoreValue = label('', HUD_TYPE.secondary, AMBER);
  private waveLabel = label('WAVE', HUD_TYPE.label, MUTED);
  private waveValue = label('', HUD_TYPE.secondary);
  private creditLabel = label('CREDITS', HUD_TYPE.label, MUTED);
  private creditValue = label('', HUD_TYPE.secondary);
  private status = label('', HUD_TYPE.label, MUTED);
  readonly rows = Array.from({ length: KILLFEED_CAPACITY }, (): FeedView => {
    const node = new Container(),
      back = rect(0xffffff),
      edge = rect(0xffffff),
      attacker = label('', HUD_TYPE.label, 0xffffff),
      victim = label('', HUD_TYPE.label, 0xffffff),
      head = skull(),
      gun = rifle();
    gun.scale.set(31 / 28, 12 / 11);
    head.scale.set(12 / 11);
    node.addChild(back, edge, attacker, head, gun, victim);
    node.visible = false;
    return { node, back, edge, attacker, victim, head, gun, sequence: -1, width: 0 };
  });
  private width = 1920;
  private height = 1080;
  private feedTop = 34;
  private cssPixel = 1;
  private layoutDirty = true;
  private promptWidth = 0;
  private scoreWidth = 1;

  constructor() {
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.stage.addChild(this.score, this.countdown, this.banner, this.prompt);
    for (const row of this.rows) this.stage.addChild(row.node);
    this.prompt.addChild(
      this.keyFrame,
      this.key,
      this.verb,
      this.sub,
      this.progressTrack,
      this.progressFill
    );
    this.key.anchor.set(0.5);
    this.key.position.set(11, 11);
    this.banner.addChild(this.bannerBack, this.title, this.subtitle, this.rule);
    this.title.anchor.set(0.5, 0);
    this.subtitle.anchor.set(0.5, 0);
    this.title.y = -32;
    this.subtitle.y = 12;
    this.rule.position.set(-60, 34);
    this.rule.scale.set(120, 1);
    this.countdown.addChild(
      keybox(AMBER),
      this.seconds,
      this.countLabel,
      this.countTrack,
      this.countFill
    );
    this.seconds.anchor.set(0.5);
    this.seconds.position.set(11, 11);
    this.countLabel.position.set(30, 0);
    this.countTrack.position.set(30, 20);
    this.countTrack.scale.set(150, 2);
    this.countFill.position.set(30, 20);
    this.countFill.scale.y = 2;
    this.countdown.pivot.x = 90;
    this.score.addChild(
      this.scoreLabel,
      this.scoreValue,
      this.waveLabel,
      this.waveValue,
      this.creditLabel,
      this.creditValue,
      this.status
    );
    this.scoreLabel.y = this.waveLabel.y = this.creditLabel.y = this.status.y = 4;
  }
  resize(w: number, h: number, k: number): void {
    this.width = w / k;
    this.height = h / k;
    this.feedTop = Math.max(24 / k, 34);
    this.cssPixel = 1 / k;
    this.layoutDirty = true;
  }

  update(models: FeedbackModels): boolean {
    let dirty = this.layoutDirty;
    const p = models.prompt,
      b = models.banner,
      c = models.marketCountdown,
      s = models.scoreBar;
    let promptLayout = write(this.key, p.key);
    promptLayout = write(this.verb, p.text) || promptLayout;
    promptLayout = write(this.sub, p.sub) || promptLayout;
    if (promptLayout || this.layoutDirty) {
      const keyWidth = Math.max(22, this.key.width + 10);
      this.keyFrame
        .clear()
        .roundRect(0, 0, keyWidth, 22, 2)
        .fill({ color: 0x080b0e, alpha: 0.6 })
        .stroke({ color: 0xffffff, width: 1, alpha: 0.8 });
      this.key.x = keyWidth / 2;
      this.verb.position.set(keyWidth + 8, 0);
      this.sub.position.set(keyWidth + 8, 16);
      this.promptWidth = Math.max(
        fit(this.verb, this.width - 130),
        fit(this.sub, this.width - 130)
      );
      this.progressTrack.position.set(keyWidth + 8, p.sub ? 34 : 20);
      this.progressTrack.scale.set(this.promptWidth, 1.5);
      this.progressFill.position.copyFrom(this.progressTrack.position);
      this.progressFill.scale.y = 1.5;
      this.prompt.pivot.x = (keyWidth + 8 + this.promptWidth) / 2;
      dirty = true;
    }
    const height = p.sub ? 32 : 22,
      fraction = Number(clamp01(p.progress).toFixed(3));
    if (
      this.sub.visible !== !!p.sub ||
      this.progressTrack.visible !== p.hasProgress ||
      this.progressFill.scale.x !== this.promptWidth * fraction
    )
      dirty = true;
    this.sub.visible = !!p.sub;
    this.progressTrack.visible = this.progressFill.visible = p.hasProgress;
    this.progressFill.scale.x = this.promptWidth * fraction;
    this.prompt.pivot.y = (height + (p.hasProgress ? 6 : 0)) / 2;
    dirty =
      pose(
        this.prompt,
        p.shown >= 0.005,
        p.alpha,
        this.width / 2,
        this.height * 0.58 + p.y * this.cssPixel
      ) || dirty;

    let bannerLayout = write(this.title, b.title);
    bannerLayout = write(this.subtitle, b.sub) || bannerLayout;
    if (bannerLayout || this.layoutDirty) {
      const width = Math.max(
        fit(this.title, this.width - 100),
        fit(this.subtitle, this.width - 100)
      );
      const panelWidth = Math.max(1, Math.min(this.width - 52, width + 160));
      this.bannerBack.position.set(-panelWidth / 2, -42);
      this.bannerBack.scale.set(panelWidth, 90);
      dirty = true;
    }
    this.subtitle.visible = !!b.sub;
    dirty =
      pose(this.banner, b.t < 1, b.alpha, this.width / 2, this.height * 0.31, b.scale) || dirty;

    dirty = write(this.seconds, c.value) || dirty;
    if (this.countFill.scale.x !== 150 * c.fraction) dirty = true;
    this.countFill.scale.x = 150 * c.fraction;
    dirty =
      pose(this.countdown, c.shown >= 0.005, Number(c.shown.toFixed(3)), this.width / 2, 92.2) ||
      dirty;

    let scoreLayout = write(this.scoreValue, s.score);
    scoreLayout = write(this.waveValue, s.wave) || scoreLayout;
    scoreLayout = write(this.creditValue, s.credits) || scoreLayout;
    scoreLayout = write(this.status, s.status) || scoreLayout;
    if (scoreLayout || this.layoutDirty) {
      this.scoreLabel.x = 0;
      this.scoreValue.x = this.scoreLabel.width + 5;
      this.waveLabel.x = this.scoreValue.x + this.scoreValue.width + 16;
      this.waveValue.x = this.waveLabel.x + this.waveLabel.width + 5;
      this.creditLabel.x = this.waveValue.x + this.waveValue.width + 16;
      this.creditValue.x = this.creditLabel.x + this.creditLabel.width + 5;
      this.status.x = this.creditValue.x + this.creditValue.width + 16;
      this.scoreWidth = this.status.x + Math.max(88, this.status.width);
      this.score.pivot.x = this.scoreWidth / 2;
      dirty = true;
    }
    dirty =
      pose(
        this.score,
        true,
        1,
        this.width / 2,
        63.2,
        Math.min(1, Math.max(1, this.width - 52) / this.scoreWidth)
      ) || dirty;

    const feed = models.killfeed;
    for (let i = 0; i < this.rows.length; i++) {
      const slot = this.rows[i],
        entry = feed.rows[i],
        alive = feed.pool.items[i].alive;
      if (alive && (slot.sequence !== entry.sequence || this.layoutDirty)) {
        write(slot.attacker, entry.attacker);
        write(slot.victim, entry.victim);
        slot.attacker.tint = entry.attackerFriendly ? (entry.mine ? 0xffffff : 0x8fc8ff) : 0xff7a63;
        slot.victim.tint = entry.attackerFriendly ? 0xff7a63 : 0x8fc8ff;
        slot.head.visible = entry.headshot;
        slot.attacker.position.set(6, 3);
        let x = 6 + fit(slot.attacker, 140) + 6;
        slot.head.position.set(x, 5);
        if (entry.headshot) x += 18;
        slot.gun.position.set(x, 5);
        x += 37;
        slot.victim.position.set(x, 3);
        slot.width = x + fit(slot.victim, 140) + 6;
        slot.back.scale.set(slot.width, 22);
        slot.back.tint = entry.mine ? 0x1a1103 : 0x05090c;
        slot.back.alpha = entry.mine ? 0.66 : 0.58;
        slot.edge.position.set(slot.width - 2, 0);
        slot.edge.scale.set(2, 22);
        slot.edge.tint = entry.mine ? AMBER : 0xffffff;
        slot.edge.alpha = entry.mine ? 1 : 0.18;
        slot.sequence = entry.sequence;
        dirty = true;
      }
      let rank = 0;
      if (alive)
        for (let j = 0; j < feed.rows.length; j++)
          if (feed.pool.items[j].alive && feed.rows[j].sequence > entry.sequence) rank++;
      dirty =
        pose(
          slot.node,
          alive,
          entry.alpha,
          this.width - 26 - slot.width + entry.x * this.cssPixel,
          this.feedTop + rank * 26
        ) || dirty;
    }
    this.layoutDirty = false;
    return dirty;
  }
}
