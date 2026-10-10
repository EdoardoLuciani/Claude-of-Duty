/** Al-Maktaba: spawning, interruptible cache interaction and archived card names.
 * Limits live in tuning.ts; event contracts live in ARCHITECTURE.md.
 */
import * as THREE from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Rng } from '../core/rng.ts';
import type { CardId } from './cards.ts';
import { INTEL, lureInterval } from './tuning.ts';
import { cardById, drawCard, shuffleDeck } from './cards.ts';
import { randomMarker, rollBudget } from './spawn.ts';
import { makeKit, makeCrate } from './prop.js';

interface IntelMarker { id: string; x: number; y: number; z: number }
interface IntelCache { id: string; x: number; y: number; z: number; group: ReturnType<typeof makeCrate>; open: number }
interface IntelPrompt { key: string; text: string; sub: string; progress: number }
interface IntelHud { holding: boolean; progress: number; card: string; secured: number; pulses: Array<{ x: number; y: number; z: number; radius: number }>; pulseTime: number }
interface IntelPlayer { dead: boolean; controlEnabled: boolean; feetPosition: THREE.Vector3; eyePosition: THREE.Vector3; horizontalSpeed: number; sprinting: boolean; tacticalSprint: boolean; sliding: boolean; airborne: boolean; mantling: boolean; healCtrl?: { active: boolean } | null }
interface IntelMarket { open: boolean; addCredits(amount: number): number }
interface IntelPhysics { lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean }
interface IntelUi { setPrompt(prompt: IntelPrompt, source: string): void; clearPrompt(source: string): void; menu?: { open: boolean } }
interface IntelWeapons { canBeginHeal(): boolean }
interface IntelAudio { play(kind: string, position: THREE.Vector3, options: Record<string, unknown>): void }
interface IntelRender { patchMaterials(root: THREE.Object3D): void; _warmGraph(): Promise<void> }
interface IntelWorld { intelMarkers: IntelMarker[]; levelToWorld(x: number, y: number, z: number): THREE.Vector3 }
interface IntelMaterialSystem { get(name: string, options: Record<string, unknown>): THREE.Material; bakeMasks(geometry: THREE.BufferGeometry, options: Record<string, unknown>): void }
interface IntelEventMap { 'wave:complete': { wave: number }; 'damage:taken': unknown; 'game:restart': unknown; 'intel:available': { count: number }; 'intel:operation': { active: boolean; position: THREE.Vector3 }; 'intel:spark': { position: THREE.Vector3 }; 'intel:spawn': { id: string; position: THREE.Vector3 }; 'intel:secured': { id: string; position: THREE.Vector3; card: string; cardLabel: string; credits: number }; 'intel:noise': { position: THREE.Vector3; loudness: number } }
interface IntelEvents { on<K extends keyof IntelEventMap>(type: K, callback: (event: IntelEventMap[K]) => void): () => void; emit<K extends keyof IntelEventMap>(type: K, payload: IntelEventMap[K]): void }
interface IntelContext {
  rng: { fork(): Rng }; events: IntelEvents; scene: THREE.Scene; camera: THREE.Camera;
  config: { deterministic: boolean }; time: { frame: number; elapsed: number; scale: number };
  input: { action(name: string): boolean; frozen: boolean; enabled: boolean; fire: boolean; ads: boolean };
  get(name: 'player'): IntelPlayer; get(name: 'market'): IntelMarket; get(name: 'physics'): IntelPhysics; get(name: 'world'): IntelWorld; get(name: 'materials'): IntelMaterialSystem; get(name: 'render'): IntelRender;
  peek(name: 'ui'): IntelUi | null; peek(name: 'weapons'): IntelWeapons | null; peek(name: 'audio'): IntelAudio | null; peek(name: 'render'): IntelRender | null;
}

