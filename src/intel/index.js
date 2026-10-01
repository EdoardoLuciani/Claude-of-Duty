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
 * Events emitted:  intel:spawn, intel:noise, intel:secured, intel:available.
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
    this._announceAt = 0;

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
    this._availablePayload = { count: 0 };
    this._eye = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._feet = new THREE.Vector3();
    this._beepAt = new THREE.Vector3();

    this._kit = makeKit();
    this._mats = this._kit.mats;
    this._pool = [makeCrate(this._kit), makeCrate(this._kit)];
    this._free = [0, 1];

    this._off = [];
    const on = (type, fn) => this._off.push(ctx.events.on(type, fn));
    on('wave:complete', () => this._onWaveComplete());
    on('wave:start', () => { if (this._alive.length) this._queueAnnounce(); });
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
    this._pulseBeacon(ctx);
    this._tickLure(ctx);
    this._flushAnnounce(ctx);

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
    this._announceAt = 0;
    this._rollRun();
  }

  dispose() {
    this._interrupt();
    this._clearPrompt();
    for (const cache of this._alive) cache.group.removeFromParent();
    this._alive.length = 0;
    for (const group of this._pool) group.removeFromParent();
    disposeKit(this._kit);
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
    const group = slot === undefined ? makeCrate(this._kit) : this._pool[slot];
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
    this._queueAnnounce();
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
    const audio = ctx.peek('audio');
    audio?.play?.('intel_siren', payload.position, {
      gain: INTEL.sirenGain,
      occlusion: 0,
      maxDist: 48,
      bus: 'weapons',
      priority: 0.92,
    });
    audio?.playUi?.('intel_siren', INTEL.sirenDry);
  }

  _queueAnnounce() {
    if (this._announceAt > this.ctx.time.elapsed) return;
    this._announceAt = this.ctx.time.elapsed + INTEL.announceDelay;
  }

  _flushAnnounce(ctx) {
    if (this._announceAt <= 0 || ctx.time.elapsed < this._announceAt) return;
    this._announceAt = 0;
    if (!this._alive.length) return;
    this._availablePayload.count = this._alive.length;
    ctx.events.emit('intel:available', this._availablePayload);
  }

  _pulseBeacon(ctx) {
    const mats = this._mats;
    if (!mats) return;
    const p = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(ctx.time.elapsed * 5.2));
    mats.beacon.color.setRGB(1, 0.42 + 0.4 * p, 0.04);
    mats.glow.opacity = 0.32 + 0.5 * p;
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
      const audio = ctx.peek('audio');
      const closeness = 1 - dist / r;
      audio?.play?.('intel_beep', this._beepAt, {
        gain: INTEL.lureGain,
        occlusion: 0,
        maxDist: r,
        bus: 'weapons',
        priority: 0.8,
      });
      // Head-locked layer so walls and distance falloff cannot swallow the lure.
      audio?.playUi?.('intel_beep', 0.7 + closeness * 0.55);
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

function makeKit() {
  const geos = {
    body: new THREE.BoxGeometry(0.72, 0.34, 0.46),
    lid: new THREE.BoxGeometry(0.76, 0.055, 0.5),
    band: new THREE.BoxGeometry(0.045, 0.36, 0.48),
    strap: new THREE.BoxGeometry(0.74, 0.028, 0.06),
    latch: new THREE.BoxGeometry(0.1, 0.08, 0.035),
    plate: new THREE.BoxGeometry(0.22, 0.012, 0.14),
    radio: new THREE.BoxGeometry(0.2, 0.09, 0.13),
    dial: new THREE.CylinderGeometry(0.028, 0.028, 0.012, 8),
    antenna: new THREE.CylinderGeometry(0.007, 0.007, 0.42, 6),
    beacon: new THREE.SphereGeometry(0.05, 8, 6),
    ring: new THREE.TorusGeometry(0.48, 0.02, 6, 32),
    foot: new THREE.BoxGeometry(0.07, 0.045, 0.09),
  };
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: 0x3c4634, roughness: 0.78, metalness: 0.18 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2a2e2c, roughness: 0.42, metalness: 0.82 }),
    latch: new THREE.MeshStandardMaterial({ color: 0xc4a15a, roughness: 0.38, metalness: 0.78 }),
    radio: new THREE.MeshStandardMaterial({ color: 0x1c2420, roughness: 0.55, metalness: 0.45 }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xffb020 }),
    glow: new THREE.MeshBasicMaterial({
      color: 0xff9a1a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  };
  return { geos, mats };
}

function addMesh(root, geo, mat, x, y, z, cast = true) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = cast;
  root.add(mesh);
  return mesh;
}

function makeCrate(kit) {
  const { geos, mats } = kit;
  const root = new THREE.Group();
  root.name = 'intel-cache';
  addMesh(root, geos.body, mats.body, 0, 0.22, 0);
  addMesh(root, geos.lid, mats.metal, 0, 0.41, 0);
  addMesh(root, geos.band, mats.metal, -0.22, 0.22, 0);
  addMesh(root, geos.band, mats.metal, 0.22, 0.22, 0);
  addMesh(root, geos.strap, mats.metal, 0, 0.3, 0.08);
  addMesh(root, geos.strap, mats.metal, 0, 0.3, -0.08);
  addMesh(root, geos.latch, mats.latch, 0, 0.28, 0.24);
  addMesh(root, geos.plate, mats.latch, 0, 0.445, -0.04);
  addMesh(root, geos.radio, mats.radio, 0.16, 0.48, 0.02);
  const dial = addMesh(root, geos.dial, mats.latch, 0.16, 0.53, 0.07, false);
  dial.rotation.x = Math.PI / 2;
  addMesh(root, geos.antenna, mats.metal, -0.22, 0.64, -0.08);
  const beacon = addMesh(root, geos.beacon, mats.beacon, -0.22, 0.88, -0.08, false);
  beacon.userData.owNoPrepass = true;
  beacon.userData.owNoShadow = true;
  const ring = addMesh(root, geos.ring, mats.glow, 0, 0.03, 0, false);
  ring.rotation.x = Math.PI / 2;
  ring.userData.owNoPrepass = true;
  ring.userData.owNoShadow = true;
  addMesh(root, geos.foot, mats.metal, -0.26, 0.025, 0.14, false);
  addMesh(root, geos.foot, mats.metal, 0.26, 0.025, 0.14, false);
  addMesh(root, geos.foot, mats.metal, -0.26, 0.025, -0.14, false);
  addMesh(root, geos.foot, mats.metal, 0.26, 0.025, -0.14, false);
  return root;
}

function disposeKit(kit) {
  if (!kit) return;
  for (const geo of Object.values(kit.geos)) geo.dispose();
  for (const mat of Object.values(kit.mats)) mat.dispose();
}
