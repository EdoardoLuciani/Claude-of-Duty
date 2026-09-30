/*
 * INTEL — Al-Maktaba, the hidden cache.
 *
 * Fourteen reachable sites live in the world manifest: rooms, upper floors,
 * a terrace, roofs, and the west courtyard. After each wave clear there is a
 * 60% chance to place one cache on a random unused site, up to two alive and
 * three-to-five per run. A site stays spent. A cache stays until secured.
 *
 * Hold F on the latch. Movement, a lost sightline, or any hit — including one
 * armour fully absorbs — wipes the bar. The pry alerts AI out to rifle range
 * for as long as it runs. A geiger beep leads the player in; it does not alert
 * anyone. The payout is shop credits and a card name. Card rewards wait.
 *
 * Deterministic captures spawn nothing.
 *
 * PUBLIC API — `const intel = ctx.get('intel')`
 *   intel.budget
 *   intel.secured
 *   intel.hasCard(id)
 *   intel.getHudState()  pooled { holding, progress, card, secured, pulses, pulseTime }
 *
 * Events consumed: wave:complete, damage:taken, game:restart.
 * Events emitted:  intel:spawn, intel:noise, intel:secured.
 */

import * as THREE from 'three';
import { INTEL, lureInterval } from './tuning.js';
import { cardById, drawCard, shuffleDeck } from './cards.js';
import { randomMarker, rollBudget, rollSpawn } from './spawn.js';

export class IntelSystem {
  static id = 'intel';
  // After the other rng forks, and after weapons, so a cache prompt is the last F write.
  static deps = ['world', 'player', 'market', 'ui', 'ai'];

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.world = ctx.get('world');
    this.player = ctx.get('player');
    this.market = ctx.get('market');
    this.physics = ctx.peek('physics');

    this.markers = readMarkers(this.world);
    this.budget = 0;
    this.secured = 0;
    this._deck = [];
    this._drawn = [];
    this._used = new Set();
    this._alive = [];
    this._holding = null;
    this._hold = 0;
    this._noiseAt = 0;
    this._prompting = false;

    this._hud = {
      holding: false, progress: 0, card: '', secured: 0,
      pulses: [], pulseTime: 0,
    };
    this._pulseSlots = [
      { x: 0, z: 0, radius: INTEL.pulseRadius },
      { x: 0, z: 0, radius: INTEL.pulseRadius },
    ];
    this._pulseView = [];
    this._spawnPayload = { id: '', position: new THREE.Vector3() };
    this._noisePayload = { position: new THREE.Vector3(), loudness: INTEL.pryLoudness };
    this._securePayload = {
      id: '', position: new THREE.Vector3(), card: '', cardLabel: '', credits: INTEL.credits,
    };
    this._eye = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._feet = new THREE.Vector3();
    this._beepAt = new THREE.Vector3();

    this._mats = makeMaterials();
    this._pool = [makeCrate(this._mats), makeCrate(this._mats)];
    this._free = [0, 1];

    this._off = [];
    const on = (type, fn) => this._off.push(ctx.events.on(type, fn));
    on('wave:complete', () => this._onWaveComplete());
    on('damage:taken', () => this._interrupt());
    on('game:restart', () => this.reset());