export class IntelSystem {
  declare ctx: IntelContext; declare rng: Rng; declare player: IntelPlayer; declare market: IntelMarket; declare physics: IntelPhysics; declare markers: IntelMarker[];
  declare _recent: string[]; declare _yaw: number; declare _deck: CardId[]; declare _drawn: CardId[]; declare _used: Set<string>; declare _alive: IntelCache[];
  declare _aim: THREE.Vector3; declare _forward: THREE.Vector3; declare _anchor: THREE.Vector3; declare _soundAt: THREE.Vector3; declare _sparkOffset: THREE.Vector3;
  declare _sparkPayload: IntelEventMap['intel:spark']; declare _operationPayload: IntelEventMap['intel:operation']; declare _prompt: IntelPrompt; declare _hud: IntelHud;
  declare _pulseSlots: IntelHud['pulses']; declare _spawnPayload: IntelEventMap['intel:spawn']; declare _noisePayload: IntelEventMap['intel:noise']; declare _securePayload: IntelEventMap['intel:secured']; declare _availablePayload: IntelEventMap['intel:available'];
  declare _beepOptions: Record<string, number | string>; declare _kit: ReturnType<typeof makeKit>; declare _pool: IntelCache[]; declare _off: Array<() => void>;
  declare _holding: IntelCache | null; declare _hold: number; declare _sparkAt: number; declare _noiseAt: number; declare _beepAt: number; declare _announceAt: number; declare _hitFrame: number; declare _lastWave: number; declare _awaitRelease: boolean; declare _prompting: boolean; declare secured: number; declare budget: number;

  static id = 'intel';
  static deps = ['world', 'player', 'market', 'ui', 'ai'];

  async init(ctx: IntelContext): Promise<void> {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.player = ctx.get('player');
    this.market = ctx.get('market');
    this.physics = ctx.get('physics');
    const world = ctx.get('world');
    this.markers = world.intelMarkers;
    this._recent = [];
    if (!ctx.config.deterministic) {
      try {
        const saved = JSON.parse(globalThis.localStorage?.getItem('ow:intel-sites:v1') ?? '[]');
        if (Array.isArray(saved)) {
          for (const id of saved) {
            if (this.markers.some((m) => m.id === id) && !this._recent.includes(id)) this._recent.push(id);
          }
          this._recent.splice(0, Math.max(0, this._recent.length - INTEL.recentSites));
        }
      } catch { /* storage may be unavailable; in-session history still works */ }
    }
    const origin = world.levelToWorld(0, 0, 0);
    const forward = world.levelToWorld(0, 0, -1);
    this._yaw = Math.atan2(origin.x - forward.x, origin.z - forward.z);
    this._deck = [];
    this._drawn = [];
    this._used = new Set();
    this._alive = [];
    this._aim = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
    this._soundAt = new THREE.Vector3();
    this._sparkOffset = new THREE.Vector3(0.13, 0.245, 0.06);
    this._sparkPayload = { position: new THREE.Vector3() };
    this._operationPayload = { active: false, position: new THREE.Vector3() };
    this._prompt = { key: 'F', text: 'Secure intel', sub: '', progress: 0 };
    this._hud = { holding: false, progress: 0, card: '', secured: 0, pulses: [], pulseTime: 0 };
    this._pulseSlots = Array.from({ length: INTEL.aliveMax }, () => ({ x: 0, y: 0, z: 0, radius: INTEL.pulseRadius }));
    this._spawnPayload = { id: '', position: new THREE.Vector3() };
    this._noisePayload = { position: new THREE.Vector3(), loudness: INTEL.pryLoudness };
    this._securePayload = { id: '', position: new THREE.Vector3(), card: '', cardLabel: '', credits: INTEL.credits };
    this._availablePayload = { count: 0 };
    this._beepOptions = { gain: INTEL.lureGain, occlusion: 0, maxDist: INTEL.lureRadius, bus: 'ui', priority: 0.5 };
    this._kit = makeKit(ctx.get('materials'));
    this._pool = Array.from({ length: INTEL.aliveMax }, () => ({
      id: '', x: 0, y: 0, z: 0, group: makeCrate(this._kit), open: 0,
    }));
    this._off = [];
    const on = <K extends keyof IntelEventMap>(type: K, fn: (event: IntelEventMap[K]) => void): void => {
      this._off.push(ctx.events.on(type, fn));
    };
    on('wave:complete', (e) => this._onWaveComplete(e));
    on('damage:taken', () => {
      this._hitFrame = ctx.time.frame;
      this._interrupt();
    });
    on('game:restart', () => this.reset());
    this.reset();
  }

