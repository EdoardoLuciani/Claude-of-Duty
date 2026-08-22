const PLAYER_HZ = 10;
const ENEMY_HZ = 5;
const ACTIONS = [
  'forward', 'back', 'left', 'right', 'jump', 'crouch', 'prone', 'sprint',
  'reload', 'use', 'melee', 'leanLeft', 'leanRight', 'swapWeapon', 'grenade', 'radio',
];
const EVENTS = [
  'weapon:fire', 'weapon:reload', 'shot:resolved', 'bullet:impact',
  'damage:dealt', 'damage:taken', 'actor:death', 'ai:bark',
  'wave:start', 'wave:complete', 'score:change',
  'market:open', 'market:close', 'ammo:pickup',
  'player:state', 'player:jump', 'player:mantle', 'player:land',
  'player:footstep', 'player:death', 'player:respawn',
  'hud:heard', 'radio:strike', 'explosion', 'game:restart',
];

const n3 = (n) => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
const vec = (v) => v && Number.isFinite(v.x)
  ? [n3(v.x), n3(v.y), n3(v.z)]
  : null;
const weaponId = (w) => typeof w === 'string' ? w : w?.id ?? w?.label ?? w?.name ?? null;

function entityId(v) {
  if (!v) return null;
  if (v === 'player' || v.isPlayer === true) return 'player';
  if (Number.isFinite(v.id)) return `ai:${v.id}`;
  return v.name ?? null;
}

/**
 * Opt-in local gameplay recorder. Loaded only for `?telemetry=1` and started
 * after shader pre-warm, so ordinary play and capture runs pay no cost.
 */
export class TelemetrySystem {
  static id = 'telemetry';
  static deps = ['ui', 'audio'];

