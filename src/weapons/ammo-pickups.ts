import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Fn, attribute, mix, positionLocal, positionPrevious } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import { bindingLabel } from '../core/bindings.ts';
import type { EngineContext } from '../core/context.ts';
import type { EngineEventMap } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import type { WeaponSystem } from './index.ts';

const PICKUP_RADIUS = 2.05;
const HOLD_TIME = 0.45;
const MAX_PICKUPS = 32;
interface AmmoPickup {
  id: number;
  slot: number;
  group: THREE.Group;
  baseY: number;
  born: number;
  expires: number;
  phase: number;
}
type AmmoContext = EngineContext;
type AmmoOwner = Pick<
  WeaponSystem,
  | 'ctx'
  | 'rng'
  | 'ammo'
  | 'player'
  | 'disabled'
  | 'grenadeEquipped'
  | 'radioEquipped'
  | 'state'
  | 'current'
  | 'addReserve'
>;

function isPosition(value: unknown): value is Pick<THREE.Vector3, 'x' | 'y' | 'z'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    typeof value.x === 'number' &&
    'y' in value &&
    typeof value.y === 'number' &&
    'z' in value &&
    typeof value.z === 'number'
  );
}

/**
 * Enemy-fed ammunition economy. Pickups last three minutes: long enough to
 * finish a fight and backtrack for supplies, while the hard pool cap prevents
 * endless waves from accumulating unbounded scene objects.
 */