  getHudState(): IntelHud {
    const h = this._hud;
    h.holding = this._holding !== null;
    h.progress = this._holding ? this._hold / INTEL.hold : 0;
    h.card = this._drawn[this._drawn.length - 1] ?? '';
    h.secured = this.secured;
    h.pulseTime = this.ctx.time.elapsed;
    h.pulses.length = this._alive.length;
    for (let i = 0; i < this._alive.length; i++) {
      const slot = this._pulseSlots[i];
      const cache = this._alive[i];
      slot.x = cache.x; slot.y = cache.y; slot.z = cache.z;
      h.pulses[i] = slot;
    }
    return h;
  }

  /** Ammo pickups yield F to an aimed cache, even before this system's update. */
  blocksUse(): boolean {
    return (this._awaitRelease && this.ctx.input.action('use')) || this._target() !== null;
  }

  update(dt: number, ctx: IntelContext): void {
    if (!ctx.input.action('use')) this._awaitRelease = false;
    if (!this._canDiscover() || dt <= 0) {
      this._interrupt();
      this._clearPrompt();
      return;
    }
    // HDR lens feeds the existing bloom; no extra point-light shader variants.
    const pulse = 0.5 - 0.5 * Math.cos(ctx.time.elapsed * 2 * Math.PI / INTEL.beaconPeriod);
    const glow = INTEL.beaconDim + (INTEL.beaconBright - INTEL.beaconDim) * pulse * pulse;
    (this._kit.mats.beacon as MeshBasicNodeMaterial).color.setRGB(glow, glow * 0.008, glow * 0.002);
    this._tickLure();
    if (this._announceAt && ctx.time.elapsed >= this._announceAt) {
      this._announceAt = 0;
      if (this._alive.length) {
        this._availablePayload.count = this._alive.length;
        ctx.events.emit('intel:available', this._availablePayload);
      }
    }
    const target = this._target();
    if (!target) {
      this._interrupt();
      this._clearPrompt();
      return;
    }
    if (this._holding !== target) this._interrupt();
    const feet = this.player.feetPosition;
    const moving = this.player.horizontalSpeed > INTEL.moveCancel || this.player.sprinting ||
      this.player.tacticalSprint || this.player.sliding || this.player.airborne ||
      (this._holding && this._anchor.distanceToSquared(feet) > INTEL.driftCancel ** 2);
    if (!ctx.input.action('use') || this._awaitRelease || moving || this._hitFrame === ctx.time.frame) {
      this._interrupt();
    } else {
      if (!this._holding) {
        this._holding = target;
        this._anchor.copy(feet);
        this._sparkAt = ctx.time.elapsed;
        this._operationPayload.active = true;
        this._operationPayload.position.set(target.x, target.y + INTEL.targetHeight, target.z);
        ctx.events.emit('intel:operation', this._operationPayload);
      }
      this._hold = Math.min(INTEL.hold, this._hold + dt);
      this._pulseNoise(target);
    }
    this._prompt.text = this._holding ? 'Alarm active — securing intel' : 'Secure intel';
    this._prompt.sub = moving ? 'Stand still to secure' : this._holding ?
      `Attracting attention · +${INTEL.credits} credits` : `Hold ${INTEL.hold}s · +${INTEL.credits} credits · triggers alarm`;
    this._prompt.progress = this._hold / INTEL.hold;
    ctx.peek('ui')?.setPrompt(this._prompt, 'intel');
    this._prompting = true;
    if (this._hold >= INTEL.hold) this._secure(target);
  }

