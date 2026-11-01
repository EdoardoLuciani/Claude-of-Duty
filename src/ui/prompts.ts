import { bindingLabel } from '../core/bindings.ts';
import { ease, clamp01, damp } from './util.ts';

const USE_KEY = bindingLabel('use');
interface PromptData {
  key?: string;
  text?: string;
  sub?: string;
  progress?: number;
}

/** Interaction text and fade/progress state; ownership remains in UiSystem. */
export class Prompt {
  key = USE_KEY;
  text = 'INTERACT';
  sub = '';
  progress = 0;
  hasProgress = false;
  shown = 0;
  active = false;
  alpha = 0;
  y = 7;
  set(p: PromptData): void {
    this.active = true;
    this.key = p.key ?? USE_KEY;
    this.text = (p.text ?? 'INTERACT').toUpperCase();
    this.sub = (p.sub ?? '').toUpperCase();
    this.progress = p.progress ?? 0;
    this.hasProgress = p.progress !== undefined;
  }
  clear(): void {
    this.active = false;
  }
  update(dt: number): void {
    this.shown = damp(this.shown, this.active ? 1 : 0, 18, dt);
    this.alpha = Number(this.shown.toFixed(3));
    this.y = Number(((1 - ease.outCubic(this.shown)) * 7).toFixed(2));
  }
}

/** One announcement at a time; a new message replaces the previous one. */
export class Banner {
  title = '';
  sub = '';
  t = 1;
  life = 2.1;
  alpha = 0;
  scale = 1;
  show(title: string, sub: string, life = 2.1): void {
    this.title = (title ?? '').toUpperCase();
    this.sub = (sub ?? '').toUpperCase();
    this.life = life;
    this.t = 0;
  }
  clear(): void {
    this.t = 1;
  }
  update(dt: number): void {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.life);
    const u = this.t,
      inT = clamp01(u / (0.16 / this.life));
    this.alpha = Number(
      (u > 0.78 ? 1 - ease.inQuad((u - 0.78) / 0.22) : ease.outQuad(inT)).toFixed(3)
    );
    this.scale = Number((0.965 + 0.035 * ease.outBack(inT)).toFixed(4));
  }
}
