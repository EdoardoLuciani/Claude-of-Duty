/*
 * SURVIVAL GAME MODE — player score and wave progression.
 *
 * The game has one score: the local player's. Enemy eliminations are worth
 * 100 points, headshots add 50, and clearing a wave awards 250 points per wave.
 * AI owns spawning/progression; this system turns those events into durable
 * run state for the HUD and end-of-run screen.
 *
 * PUBLIC API — `const game = ctx.get('game')`
 *   game.score
 *   game.kills
 *   game.addScore(points, reason)
 *   game.getHudState() -> { score, kills, wave, enemiesRemaining,
 *                           waveTotal, waveIncoming, nextWaveIn }
 *
 * Events consumed: damage:dealt, wave:complete, game:restart.
 * Events emitted: score:change.
 */

export const SCORE = Object.freeze({
  elimination: 100,
  headshot: 50,
  wave: 250,
});

export class GameSystem {
  static id = 'game';
  static deps = ['ai'];

  async init(ctx) {
    this.ctx = ctx;
    this.ai = ctx.get('ai');
    this.score = 0;
    this.kills = 0;
    this._hud = {
      score: 0,
      kills: 0,
      wave: 0,
      enemiesRemaining: 0,
      waveTotal: 0,
      waveIncoming: false,
      nextWaveIn: 0,
    };

    this._off = [];
    const on = (type, fn) => this._off.push(ctx.events.on(type, fn));

    // AI handles damage first (the dependency guarantees listener order) and
    // marks the shared payload `killed` when this hit actually ended the actor.
    on('damage:dealt', (e) => {
      const target = e?.target;
      if (!e?.killed || !target || this._isPlayerTarget(target)) return;
      // Staged actors and the visual player corpse are not gameplay enemies.
      if (target.staged || target.silentDeath || target.friendly || target.team === 0) return;
      const points = SCORE.elimination + (e.headshot ? SCORE.headshot : 0);
      this.kills++;
      this.addScore(points, e.headshot ? 'headshot' : 'elimination');
    });

    on('wave:complete', (e) => {
      const wave = Math.max(1, e?.wave | 0);
      const points = wave * SCORE.wave;
      this.addScore(points, 'wave');
    });

    on('game:restart', () => this.reset());
  }

  _isPlayerTarget(target) {
    return target === 'player' || target === this.ctx.peek('player') || target.isPlayer === true;
  }

  addScore(points, reason = 'bonus') {
    const delta = Math.max(0, Math.round(Number(points) || 0));
    if (!delta) return this.score;
    this.score += delta;
    this.ctx.events.emit('score:change', {
      score: this.score,
      delta,
      reason,
      kills: this.kills,
    });
    return this.score;
  }

  reset() {
    this.score = 0;
    this.kills = 0;
    this.ctx.events.emit('score:change', {
      score: 0,
      delta: 0,
      reason: 'restart',
      kills: 0,
    });
  }

  /** Stable, allocation-free snapshot polled by the HUD. */
  getHudState() {
    const wave = this.ai.getWaveState?.();
    const out = this._hud;
    out.score = this.score;
    out.kills = this.kills;
    out.wave = wave?.number ?? 0;
    out.enemiesRemaining = wave?.remaining ?? 0;
    out.waveTotal = wave?.total ?? 0;
    out.waveIncoming = wave?.incoming ?? false;
    out.nextWaveIn = wave?.nextIn ?? 0;
    return out;
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
  }
}