  lateUpdate(dt: number, ctx: IntelContext): void {
    for (const cache of this._alive) {
      const operating = this._holding === cache;
      if (dt <= 0 || ctx.time.scale <= 0) cache.open = 0;
      else if (operating) cache.open = Math.min(1, cache.open + dt / INTEL.lidOpenTime);
      else cache.open = Math.max(0, cache.open - dt / INTEL.lidCloseTime);
      const ease = cache.open * cache.open * (3 - 2 * cache.open);
      cache.group.lid.rotation.x = cache.open === 0 ? 0 : -INTEL.lidAngle * ease;
      if (!operating || cache.open < INTEL.sparkOpen || ctx.time.elapsed < this._sparkAt) continue;
      this._sparkAt = ctx.time.elapsed + INTEL.sparkEvery;
      cache.group.localToWorld(this._sparkPayload.position.copy(this._sparkOffset));
      ctx.events.emit('intel:spark', this._sparkPayload);
    }
  }

  _canDiscover(): boolean {
    const ctx = this.ctx;
    return !this.player.dead && this.player.controlEnabled && ctx.time.scale > 0 &&
      !ctx.input.frozen && ctx.input.enabled && !ctx.peek('ui')?.menu?.open && !this.market.open;
  }

  _canInteract(): boolean {
    const ctx = this.ctx;
    // Bandaging and cache operation share the weapon system's free-hands policy.
    return this._canDiscover() && !this.player.mantling && !this.player.healCtrl?.active &&
      !ctx.input.fire && !ctx.input.ads && (ctx.peek('weapons')?.canBeginHeal() ?? true);
  }