export class AmmoPickups {
  owner!: AmmoOwner;
  ctx!: AmmoContext;
  rng!: Rng;
  lifetime!: number;
  items!: AmmoPickup[];
  _nextId!: number;
  _nearest!: AmmoPickup | null;
  _hold!: number;
  _prompting!: boolean;
  geometries!: Record<'case' | 'edge' | 'latch' | 'ring', THREE.BufferGeometry>;
  _visual: THREE.Group | null = null;
  _batches: THREE.InstancedMesh[] = [];
  _slots: (AmmoPickup | null)[] = Array<AmmoPickup | null>(MAX_PICKUPS).fill(null);
  _renderedIds: Float64Array[] = [];
  _hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  materials!: Record<'case' | 'edge' | 'latch' | 'glow', THREE.Material>;
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
    const lid = new THREE.BoxGeometry(0.4, 0.045, 0.29).translate(0, 0.235, 0);
    const band = new THREE.BoxGeometry(0.045, 0.205, 0.282).translate(0.1, 0.13, 0);
    this.geometries = {
      case: new THREE.BoxGeometry(0.38, 0.19, 0.27).translate(0, 0.12, 0),
      edge: mergeGeometries([lid, band]),
      latch: new THREE.BoxGeometry(0.075, 0.065, 0.035).translate(0, 0.18, 0.155),
      ring: new THREE.TorusGeometry(0.29, 0.011, 6, 28).rotateX(Math.PI / 2).translate(0, 0.035, 0),
    };
    lid.dispose();
    band.dispose();
    for (const name of ['case', 'edge', 'latch'] as const) {
      this.geometries[name].setAttribute(
        'ammoHistoryValid',
        new THREE.InstancedBufferAttribute(new Float32Array(MAX_PICKUPS), 1).setUsage(
          THREE.DynamicDrawUsage
        )
      );
    }
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
    for (const name of ['case', 'edge', 'latch'] as const) {
      const material = this.materials[name] as MeshStandardNodeMaterial;
      material.positionNode = Fn(() => {
        // Native history remains slot-indexed. Only a newly assigned identity
        // lacks a previous pose; preserve real motion for every surviving slot.
        positionPrevious.assign(
          mix(positionLocal, positionPrevious, attribute('ammoHistoryValid', 'float'))
        );
        return positionLocal;
      })();
    }
  }

  // The boot hook borrows these same batches, warming the actual instanced
  // variants without creating a pickup, consuming RNG or allocating a second pool.
  _makeVisual(): THREE.Group {
    if (this._visual) return this._visual;
    const root = new THREE.Group();
    root.name = 'ammo-pickups';
    for (const name of ['case', 'edge', 'latch', 'ring'] as const) {
      const ring = name === 'ring';
      const mesh = new THREE.InstancedMesh(
        this.geometries[name],
        this.materials[ring ? 'glow' : name],
        MAX_PICKUPS
      );
      mesh.name = `ammo-pickups-${name}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 1;
      mesh.castShadow = !ring;
      mesh.receiveShadow = !ring;
      if (ring) mesh.userData.owNoPrepass = true;
      const renderedIds = new Float64Array(MAX_PICKUPS);
      this._renderedIds.push(renderedIds);
      if (!ring)
        mesh.onAfterRender = (_renderer, _scene, camera) => {
          // Layer 1 on the world camera is the actual opaque/velocity prepass,
          // not a shadow. An unrendered batch cannot validate fresh slots.
          if (camera !== this.ctx.camera || camera.layers.mask !== 2) return;
          for (const item of this.items) renderedIds[item.slot] = item.id;
        };
      root.add(mesh);
      this._batches.push(mesh);
    }
    this._visual = root;
    return root;
  }

  _syncVisuals(): void {
    let count = MAX_PICKUPS;
    while (count > 0 && !this._slots[count - 1]) count--;
    // Empty frames neither upload matrices nor rebuild unchanged empty bounds.
    if (count === 0) {
      for (const mesh of this._batches) mesh.count = 0;
      return;
    }
    for (const item of this.items) item.group.updateMatrix();
    this._hiddenMatrix.setPosition(this.items[0].group.position);
    for (let batch = 0; batch < this._batches.length; batch++) {
      const mesh = this._batches[batch];
      const valid = mesh.geometry.getAttribute('ammoHistoryValid');
      mesh.count = count;
      for (let slot = 0; slot < count; slot++) {
        const item = this._slots[slot];
        mesh.setMatrixAt(slot, item ? item.group.matrix : this._hiddenMatrix);
        if (valid) valid.setX(slot, item && this._renderedIds[batch][slot] === item.id ? 1 : 0);
      }
      if (valid) valid.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      // Sparse holes collapse inside the live bounds, never at the world origin.
      mesh.computeBoundingSphere();
    }
  }

  onActorDeath(e: EngineEventMap['actor:death']): AmmoPickup | null {
    const actor = e?.actor;
    const actorObject =
      (typeof actor === 'object' || typeof actor === 'function') && actor !== null ? actor : null;
    if (
      !actor ||
      (actorObject &&
        (('friendly' in actorObject && actorObject.friendly) ||
          ('isPlayerCorpse' in actorObject && actorObject.isPlayerCorpse)))
    )
      return null;
    const ammo = this.owner.ammo;
    const low = ammo.total <= ammo.magSize * 1.25;
    if (!low && this.rng.float() >= 0.38) return null;
    const position = actorObject && 'position' in actorObject ? actorObject.position : null;
    const source = isPosition(position) ? position : e.point;
    if (!source) return null;
    return this.spawn(source);
  }

  spawn(position: Pick<THREE.Vector3, 'x' | 'y' | 'z'>): AmmoPickup {
    if (this.items.length >= MAX_PICKUPS) this._remove(this.items[0]);
    // Creation order owns gameplay priority; stable slots own native history.
    const group = new THREE.Group();
    group.position.set(position.x, position.y + 0.035, position.z);
    group.rotation.y = this.rng.range(0, Math.PI * 2);
    this.ctx.scene.add(this._makeVisual());
    const item = {
      id: this._nextId++,
      slot: this._slots.indexOf(null),
      group,
      baseY: group.position.y,
      born: this.ctx.time.elapsed,
      expires: this.ctx.time.elapsed + this.lifetime,
      phase: this.rng.range(0, Math.PI * 2),
    };
    this.items.push(item);
    this._slots[item.slot] = item;
    this._syncVisuals();
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

    this._syncVisuals();

    const player = this.owner.player ?? this.ctx.peek('player');
    if (
      !player ||
      player.dead ||
      this.owner.disabled ||
      !player.controlEnabled ||
      dt <= 0 ||
      this.ctx.time.scale <= 0 ||
      this.ctx.input.frozen ||
      !this.ctx.input.enabled ||
      player.healCtrl?.active ||
      this.owner.grenadeEquipped ||
      this.owner.radioEquipped ||
      this.ctx.peek('intel')?.blocksUse()
    ) {
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
      if (d2 < best) {
        best = d2;
        nearest = p;
      }
    }
    if (!nearest) {
      this._clearInteraction();
      return;
    }

    if (this._nearest !== nearest) this._hold = 0;
    this._nearest = nearest;
    if (this.ctx.input.action('use')) this._hold = Math.min(HOLD_TIME, this._hold + dt);
    else this._hold = Math.max(0, this._hold - dt * 2.5);

    const amount = Math.min(state.def.reserve - state.reserve, Math.ceil(state.def.magSize * 1.5));
    this.ctx.peek('ui')?.setPrompt?.(
      {
        key: bindingLabel('use'),
        text: 'Resupply ammunition',
        sub: `+${amount} rounds · hold`,
        progress: this._hold / HOLD_TIME,
      },
      'ammo'
    );
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
    if (i < 0) return;
    this.items.splice(i, 1);
    this._slots[item.slot] = null;
    this._syncVisuals();
    if (this._nearest === item) this._clearInteraction();
  }

  clear(): void {
    this._clearInteraction();
    this.items.length = 0;
    this._slots.fill(null);
    this._syncVisuals();
    this._visual?.removeFromParent();
  }

  dispose(): void {
    this.clear();
    for (const mesh of this._batches) mesh.dispose();
    for (const g of Object.values(this.geometries)) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