  async init(ctx) {
    this.ctx = ctx;
    this.recording = false;
    this.exported = false;
    this.playerSamples = [];
    this.enemySamples = [];
    this.events = [];
    this.markers = [];
    this._off = [];
    this._enemyState = new Map();
    this._contacts = new Map();
    this._move = { x: 0, y: 0 };
    this._maxAlive = 0;
    this._lastBadgeAt = -Infinity;

    for (const type of EVENTS) {
      this._off.push(ctx.events.on(type, (e) => this._recordEvent(type, e)));
    }

    this.badge = document.createElement('div');
    this.badge.textContent = 'TELEMETRY ARMED';
    Object.assign(this.badge.style, {
      position: 'fixed', left: '50%', bottom: '8px', zIndex: '100000',
      transform: 'translateX(-50%)',
      padding: '6px 9px', color: '#d7f7ff', background: 'rgba(2,8,12,.82)',
      border: '1px solid rgba(90,210,255,.55)', borderRadius: '3px',
      font: '600 10px/1.2 ui-monospace,monospace', letterSpacing: '.08em',
      pointerEvents: 'none', userSelect: 'none',
    });
    document.body.appendChild(this.badge);

    this._onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'F7') {
        e.preventDefault();
        this.mark();
      } else if (e.code === 'F8') {
        e.preventDefault();
        this.download();
      }
    };
    this._onBeforeUnload = (e) => {
      if (this.exported || (!this.events.length && !this.playerSamples.length)) return;
      e.preventDefault();
      e.returnValue = '';
    };
    addEventListener('keydown', this._onKey, true);
    addEventListener('beforeunload', this._onBeforeUnload);

    const api = {
      start: () => this.start(),
      stop: () => this.stop(),
      mark: (label) => this.mark(label),
      download: () => this.download(),
      snapshot: () => this.snapshot(),
      summary: () => this.summary(),
    };
    this.api = api;
    window.__TELEMETRY__ = api;
  }

  start() {
    const t = this.ctx.time;
    this.playerSamples.length = 0;
    this.enemySamples.length = 0;
    this.events.length = 0;
    this.markers.length = 0;
    this._enemyState.clear();
    this._contacts.clear();
    this._maxAlive = 0;
    this._startElapsed = t.elapsed;
    this._startRaw = t.raw;
    this._stopElapsed = null;
    this._stopRaw = null;
    this._nextPlayerRaw = 0;
    this._nextEnemyRaw = 0;
    this._lastBadgeAt = -Infinity;
    this.recording = true;
    this.exported = false;
    this.meta = {
      schema: 1,
      startedAt: new Date().toISOString(),
      quality: this.ctx.config.quality,
      deterministic: !!this.ctx.config.deterministic,
      viewport: [innerWidth, innerHeight],
      userAgent: navigator.userAgent,
      playerHz: PLAYER_HZ,
      enemyHz: ENEMY_HZ,
      path: location.pathname,
    };
    this._push('session:start', { quality: this.ctx.config.quality });
    this._updateBadge(true);
    return { recording: true, startedAt: this.meta.startedAt };
  }

  stop() {
    if (!this.recording) return this.summary();
    this._push('session:stop', {});
    this._stopElapsed = this.ctx.time.elapsed;
    this._stopRaw = this.ctx.time.raw;
    this.recording = false;
    this._updateBadge(true);
    return this.summary();
  }

  mark(label = 'manual') {
    if (!this.recording) return null;
    const m = {
      t: this._time(), raw: this._rawTime(), frame: this.ctx.time.frame,
      label: String(label || 'manual').slice(0, 80),
      player: vec(this.ctx.get('player').position),
    };
    this.markers.push(m);
    this._push('marker', { label: m.label, player: m.player });
    this.badge.textContent = `MARK ${this.markers.length} SAVED · F8 EXPORT`;
    return m;
  }

  lateUpdate() {
    if (!this.recording) return;
    const raw = this._rawTime();
    if (raw >= this._nextPlayerRaw) {
      this._samplePlayer();
      this._nextPlayerRaw = raw + 1 / PLAYER_HZ;
    }
    if (raw >= this._nextEnemyRaw) {
      this._sampleEnemies();
      this._nextEnemyRaw = raw + 1 / ENEMY_HZ;
    }
    this._updateBadge();
  }

  _time() {
    const now = this._stopElapsed ?? this.ctx.time.elapsed;
    return n3(now - (this._startElapsed ?? now));
  }

  _rawTime() {
    const now = this._stopRaw ?? this.ctx.time.raw;
    return n3(now - (this._startRaw ?? now));
  }

  _push(type, data) {
    if (!this.recording) return;
    this.events.push({
      t: this._time(), raw: this._rawTime(), frame: this.ctx.time.frame, type, ...data,
    });
  }

  _recordEvent(type, e = {}) {
    if (!this.recording) return;
    let data;
    switch (type) {
      case 'weapon:fire':
        data = {
          shooter: entityId(e.actor), weapon: weaponId(e.weapon),
          origin: vec(e.origin), dir: vec(e.dir), seed: e.seed ?? null,
        };
        break;
      case 'shot:resolved':
        data = {
          shooter: entityId(e.shooter), weapon: weaponId(e.weapon),
          from: vec(e.from), to: vec(e.to), result: e.result ?? null,
          target: entityId(e.target), part: e.part ?? null,
          damage: n3(e.damage), pellet: e.pellet ?? 0,
        };
        break;
      case 'bullet:impact':
        data = {
          point: vec(e.point), normal: vec(e.normal), incident: vec(e.incident),
          surface: e.surface ?? null, damage: n3(e.damage), exit: !!e.exit,
          target: entityId(e.actor), part: e.part ?? null,
        };
        break;
      case 'weapon:reload':
        data = { actor: entityId(e.actor) ?? 'player', weapon: weaponId(e.weapon), phase: e.phase ?? null };
        break;
      case 'damage:dealt':
        data = {
          target: entityId(e.target), source: entityId(e.source), amount: n3(e.amount),
          point: vec(e.point), headshot: !!e.headshot, killed: !!e.killed,
          explosion: !!e.explosion,
        };
        break;
      case 'damage:taken':
        data = {
          amount: n3(e.amount), health: n3(e.health), armour: n3(e.armour),
          absorbed: n3(e.armourAbsorbed), plateBreak: !!e.plateBreak, from: vec(e.from),
        };
        break;
      case 'actor:death':
        data = { actor: entityId(e.actor), point: vec(e.point), impulse: vec(e.impulse) };
        break;
      case 'player:state':
        data = {
          state: e.state ?? null, stance: e.stance ?? null, sprinting: !!e.sprinting,
          tacticalSprint: !!e.tacticalSprint, sliding: !!e.sliding,
          mantling: !!e.mantling, grounded: !!e.grounded, ads: !!e.ads,
        };
        break;
      case 'player:footstep':
        data = {
          position: vec(e.position), surface: e.surface ?? null, running: !!e.running,
          speed: n3(e.speed), stance: e.stance ?? null,
        };
        break;
      case 'player:jump':
      case 'player:respawn':
      case 'ammo:pickup':
        data = { position: vec(e.position), amount: e.amount ?? null, weapon: weaponId(e.weapon) };
        break;
      case 'player:mantle':
        data = { kind: e.kind ?? null, height: n3(e.height) };
        break;
      case 'player:land':
        data = { position: vec(e.position), velocity: n3(e.velocity), surface: e.surface ?? null };
        break;
      case 'player:death':
        data = { position: vec(e.position), from: vec(e.from), amount: n3(e.amount) };
        break;
      case 'explosion':
        data = {
          position: vec(e.position), radius: n3(e.radius), damage: n3(e.damage),
          source: entityId(e.source),
        };
        break;
      case 'wave:start':
        data = { wave: e.wave ?? null, enemies: e.enemies ?? null, squads: e.squads ?? null };
        break;
      case 'wave:complete':
        data = { wave: e.wave ?? null, nextWave: e.nextWave ?? null, delay: n3(e.delay) };
        break;
      case 'score:change':
        data = { score: e.score ?? null, delta: e.delta ?? null, reason: e.reason ?? null, kills: e.kills ?? null };
        break;
      case 'market:open':
        data = { wave: e.wave ?? null };
        break;
      case 'market:close':
      case 'game:restart':
        data = { source: e.source ?? null };
        break;
      case 'hud:heard':
        data = { bearing: n3(e.bearing) };
        break;
      case 'radio:strike':
        data = { position: vec(e.position) };
        break;
      case 'ai:bark':
        data = { kind: e.kind ?? null, position: vec(e.position), actor: e.voice ? `ai:${e.voice}` : null };
        break;
      default:
        data = {};
        break;
    }
    this._push(type, data);
  }

  _samplePlayer() {
    const ctx = this.ctx;
    const p = ctx.get('player');
    const w = ctx.get('weapons');
    const ai = ctx.get('ai');
    const game = ctx.get('game');
    const market = ctx.get('market');
    const render = ctx.get('render');
    const hp = p.health;
    const ws = w.state;
    const input = ctx.input;
    const actions = [];
    for (const name of ACTIONS) if (input.action(name)) actions.push(name);
    if (input.fire) actions.push('fire');
    if (input.ads) actions.push('ads');
    input.moveVector(this._move);
    const wave = ai.getWaveState();
    const info = render.renderer.info;

    this.playerSamples.push({
      t: this._time(), raw: this._rawTime(), frame: ctx.time.frame,
      position: vec(p.feetPosition ?? p.position),
      eye: vec(ctx.camera.position), velocity: vec(p.velocity),
      yaw: n3(p.yaw ?? ctx.camera.rotation.y), pitch: n3(ctx.camera.rotation.x),
      fov: n3(ctx.camera.fov), state: p.state ?? null, stance: p.stance ?? null,
      grounded: p.grounded ?? null, sprinting: !!p.sprinting,
      tacticalSprint: !!p.tacticalSprint, sliding: !!p.sliding,
      mantling: !!p.mantling, health: n3(hp.value), armour: n3(hp.armour),
      suppression: n3(hp.suppression), dead: !!hp.dead,
      weapon: w.activeId ?? null, mode: ws?.mode ?? null,
      ammo: ws?.mag ?? null, reserve: ws?.reserve ?? null,
      reloading: !!w.reloading, ads: (w.adsProgress ?? 0) > 0.5,
      grenades: w.grenades ?? null, actions,
      move: [n3(this._move.x), n3(this._move.y)],
      look: [n3(input.look.x), n3(input.look.y)],
      wave: wave.number, remaining: wave.remaining, incoming: !!wave.incoming,
      score: game.score, kills: game.kills,
      marketOpen: !!market.open, credits: market.credits,
      contacts: this._contacts.size, dt: n3(ctx.time.dt), scale: n3(ctx.time.scale),
      renderCalls: info.render.calls, triangles: info.render.triangles,
    });
  }

  _sampleEnemies() {
    const ctx = this.ctx;
    const ai = ctx.get('ai');
    const agents = ai.agents;
    const contacts = new Map();
    for (const a of ai.getHudActors()) {
      const source = a.lastFired > a.lastSeen ? 'fire' : 'los';
      contacts.set(a.id, source);
      const previousSource = this._contacts.get(a.id);
      if (previousSource === source) continue;
      if (previousSource) {
        this._push('hud:contact', { actor: `ai:${a.id}`, active: false, source: previousSource });
      }
      this._push('hud:contact', {
        actor: `ai:${a.id}`, active: true, source,
        position: [n3(a.hudX), n3(a.position.y), n3(a.hudZ)],
      });
    }
    for (const [id, source] of this._contacts) {
      if (!contacts.has(id)) this._push('hud:contact', { actor: `ai:${id}`, active: false, source });
    }
    this._contacts = contacts;

    const rows = [];
    for (const a of agents) {
      if (!a.alive) continue;
      const previous = this._enemyState.get(a.id);
      if (previous !== a.state) {
        this._push('ai:state', { actor: `ai:${a.id}`, from: previous ?? null, to: a.state });
        this._enemyState.set(a.id, a.state);
      }
      const contact = contacts.has(a.id);
      rows.push({
        id: a.id, variant: a.variantName, position: vec(a.position),
        velocity: vec(a.velocity), yaw: n3(a.yaw), speed: n3(a.speed),
        health: n3(a.health), state: a.state, stateTime: n3(a.stateTime),
        squad: a.squad?.id ?? null, role: a.role ?? null,
        crouch: !!a.crouch, peeking: !!a.peeking, wantFire: !!a.wantFire,
        suppression: n3(a.suppression), hasTarget: !!a.hasTarget,
        targetVisible: !!a.targetVisible, lastKnown: vec(a.lastKnown),
        lastKnownAge: n3(a.lastKnownAge),
        lastSeenAge: n3(ctx.time.elapsed - a.lastSeen),
        lastFiredAge: n3(ctx.time.elapsed - a.lastFired),
        cover: a.cover ? [n3(a.cover.x), n3(a.cover.y), n3(a.cover.z)] : null,
        coverPosition: a.cover ? vec(a.coverPos) : null,
        moveTarget: a.hasMoveTarget ? vec(a.moveTarget) : null,
        pathLength: a.pathLen ?? 0, pathIndex: a.pathIndex ?? 0,
        pathPending: !!a.pathPending, stuckTime: n3(a.stuckTimer),
        lodIrrelevant: !!a.lodIrrelevant, hudContact: contact,
        hudPosition: contact ? [n3(a.hudX), n3(a.hudZ)] : null,
        hudFade: contact ? n3(a.hudFade) : null,
        hudRim: contact && !!a.hudRim,
      });
    }
    const alive = rows.length;
    this._maxAlive = Math.max(this._maxAlive, alive);

    const squads = [];
    for (const s of ai.squads) {
      squads.push({
        id: s.id, alive: s.alive, intent: s.intent, why: s.why,
        contactAge: n3(s.contactAge), planted: !!s.planted,
        wrapper: s.wrapper?.id ?? null, flanker: s.flanker?.id ?? null,
      });
    }
    this.enemySamples.push({
      t: this._time(), raw: this._rawTime(), frame: ctx.time.frame, alive, enemies: rows, squads,
    });
  }

  summary() {
    const counts = {};
    for (const e of this.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return {
      duration: this._time(), rawDuration: this._rawTime(),
      playerSamples: this.playerSamples.length, enemySamples: this.enemySamples.length,
      events: this.events.length, markers: this.markers.length,
      maxAlive: this._maxAlive, counts,
    };
  }

  snapshot() {
    return {
      schema: 1,
      meta: this.meta ?? null,
      summary: this.summary(),
      playerSamples: this.playerSamples,
      enemySamples: this.enemySamples,
      events: this.events,
      markers: this.markers,
    };
  }

  download() {
    if (!this.meta) return null;
    if (this.recording) this.stop();
    const stamp = this.meta.startedAt.replace(/[:.]/g, '-');
    const filename = `cod-telemetry-${stamp}.json`;
    const blob = new Blob([JSON.stringify(this.snapshot())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.exported = true;
    this.badge.textContent = `EXPORTED ${filename}`;
    return { filename, bytes: blob.size, summary: this.summary() };
  }

  _updateBadge(force = false) {
    const raw = this._rawTime();
    if (!force && raw - this._lastBadgeAt < 1) return;
    this._lastBadgeAt = raw;
    if (!this.recording) {
      this.badge.textContent = this.exported ? 'TELEMETRY EXPORTED' : 'TELEMETRY STOPPED · F8 EXPORT';
      return;
    }
    this.badge.textContent = `● REC ${raw.toFixed(0)}s · F7 MARK · F8 EXPORT`;
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    removeEventListener('keydown', this._onKey, true);
    removeEventListener('beforeunload', this._onBeforeUnload);
    this.badge?.remove();
    if (window.__TELEMETRY__ === this.api) delete window.__TELEMETRY__;
  }
}
