/**
 * Player-activated bandage: inventory, hold-to-heal timer, cancel/complete.
 * Gameplay is authoritative — the viewmodel follows progress and never heals.
 */

import type { Health } from './health.ts';
import { HEALING } from './tuning.ts';

interface HealInput {
  frozen?: boolean;
  enabled?: boolean;
  fire?: boolean;
  firePressed?: boolean;
  ads?: boolean;
  wheel?: number;
  action(name: string): boolean;
  actionPressed?(name: string): boolean;
  pressed?(key: string): boolean;
}

interface HealWeapons {
  beginHeal?(): boolean;
  endHeal?(): void;
  setHealProgress?(progress: number): void;
}

interface HealAudio {
  playUi?(id: string, gain: number): void;
}

interface HealPayload {
  phase: 'start' | 'cancel' | 'complete';
  amount: number;
  health: number;
  bandages: number;
  reason: string;
}

interface HealContext {
  input?: HealInput | null;
  peek(id: 'weapons'): HealWeapons | null | undefined;
  peek(id: 'audio'): HealAudio | null | undefined;
  events: { emit(type: 'player:heal', payload: HealPayload): void };
}

interface HealPlayer {
  health: Health;
  controlEnabled: boolean;
  ctx: HealContext;
  sprinting?: boolean;
  tacticalSprint?: boolean;
  sliding?: boolean;
  mantling?: boolean;
  airborne?: boolean;
  movement?: { jumped?: boolean };
}

interface HealHudState {
  bandages: number;
  healing: boolean;
  healProgress: number;
}

export class HealController {
  declare player: HealPlayer;
  declare bandages: number;
  declare active: boolean;
  declare progress: number;
  declare elapsed: number;
  declare _payload: HealPayload;

  constructor(player: HealPlayer) {
    this.player = player;
    this.bandages = HEALING.startCount;
    this.active = false;
    this.progress = 0;
    this.elapsed = 0;
    this._payload = {
      phase: 'start', amount: 0, health: 0, bandages: HEALING.startCount, reason: '',
    };
  }

  reset(): void {
    this.cancel('reset');
    this.bandages = HEALING.startCount;
  }

  /** @returns {number} bandages actually added */
  add(n: number): number {
    const want = Math.max(0, Math.floor(n));
    if (want <= 0) return 0;
    const before = this.bandages;
    this.bandages = Math.min(HEALING.maxCount, this.bandages + want);
    return this.bandages - before;
  }

  fillHud(h: HealHudState): void {
    h.bandages = this.bandages;
    h.healing = this.active;
    h.healProgress = this.active ? this.progress : 0;
  }

  canStart(): boolean {
    const p = this.player;
    const hp = p.health;
    if (this.active || !p.controlEnabled || hp.dead) return false;
    if (hp.value >= hp.max - 0.01 || this.bandages <= 0) return false;
    return !this._motionCancel();
  }

  tryStart(): boolean {
    if (!this.canStart()) {
      this._sfx('market_deny', 0.7);
      return false;
    }
    const wp = this.player.ctx.peek('weapons');
    if (wp?.beginHeal && !wp.beginHeal()) {
      this._sfx('market_deny', 0.7);
      return false;
    }
    this.active = true;
    this.progress = 0;
    this.elapsed = 0;
    this._emit('start');
    return true;
  }

  cancel(reason = 'cancel'): boolean {
    if (!this.active) return false;
    this._stop();
    this.player.ctx.peek('weapons')?.endHeal?.();
    this._emit('cancel', 0, reason);
    return true;
  }

  complete(): boolean {
    if (!this.active) return false;
    const hp = this.player.health;
    if (hp.dead) {
      this.cancel('dead');
      return false;
    }
    const applied = hp.heal(HEALING.amount);
    this.bandages = Math.max(0, this.bandages - 1);
    this._stop();
    this.player.ctx.peek('weapons')?.endHeal?.();
    this._sfx('bandage', 0.9);
    this._emit('complete', applied, 'complete');
    return true;
  }

  update(dt: number): void {
    const p = this.player;
    const input = p.ctx.input;
    const live =
      p.controlEnabled &&
      !p.health.dead &&
      input != null &&
      !input.frozen &&
      input.enabled !== false;

    if (this.active) {
      if (!live) { this.cancel('interrupt'); return; }
      if (!input.action('heal')) { this.cancel('release'); return; }
      if (this._motionCancel()) { this.cancel('move'); return; }
      this.elapsed += dt;
      this.progress = Math.min(1, this.elapsed / HEALING.duration);
      p.ctx.peek('weapons')?.setHealProgress?.(this.progress);
      if (this.progress >= 1) {
        if (this._busyInput(input)) this.cancel('interrupt');
        else this.complete();
      }
      return;
    }

    if (live && input.actionPressed?.('heal')) this.tryStart();
  }

  _stop(): void {
    this.active = false;
    this.progress = 0;
    this.elapsed = 0;
  }

  _motionCancel(): boolean {
    const p = this.player;
    return !!(p.sprinting || p.tacticalSprint || p.sliding || p.mantling || p.airborne || p.movement?.jumped);
  }

  /** Combat/pause requests on this frame — player.update runs before weapons/ui. */
  _busyInput(input: HealInput): boolean {
    return !!(input.fire || input.firePressed || input.ads
      || input.actionPressed?.('reload')
      || input.actionPressed?.('grenade')
      || input.actionPressed?.('radio')
      || input.actionPressed?.('pause')
      || input.pressed?.('KeyI')
      || input.actionPressed?.('swapWeapon')
      || input.wheel);
  }

  _sfx(id: string, gain: number): void {
    this.player.ctx.peek('audio')?.playUi?.(id, gain);
  }

  _emit(phase: HealPayload['phase'], amount = 0, reason = ''): void {
    const p = this._payload;
    p.phase = phase;
    p.amount = amount;
    p.health = this.player.health.value;
    p.bandages = this.bandages;
    p.reason = reason;
    this.player.ctx.events.emit('player:heal', p);
  }
}
