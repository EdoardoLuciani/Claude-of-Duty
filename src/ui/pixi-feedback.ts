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
  rifle: Graphics;
  skull: Graphics;
  sequence: number;
  width: number;
}
const INK = 0xe7f2ef,
  MUTED = 0xa9bac5,
  AMBER = 0xffb02a;
function label(value = '', size: number = HUD_TYPE.label, color = INK, x = 0, y = 0): Text {
  const node = new Text({
    text: value,
    style: {
      fontFamily: 'Arial',
      fontSize: size,
      fontWeight: '600',
      fill: color,
      stroke: { color: 0x080c10, width: size >= 20 ? 2 : 1, join: 'round' },
    },
  });
  node.position.set(x, y);
  return node;
}
function rect(color: number, alpha = 1): Graphics {
  return new Graphics().rect(0, 0, 1, 1).fill({ color, alpha });
}
function rifle(): Graphics {
  return new Graphics()
    .poly([
      0, 4, 6, 4, 6, 3, 14, 3, 14, 4, 28, 4, 28, 6, 16, 6, 14.5, 10, 12.5, 10, 13, 7, 12, 7, 11, 11,
      9, 11, 8, 7, 6, 7, 6, 8, 2, 8,
    ])
    .rect(23, 2, 1, 2)
    .fill(INK);
}
function skull(): Graphics {
  return new Graphics()
    .roundRect(1, 0, 10, 9, 4)
    .rect(3, 7, 6, 5)
    .fill(AMBER)
    .circle(3.8, 4.5, 1.2)
    .circle(8.2, 4.5, 1.2)
    .rect(5.5, 6, 1, 1.5)
    .rect(4.5, 10, 1, 2)
    .rect(6.5, 10, 1, 2)
    .fill(0x080c10);
}
function fit(node: Text, width: number): void {
  node.scale.set(1);
  node.scale.set(Math.min(1, Math.max(1, width) / Math.max(1, node.width)));
}
function write(node: Text, value: string, width = 0): boolean {
  if (node.text === value) return false;
  node.text = value;
  if (width) fit(node, width);
  return true;
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

/** Plain text, bars and backings; all timing/pooling stays in the controllers. */
export class PixiFeedback {
  readonly stage = new Container();
  readonly prompt = new Container();
  readonly banner = new Container();
  readonly countdown = new Container();
  readonly score = new Container();
  private key = label('', HUD_TYPE.label, INK, -88, 0);
  private verb = label('', HUD_TYPE.label, INK, -72, 0);
  private sub = label('', HUD_TYPE.label, MUTED);
  private progressTrack = rect(0xffffff, 0.16);
  private progressFill = rect(AMBER);
  private title = label('', HUD_TYPE.value);
  private subtitle = label('', HUD_TYPE.label, AMBER);
  private bannerBack = rect(0x04070a, 0.6);
  private seconds = label('', HUD_TYPE.label, AMBER, 132, 0);
  private countLabel = label('SUPPLY MARKET IN');
  private countTrack = rect(0xffffff, 0.16);
  private countFill = rect(AMBER);
  private scoreValue = label('', HUD_TYPE.secondary, AMBER, 50, 0);
  private waveValue = label('', HUD_TYPE.secondary, INK, 174, 0);
  private creditValue = label('', HUD_TYPE.secondary, INK, 276, 0);
  private status = label('', HUD_TYPE.label, MUTED, 368, 4);
  readonly rows = Array.from({ length: KILLFEED_CAPACITY }, (): FeedView => {
    const node = new Container(),
      back = rect(0xffffff),
      edge = rect(0xffffff),
      attacker = label('', HUD_TYPE.label, 0xffffff, 6, 3),
      victim = label('', HUD_TYPE.label, 0xffffff, 0, 3),
      gun = rifle(),
      head = skull();
    gun.scale.x = 31 / 28;
    node.addChild(back, edge, attacker, head, gun, victim);
    node.visible = false;
    return { node, back, edge, attacker, victim, rifle: gun, skull: head, sequence: -1, width: 0 };
  });
  private width = 1920;
  private height = 1080;
  private feedTop = 34;
  private cssPixel = 1;
  private layoutDirty = true;
  private promptKey = '';
  private countdownValue = '';
  constructor() {
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    this.stage.addChild(this.score, this.countdown, this.banner, this.prompt);
    for (const row of this.rows) this.stage.addChild(row.node);
    this.prompt.addChild(this.key, this.verb, this.sub, this.progressTrack, this.progressFill);
    this.key.anchor.set(1, 1);
    this.verb.anchor.y = 1;
    this.sub.position.set(-72, 4);
    this.progressTrack.position.set(-72, 24);
    this.progressTrack.scale.set(160, 1.5);
    this.progressFill.x = -72;
    this.progressFill.scale.y = 1.5;
    this.banner.addChild(this.bannerBack, this.title, this.subtitle);
    this.title.anchor.set(0.5, 0);
    this.subtitle.anchor.set(0.5, 0);
    this.title.y = -32;
    this.subtitle.y = 12;
    this.countdown.addChild(this.seconds, this.countLabel, this.countTrack, this.countFill);
    this.countTrack.y = this.countFill.y = 20;
    this.countTrack.scale.set(150, 2);
    this.countFill.scale.y = 2;
    this.countdown.pivot.x = 76;
    this.score.addChild(
      label('SCORE', HUD_TYPE.label, MUTED, 0, 4),
      this.scoreValue,
      label('WAVE', HUD_TYPE.label, MUTED, 128, 4),
      this.waveValue,
      label('CREDITS', HUD_TYPE.label, MUTED, 212, 4),
      this.creditValue,
      this.status
    );
    this.score.pivot.x = 264;
  }
  resize(w: number, h: number, k: number): void {
    this.width = w / k;
    this.height = h / k;
    this.feedTop = Math.max(24 / k, 34);
    this.cssPixel = 1 / k;
    this.layoutDirty = true;
    const width = Math.max(1, Math.min(480, this.width - 52));
    this.bannerBack.position.set(-width / 2, -42);
    this.bannerBack.scale.set(width, 90);
  }
  update(models: FeedbackModels): boolean {
    let dirty = this.layoutDirty;
    const p = models.prompt,
      b = models.banner,
      c = models.marketCountdown,
      s = models.scoreBar;
    if (this.promptKey !== p.key) {
      write(this.key, `[${p.key}]`, 58);
      this.promptKey = p.key;
      dirty = true;
    }
    let promptLayout = write(this.verb, p.text);
    promptLayout = write(this.sub, p.sub) || promptLayout;
    if (promptLayout || this.layoutDirty) {
      const width = Math.min(280, this.width / 2 + 46);
      fit(this.verb, width);
      fit(this.sub, width);
      dirty = true;
    }
    const fraction = Number(clamp01(p.progress).toFixed(3));
    if (
      this.progressTrack.visible !== p.hasProgress ||
      this.progressFill.scale.x !== 160 * fraction
    )
      dirty = true;
    this.progressTrack.visible = this.progressFill.visible = p.hasProgress;
    this.progressFill.scale.x = 160 * fraction;
    this.progressTrack.y = this.progressFill.y = p.sub ? 24 : 8;
    dirty =
      pose(
        this.prompt,
        p.shown >= 0.005,
        p.alpha,
        this.width / 2,
        this.height * 0.58 + p.y * this.cssPixel
      ) || dirty;

    const bannerLayout = write(this.title, b.title);
    const subLayout = write(this.subtitle, b.sub);
    if (bannerLayout || subLayout || this.layoutDirty) {
      fit(this.title, Math.min(440, this.width - 100));
      fit(this.subtitle, Math.min(440, this.width - 100));
      dirty = true;
    }
    dirty =
      pose(this.banner, b.t < 1, b.alpha, this.width / 2, this.height * 0.31, b.scale) || dirty;
    if (this.countdownValue !== c.value) {
      this.seconds.text = c.value + 's';
      this.countdownValue = c.value;
      dirty = true;
    }
    if (this.countFill.scale.x !== 150 * c.fraction) dirty = true;
    this.countFill.scale.x = 150 * c.fraction;
    dirty =
      pose(this.countdown, c.shown >= 0.005, Number(c.shown.toFixed(3)), this.width / 2, 92.2) ||
      dirty;
    dirty = write(this.scoreValue, s.score, 74) || dirty;
    dirty = write(this.waveValue, s.wave, 24) || dirty;
    dirty = write(this.creditValue, s.credits, 74) || dirty;
    dirty = write(this.status, s.status, 160) || dirty;
    dirty =
      pose(
        this.score,
        true,
        1,
        this.width / 2,
        63.2,
        Math.min(1, Math.max(1, this.width - 52) / 528)
      ) || dirty;

    const feed = models.killfeed;
    for (let i = 0; i < this.rows.length; i++) {
      const slot = this.rows[i],
        entry = feed.rows[i],
        alive = feed.pool.items[i].alive;
      if (alive && (slot.sequence !== entry.sequence || this.layoutDirty)) {
        write(slot.attacker, entry.attacker, 140);
        write(slot.victim, entry.victim, 140);
        slot.attacker.tint = entry.attackerFriendly ? (entry.mine ? 0xffffff : 0x8fc8ff) : 0xff7a63;
        slot.victim.tint = entry.attackerFriendly ? 0xff7a63 : 0x8fc8ff;
        slot.skull.visible = entry.headshot;
        slot.skull.position.set(slot.attacker.x + slot.attacker.width + 6, 5);
        slot.rifle.position.set(slot.skull.x + (entry.headshot ? 18 : 0), 5);
        slot.victim.x = slot.rifle.x + 37;
        slot.width = slot.victim.x + slot.victim.width + 6;
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
