/**
 * Player-activated bandage: inventory, hold-to-heal timer, cancel/complete.
 * Gameplay is authoritative — the viewmodel follows progress and never heals.
 */

import { HEALING } from './tuning.js';

export class HealController {
  constructor(player) {
    this.player = player;
    this.bandages = HEALING.startCount;
    this.active = false;
    this.progress = 0;
    this.elapsed = 0;
    this._payload = {
      phase: 'start', amount: 0, health: 0, bandages: HEALING.startCount, reason: '',
    };
  }

  reset() {
    this.cancel('reset');
    this.bandages = HEALING.startCount;
  }

  /** @returns {number} bandages actually added */
  add(n) {
    const want = Math.max(0, Math.floor(n));
    if (want <= 0) return 0;
    const before = this.bandages;
    this.bandages = Math.min(HEALING.maxCount, this.bandages + want);
    return this.bandages - before;
  }

  fillHud(h) {
    h.bandages = this.bandages;
    h.healing = this.active;
    h.healProgress = this.active ? this.progress : 0;
  }

  canStart() {
    const p = this.player;
    const hp = p.health;
    if (this.active || !p.controlEnabled || hp.dead) return false;
    if (hp.value >= hp.max - 0.01 || this.bandages <= 0) return false;
    return !this._motionCancel();
  }

  tryStart() {
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

  cancel(reason = 'cancel') {
    if (!this.active) return false;
    this._stop();
    this.player.ctx.peek('weapons')?.endHeal?.();
    this._emit('cancel', 0, reason);
    return true;
  }

  complete() {
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
    this._sfx('regen', 0.9);
    this._emit('complete', applied, 'complete');
    return true;
  }

  update(dt) {
    const p = this.player;
    const input = p.ctx.input;
    const live =
      p.controlEnabled &&
      !p.health.dead &&
      input &&
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

  _stop() {
    this.active = false;
    this.progress = 0;
    this.elapsed = 0;
  }

  _motionCancel() {
    const p = this.player;
    return p.sprinting || p.tacticalSprint || p.sliding || p.mantling || p.airborne || !!p.movement?.jumped;
  }

  /** Combat/pause requests on this frame — player.update runs before weapons/ui. */
  _busyInput(input) {
    return input.fire || input.firePressed || input.ads
      || input.actionPressed?.('reload')
      || input.actionPressed?.('grenade')
      || input.actionPressed?.('radio')
      || input.actionPressed?.('pause')
      || input.pressed?.('KeyI')
      || input.actionPressed?.('swapWeapon')
      || input.wheel;
  }

  _sfx(id, gain) {
    this.player.ctx.peek('audio')?.playUi?.(id, gain);
  }

  _emit(phase, amount = 0, reason = '') {
    const p = this._payload;
    p.phase = phase;
    p.amount = amount;
    p.health = this.player.health.value;
    p.bandages = this.bandages;
    p.reason = reason;
    this.player.ctx.events.emit('player:heal', p);
  }
}
