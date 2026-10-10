import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';

const PICKUP_RADIUS = 2.05;
const HOLD_TIME = 0.45;
const MAX_PICKUPS = 32;
interface AmmoPickup { id: number; group: THREE.Group; baseY: number; born: number; expires: number; phase: number }
interface AmmoPlayer { dead: boolean; controlEnabled: boolean; feetPosition?: THREE.Vector3; position?: THREE.Vector3; healCtrl?: { active: boolean } }
interface AmmoUI { setPrompt?(prompt: { key: string; text: string; sub: string; progress: number }, id: string): void; clearPrompt?(id: string): void }
interface AmmoIntel { blocksUse(): boolean }
interface AmmoRng { float(): number; range(min: number, max: number): number }
interface AmmoState { reserve: number; def: { reserve: number; magSize: number } }
interface AmmoContext {
  scene: THREE.Scene; time: { elapsed: number; scale: number }; input: { frozen: boolean; enabled: boolean; action(name: string): boolean };
  peek(name: 'player'): AmmoPlayer | null; peek(name: 'ui'): AmmoUI | null; peek(name: 'intel'): AmmoIntel | null;
  events: { emit(name: string, data: { amount: number; weapon: string; position: THREE.Vector3 }): void };
}
interface AmmoOwner {
  ctx: AmmoContext; rng: AmmoRng; ammo: { total: number; magSize: number }; player?: AmmoPlayer | null; disabled: boolean;
  grenadeEquipped: boolean; radioEquipped: boolean; state: AmmoState | null; current: string;
  addReserve(amount: number): number;
}

/**
 * Enemy-fed ammunition economy. Pickups last three minutes: long enough to
 * finish a fight and backtrack for supplies, while the hard pool cap prevents
 * endless waves from accumulating unbounded scene objects.
 */
export class AmmoPickups {
  owner!: AmmoOwner; ctx!: AmmoContext; rng!: AmmoRng; lifetime!: number; items!: AmmoPickup[]; _nextId!: number;
  _nearest!: AmmoPickup | null; _hold!: number; _prompting!: boolean;
  geometries!: Record<string, THREE.BufferGeometry>; materials!: Record<string, THREE.Material>;
  constructor(owner: AmmoOwner) {
    this.owner = owner;
    this.ctx = owner.ctx;
    this.rng = owner.rng;
    this.lifetime = 180;
    this.items = [];
    this._nextId = 1;
    this._nearest = null;
    this._hold = 0;
    this._prompting = false;
    this._makeAssets();
  }

  _makeAssets() {
    this.geometries = {
      case: new THREE.BoxGeometry(0.38, 0.19, 0.27),
      lid: new THREE.BoxGeometry(0.4, 0.045, 0.29),
      band: new THREE.BoxGeometry(0.045, 0.205, 0.282),
      latch: new THREE.BoxGeometry(0.075, 0.065, 0.035),
      ring: new THREE.TorusGeometry(0.29, 0.011, 6, 28),
    };
    this.materials = {
      case: new MeshStandardNodeMaterial({ color: 0x3f4933, roughness: 0.72, metalness: 0.5 }),
      edge: new MeshStandardNodeMaterial({ color: 0x222921, roughness: 0.58, metalness: 0.72 }),
      latch: new MeshStandardNodeMaterial({ color: 0xb78a3b, roughness: 0.42, metalness: 0.8 }),
      glow: new THREE.MeshBasicMaterial({
        color: 0xffb02a,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    };
  }

  _makeVisual(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'ammo-pickup';
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, z = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, y, z);
      m.castShadow = mat !== this.materials.glow;
      m.receiveShadow = mat !== this.materials.glow;
      root.add(m);
      return m;
    };
    add(this.geometries.case, this.materials.case, 0.12);
    add(this.geometries.lid, this.materials.edge, 0.235);
    const band = add(this.geometries.band, this.materials.edge, 0.13);
    band.position.x = 0.1;
    add(this.geometries.latch, this.materials.latch, 0.18, 0.155);
    const ring = add(this.geometries.ring, this.materials.glow, 0.035);
    ring.rotation.x = Math.PI / 2;
    ring.userData.owNoPrepass = true;
    ring.castShadow = false;
    return root;
  }