  /** Pick the nearest *visible, aimed* case, not the nearest through a wall. */
  _target(): IntelCache | null {
    if (!this._canInteract()) return null;
    const feet = this.player.feetPosition;
    const eye = this.player.eyePosition;
    this.ctx.camera.getWorldDirection(this._forward);
    let best = null;
    let bestD = INTEL.radius ** 2;
    for (const cache of this._alive) {
      const dx = cache.x - feet.x, dy = cache.y - feet.y, dz = cache.z - feet.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > bestD) continue;
      this._aim.set(cache.x, cache.y + INTEL.targetHeight, cache.z).sub(eye);
      if (this._aim.lengthSq() < 0.0001 || this._aim.normalize().dot(this._forward) < INTEL.aimCos) continue;
      this._aim.set(cache.x, cache.y + INTEL.targetHeight, cache.z);
      if (!this.physics.lineOfSight(eye, this._aim)) continue;
      bestD = d;
      best = cache;
    }
    return best;
  }

  _onWaveComplete(e: IntelEventMap['wave:complete']): void {
    if (this.ctx.config.deterministic || this.player.dead || !Number.isInteger(e?.wave) || e.wave <= this._lastWave) return;
    this._lastWave = e.wave;
    if (this._alive.length >= INTEL.aliveMax || this._used.size >= this.budget) return;
    const marker = randomMarker(this.markers, this._used, this.player.feetPosition, this._alive, this.rng, this._recent);
    if (marker) this._spawn(marker);
  }

  _spawn(marker: IntelMarker): IntelCache | null {
    const cache = this._pool.find((slot) => !this._alive.includes(slot));
    if (!cache || this._used.has(marker.id)) return null;
    cache.id = marker.id;
    cache.x = marker.x; cache.y = marker.y; cache.z = marker.z;
    cache.group.visible = true;
    cache.group.position.set(cache.x, cache.y, cache.z);
    // Keep the authored footprint; arbitrary yaw can put a corner through furniture.
    cache.group.rotation.y = this._yaw;
    this.ctx.scene.add(cache.group);
    this._used.add(cache.id);
    this._alive.push(cache);
    if (!this.ctx.config.deterministic) {
      const recent = this._recent.indexOf(cache.id);
      if (recent >= 0) this._recent.splice(recent, 1);
      this._recent.push(cache.id);
      if (this._recent.length > INTEL.recentSites) this._recent.shift();
      try {
        globalThis.localStorage?.setItem('ow:intel-sites:v1', JSON.stringify(this._recent));
      } catch { /* keep the same preference for restarts when storage is blocked */ }
    }
    this._spawnPayload.id = cache.id;
    this._spawnPayload.position.set(cache.x, cache.y, cache.z);
    this.ctx.events.emit('intel:spawn', this._spawnPayload);
    if (!this._announceAt) this._announceAt = this.ctx.time.elapsed + INTEL.announceDelay;
    return cache;
  }

  _secure(cache: IntelCache): void {
    if (!this._alive.includes(cache)) return;
    const card = drawCard(this._deck);
    if (card) this._drawn.push(card);
    this.secured++;
    this.market.addCredits(INTEL.credits);
    const e = this._securePayload;
    e.id = cache.id; e.position.set(cache.x, cache.y + INTEL.targetHeight, cache.z);
    e.card = card ?? ''; e.cardLabel = cardById(card ?? '')?.label ?? 'Intel';
    this._despawn(cache);
    this._interrupt();
    this._clearPrompt();
    this._awaitRelease = true;
    this.ctx.events.emit('intel:secured', e);
  }

  _despawn(cache: IntelCache): void {
    const i = this._alive.indexOf(cache);
    if (i < 0) return;
    this._alive.splice(i, 1);
    cache.open = 0;
    cache.group.lid.rotation.x = 0;
    cache.group.visible = false;
    cache.group.removeFromParent();
  }

  _pulseNoise(cache: IntelCache): void {
    const now = this.ctx.time.elapsed;
    if (now < this._noiseAt) return;
    this._noiseAt = now + INTEL.noiseEvery;
    this._noisePayload.position.set(cache.x, cache.y + INTEL.targetHeight, cache.z);
    this.ctx.events.emit('intel:noise', this._noisePayload);
  }

  _tickLure(): void {
    const now = this.ctx.time.elapsed;
    const eye = this.player.eyePosition;
    let nearest = null;
    let distance = INTEL.lureRadius ** 2;
    for (const cache of this._alive) {
      this._soundAt.set(cache.x, cache.y + INTEL.targetHeight, cache.z);
      const d = this._soundAt.distanceToSquared(eye);
      if (d < distance) { nearest = cache; distance = d; }
    }
    if (!nearest) { this._beepAt = 0; return; }
    if (this._holding || now < this._beepAt) return;
    this._beepAt = now + lureInterval(Math.sqrt(distance));
    this._soundAt.set(nearest.x, nearest.y + INTEL.targetHeight, nearest.z);
    this.ctx.peek('audio')?.play('intel_beep', this._soundAt, this._beepOptions);
  }

  _interrupt(): void {
    if (this._holding) {
      this._operationPayload.active = false;
      this.ctx.events.emit('intel:operation', this._operationPayload);
    }
    this._holding = null;
    this._hold = 0;
    this._noiseAt = 0;
    this._sparkAt = 0;
  }

  _clearPrompt(): void {
    if (this._prompting) this.ctx.peek('ui')?.clearPrompt('intel');
    this._prompting = false;
  }

  reset(): void {
    this._interrupt();
    this._clearPrompt();
    while (this._alive.length) this._despawn(this._alive[this._alive.length - 1]);
    this._used.clear(); this._drawn.length = 0;
    this.secured = 0;
    this._beepAt = this._announceAt = this._lastWave = 0;
    this._hitFrame = -1;
    this._awaitRelease = false;
    this.budget = this.ctx.config.deterministic ? 0 : rollBudget(this.rng);
    if (this.budget) shuffleDeck(this.rng, this._deck);
    else this._deck.length = 0;
  }

  /** Compile pooled props at boot without spawning, consuming RNG or drawing. */
  async prewarmMaterials(ctx: IntelContext = this.ctx): Promise<{ ok: true }> {
    const render = ctx.get('render');
    const group = this._pool[0].group;
    const parent = group.parent, visible = group.visible;
    group.visible = true;
    ctx.scene.add(group);
    try {
      render.patchMaterials(group);
      // Prime the actual world, unlit MRT and shadow variants without drawing
      // geometry or toggling native light identities. No temporary WebGL target.
      await render._warmGraph();
    } finally {
      group.visible = visible;
      group.removeFromParent();
      parent?.add(group);
    }
    return { ok: true };
  }

  dispose(): void {
    this._interrupt(); this._clearPrompt();
    for (const cache of this._pool) cache.group.removeFromParent();
    this._alive.length = 0;
    this._kit.dispose();
    for (const off of this._off) off();
    this._off.length = 0;
  }
}