    this._rollRun();
  }

  hasCard(id) {
    return this._drawn.includes(id);
  }

  getHudState() {
    const h = this._hud;
    h.holding = this._holding !== null;
    h.progress = this._holding ? this._hold / INTEL.hold : 0;
    h.card = this._drawn.length ? this._drawn[this._drawn.length - 1] : '';
    h.secured = this.secured;
    h.pulseTime = this.ctx.time.elapsed;
    const n = Math.min(this._alive.length, this._pulseSlots.length);
    const view = this._pulseView;
    view.length = n;
    for (let i = 0; i < n; i++) {
      const slot = this._pulseSlots[i];
      slot.x = this._alive[i].x;
      slot.z = this._alive[i].z;
      view[i] = slot;
    }
    h.pulses = view;
    return h;
  }

  update(dt, ctx) {
    const player = this.player;
    if (!player || player.dead) {
      this._interrupt();
      this._clearPrompt();
      return;
    }
    const feet = player.feetPosition ?? player.position;
    if (feet) this._feet.copy(feet);
    const eye = player.eyePosition;
    if (eye) this._eye.copy(eye);
    else if (feet) this._eye.set(feet.x, feet.y + 1.65, feet.z);
    this._tickLure(ctx);

    if (!player.controlEnabled || player.healCtrl?.active || this._alive.length === 0) {
      this._interrupt();
      this._clearPrompt();
      return;
    }

    const nearest = this._nearest(this._feet);
    if (!nearest || !this._hasLos(nearest)) {
      this._interrupt();
      this._clearPrompt();
      return;
    }

    const input = ctx.input;
    const holding = !!(input && input.action('use') && !input.frozen && input.enabled !== false);
    if (this._holding && this._holding !== nearest) this._interrupt();

    if (!holding) {
      if (this._holding) this._interrupt();
      this._showPrompt(nearest, 0);
      return;
    }

    if (this._motionCancel(player)) {
      this._interrupt();
      this._showPrompt(nearest, 0);
      return;
    }

    if (!this._holding) {
      this._holding = nearest;
      this._hold = 0;
      this._noiseAt = 0;
    }
    this._hold = Math.min(INTEL.hold, this._hold + dt);
    this._pulseNoise(ctx, nearest);
    this._showPrompt(nearest, this._hold / INTEL.hold);
    if (this._hold >= INTEL.hold) this._secure(nearest);
  }

  reset() {
    this._interrupt();
    this._clearPrompt();
    for (let i = this._alive.length - 1; i >= 0; i--) this._despawn(this._alive[i]);
    this._used.clear();
    this._drawn.length = 0;
    this.secured = 0;
    this._rollRun();
  }

  dispose() {
    this._interrupt();
    this._clearPrompt();
    for (const cache of this._alive) cache.group.removeFromParent();
    this._alive.length = 0;
    for (const group of this._pool) {
      group.removeFromParent();
      group.traverse((obj) => {
        obj.geometry?.dispose?.();
      });
    }
    this._mats?.body.dispose();
    this._mats?.latch.dispose();
    for (const off of this._off) off();
    this._off.length = 0;
  }

  _rollRun() {
    if (this.ctx.config?.deterministic) {
      this.budget = 0;
      this._deck.length = 0;
      return;
    }
    this.budget = rollBudget(this.rng);
    shuffleDeck(this.rng, this._deck);
  }

  _onWaveComplete() {
    if (this.ctx.config?.deterministic) return;
    if (this.player?.dead) return;
    if (this._alive.length >= INTEL.aliveMax) return;
    if (this._used.size >= this.budget) return;
    if (!rollSpawn(this.rng)) return;
    const marker = randomMarker(this.markers, this._used, this.rng);
    if (marker) this._spawn(marker);
  }

  _spawn(marker) {
    const slot = this._free.pop();
    const group = slot === undefined ? makeCrate(this._mats) : this._pool[slot];
    group.visible = true;
    group.position.set(marker.x, marker.y, marker.z);
    group.rotation.y = hashYaw(marker.id);
    if (!group.parent) this.ctx.scene.add(group);
    const cache = {
      id: marker.id,
      tag: marker.tag,
      x: marker.x,
      y: marker.y,
      z: marker.z,
      group,
      slot,
      inLure: false,
      nextBeep: 0,
    };
    this._used.add(marker.id);
    this._alive.push(cache);
    const payload = this._spawnPayload;
    payload.id = marker.id;
    payload.position.set(marker.x, marker.y, marker.z);
    this.ctx.events.emit('intel:spawn', payload);
    return cache;
  }

  _secure(cache) {
    const cardId = drawCard(this._deck);
    const card = cardById(cardId);
    if (cardId && !this.hasCard(cardId)) this._drawn.push(cardId);
    this.secured++;
    this.market?.addCredits?.(INTEL.credits);
    const payload = this._securePayload;
    payload.id = cache.id;
    payload.position.set(cache.x, cache.y, cache.z);
    payload.card = cardId ?? '';
    payload.cardLabel = card?.label ?? 'Cache secured';
    payload.credits = INTEL.credits;
    this._despawn(cache);
    this._holding = null;
    this._hold = 0;
    this._clearPrompt();
    this.ctx.events.emit('intel:secured', payload);
    this.ctx.peek('audio')?.play?.('cloth', payload.position, { gain: 0.8 });
  }

  _despawn(cache) {
    const i = this._alive.indexOf(cache);
    if (i >= 0) this._alive.splice(i, 1);
    cache.group.visible = false;
    cache.group.removeFromParent();
    if (cache.slot !== undefined) this._free.push(cache.slot);
    if (this._holding === cache) this._holding = null;
  }

  _nearest(feet) {
    const r2 = INTEL.radius * INTEL.radius;
    let best = null;
    let bestD = r2;
    for (let i = 0; i < this._alive.length; i++) {
      const cache = this._alive[i];
      const dx = cache.x - feet.x;
      const dy = cache.y - feet.y;
      const dz = cache.z - feet.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= bestD) {
        bestD = d;
        best = cache;
      }
    }
    return best;
  }

  _hasLos(cache) {
    const phys = this.physics ?? this.ctx.peek('physics');
    if (!phys?.lineOfSight) return true;
    this._aim.set(cache.x, cache.y + 0.35, cache.z);
    return phys.lineOfSight(this._eye, this._aim);
  }

  _motionCancel(player) {
    if (player.sprinting || player.tacticalSprint || player.sliding || player.mantling || player.airborne) {
      return true;
    }
    return (player.horizontalSpeed ?? 0) > INTEL.moveCancel;
  }

  _pulseNoise(ctx, cache) {
    const now = ctx.time.elapsed;
    if (now < this._noiseAt) return;
    this._noiseAt = now + INTEL.noiseEvery;
    const payload = this._noisePayload;
    payload.position.set(cache.x, cache.y + 0.4, cache.z);
    payload.loudness = INTEL.pryLoudness;
    ctx.events.emit('intel:noise', payload);
    ctx.peek('audio')?.play?.('impact', payload.position, { surface: 'wood', energy: 0.45, gain: 0.5 });
  }

  _tickLure(ctx) {
    const now = ctx.time.elapsed;
    const ear = this._eye;
    const r = INTEL.lureRadius;
    const r2 = r * r;
    for (let i = 0; i < this._alive.length; i++) {
      const cache = this._alive[i];
      const dx = cache.x - ear.x;
      const dy = cache.y + 0.3 - ear.y;
      const dz = cache.z - ear.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) {
        cache.inLure = false;
        continue;
      }
      const dist = Math.sqrt(d2);
      if (!cache.inLure) {
        cache.inLure = true;
        cache.nextBeep = now;
      }
      if (now < cache.nextBeep) continue;
      cache.nextBeep = now + lureInterval(dist);
      this._beepAt.set(cache.x, cache.y + 0.3, cache.z);
      ctx.peek('audio')?.play?.('grenade_tick', this._beepAt, {
        gain: 0.42,
        maxDist: r,
        bus: 'foley',
      });
    }
  }

  _interrupt() {
    if (!this._holding && this._hold === 0) return;
    this._holding = null;
    this._hold = 0;
    this._noiseAt = 0;
  }

  _showPrompt(cache, progress) {
    this.ctx.peek('ui')?.setPrompt?.({
      key: 'F',
      text: 'Secure cache',
      sub: cache.tag || 'hold',
      progress,
    });
    this._prompting = true;
  }

  _clearPrompt() {
    if (!this._prompting) return;
    this.ctx.peek('ui')?.clearPrompt?.();
    this._prompting = false;
  }
}

function readMarkers(world) {
  const list = world?.intelMarkers;
  if (!Array.isArray(list)) return [];
  return list;
}

function hashYaw(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

function makeMaterials() {
  return {
    body: new THREE.MeshStandardMaterial({ color: 0x4a4638, roughness: 0.82, metalness: 0.08 }),
    latch: new THREE.MeshStandardMaterial({ color: 0x8a7344, roughness: 0.46, metalness: 0.72 }),
  };
}

function makeCrate(mats) {
  const root = new THREE.Group();
  root.name = 'intel-cache';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.34), mats.body);
  body.position.y = 0.16;
  body.castShadow = true;
  body.receiveShadow = true;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.045, 0.36), mats.body);
  lid.position.y = 0.32;
  lid.castShadow = true;
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.03), mats.latch);
  latch.position.set(0, 0.22, 0.175);
  root.add(body, lid, latch);
  return root;
}