  onActorDeath(e: { actor?: { friendly?: boolean; isPlayerCorpse?: boolean; position?: THREE.Vector3 }; point?: THREE.Vector3 }): AmmoPickup | null {
    const actor = e?.actor;
    if (!actor || actor.friendly || actor.isPlayerCorpse) return null;
    const ammo = this.owner.ammo;
    const low = ammo.total <= ammo.magSize * 1.25;
    if (!low && this.rng.float() >= 0.38) return null;
    const source = actor.position ?? e.point;
    if (!source) return null;
    return this.spawn(source);
  }

  spawn(position: THREE.Vector3): AmmoPickup {
    if (this.items.length >= MAX_PICKUPS) this._remove(this.items[0]);
    const group = this._makeVisual();
    group.position.set(position.x, position.y + 0.035, position.z);
    group.rotation.y = this.rng.range(0, Math.PI * 2);
    this.ctx.scene.add(group);
    const item = {
      id: this._nextId++,
      group,
      baseY: group.position.y,
      born: this.ctx.time.elapsed,
      expires: this.ctx.time.elapsed + this.lifetime,
      phase: this.rng.range(0, Math.PI * 2),
    };
    this.items.push(item);
    return item;
  }

  update(dt: number): void {
    const now = this.ctx.time.elapsed;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      if (now >= p.expires) {
        this._remove(p);
        continue;
      }
      p.group.rotation.y += dt * 0.28;
      p.group.position.y = p.baseY + Math.sin(now * 1.8 + p.phase) * 0.025;
    }

    const player = this.owner.player ?? this.ctx.peek('player');
    if (!player || player.dead || this.owner.disabled || !player.controlEnabled || dt <= 0 ||
        this.ctx.time.scale <= 0 || this.ctx.input.frozen || !this.ctx.input.enabled ||
        player.healCtrl?.active || this.owner.grenadeEquipped || this.owner.radioEquipped ||
        this.ctx.peek('intel')?.blocksUse()) {
      this._clearInteraction();
      return;
    }

    const pos = player.feetPosition ?? player.position;
    const state = this.owner.state;
    if (!pos || !state || state.reserve >= state.def.reserve) {
      this._clearInteraction();
      return;
    }

    let nearest: AmmoPickup | null = null;
    let best = PICKUP_RADIUS * PICKUP_RADIUS;
    for (const p of this.items) {
      const dx = p.group.position.x - pos.x;
      const dy = p.group.position.y - pos.y;
      const dz = p.group.position.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; nearest = p; }
    }
    if (!nearest) {
      this._clearInteraction();
      return;
    }

    if (this._nearest !== nearest) this._hold = 0;
    this._nearest = nearest;
    if (this.ctx.input.action('use')) this._hold = Math.min(HOLD_TIME, this._hold + dt);
    else this._hold = Math.max(0, this._hold - dt * 2.5);

    const amount = Math.min(
      state.def.reserve - state.reserve,
      Math.ceil(state.def.magSize * 1.5)
    );
    this.ctx.peek('ui')?.setPrompt?.({
      key: 'F',
      text: 'Resupply ammunition',
      sub: `+${amount} rounds · hold`,
      progress: this._hold / HOLD_TIME,
    }, 'ammo');
    this._prompting = true;

    if (this._hold < HOLD_TIME) return;
    const taken = this.owner.addReserve(amount);
    const point = nearest.group.position.clone();
    this._remove(nearest);
    this._clearInteraction();
    if (taken > 0) {
      this.ctx.events.emit('ammo:pickup', {
        amount: taken,
        weapon: this.owner.current,
        position: point,
      });
    }
  }

  _clearInteraction(): void {
    this._nearest = null;
    this._hold = 0;
    if (this._prompting) this.ctx.peek('ui')?.clearPrompt?.('ammo');
    this._prompting = false;
  }

  _remove(item: AmmoPickup): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    item.group.removeFromParent();
    if (this._nearest === item) this._nearest = null;
  }

  clear(): void {
    this._clearInteraction();
    for (const p of this.items) p.group.removeFromParent();
    this.items.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const g of Object.values(this.geometries)) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
