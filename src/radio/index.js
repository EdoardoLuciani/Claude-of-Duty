import * as THREE from 'three';

/**
 * RADIO — carpet-bomb strike: bomber, falling bombs, blast chain.
 *
 * The radio item (equip, requests, charges) lives in WeaponSystem._updateRadio.
 * Damage uses the canonical `explosion` event, same as a grenade.
 *
 *   radio.callStrike()   start one strike; no-op while one is airborne
 *   radio.clearStrike()  remove the active strike (restart/capture cleanup)
 *   radio.active         strikes in flight
 *
 * Events: radio:strike { position }
 */

export const CARPET = {
  planeSpeed: 40,          // m/s along the flight path
  altitude: 55,            // m the bomber flies above the ground
  dropStep: 20,            // m between bomb lines along the path
  lateral: [-14, -7, 0, 7, 14], // m offsets of the five bomb streams
  radius: 20,              // m blast radius per bomb (the grenade is 10)
  damage: 1400,            // one-shot even a fully armoured target mid-blast
  blastHeight: 0.08,       // keep the LOS origin clear of the ground triangle
};

const BOMB_FALL = 9.8;   // m/s²
const BOMB_MAX_AGE = 20; // s before an un-detonated bomb is retired
const ALTITUDE = CARPET.altitude;
/** Horizontal distance a bomb travels while falling (speed × fall time). */
const LEAD = CARPET.planeSpeed * Math.sqrt((2 * ALTITUDE) / BOMB_FALL);

const matBody = new THREE.MeshStandardMaterial({
  color: 0x3b3f33, roughness: 0.72, metalness: 0.4,
});
const matDark = new THREE.MeshStandardMaterial({
  color: 0x26281e, roughness: 0.85, metalness: 0.3,
});
const matProp = new THREE.MeshStandardMaterial({
  color: 0x1a1c16, roughness: 0.9, metalness: 0.1, transparent: true, opacity: 0.55,
});
const matBomb = new THREE.MeshStandardMaterial({
  color: 0x2c2f24, roughness: 0.8, metalness: 0.35,
});
const matGlow = new THREE.MeshStandardMaterial({
  color: 0x300000, emissive: 0xff3010, emissiveIntensity: 3,
});

/** Shared geometries — meshes borrow these; RadioSystem frees them in dispose(). */
const GEO = {
  fus: new THREE.CylinderGeometry(0.95, 0.95, 12.5, 12),
  nose: new THREE.ConeGeometry(0.95, 3.2, 12),
  tail: new THREE.ConeGeometry(0.7, 1.6, 10),
  wing: new THREE.BoxGeometry(22, 0.16, 2.8),
  tailWing: new THREE.BoxGeometry(7, 0.12, 1.5),
  fin: new THREE.BoxGeometry(0.12, 2.4, 1.8),
  engine: new THREE.CylinderGeometry(0.62, 0.72, 2.6, 12),
  prop: new THREE.CircleGeometry(0.95, 14),
  bombBody: new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8),
  bombNose: new THREE.ConeGeometry(0.16, 0.5, 8),
  bombTail: new THREE.ConeGeometry(0.12, 0.35, 8),
  bombGlow: new THREE.SphereGeometry(0.06, 6, 6),
};

function bomberMesh() {
  const g = new THREE.Group();
  const fus = new THREE.Mesh(GEO.fus, matBody);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(GEO.nose, matDark);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -7.85;
  g.add(nose);
  const tail = new THREE.Mesh(GEO.tail, matDark);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 7.05;
  g.add(tail);
  const wing = new THREE.Mesh(GEO.wing, matBody);
  wing.position.set(0, 0.35, -0.6);
  g.add(wing);
  const tailWing = new THREE.Mesh(GEO.tailWing, matBody);
  tailWing.position.set(0, 0.4, 5.6);
  g.add(tailWing);
  const fin = new THREE.Mesh(GEO.fin, matBody);
  fin.position.set(0, 1.7, 5.4);
  g.add(fin);
  g.userData.props = [];
  for (const sx of [-6.5, 6.5]) {
    const eng = new THREE.Mesh(GEO.engine, matDark);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(sx, 0.32, -3.8);
    g.add(eng);
    const prop = new THREE.Mesh(GEO.prop, matProp);
    prop.position.set(sx, 0.32, -5.1);
    g.add(prop);
    g.userData.props.push(prop);
  }
  return g;
}

function bombMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.bombBody, matBomb);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(GEO.bombNose, matBomb);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.8;
  g.add(nose);
  const tail = new THREE.Mesh(GEO.bombTail, matBomb);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.72;
  g.add(tail);
  const glow = new THREE.Mesh(GEO.bombGlow, matGlow);
  glow.position.z = -0.66;
  g.add(glow);
  g.rotation.x = Math.PI / 2;
  return g;
}

export class RadioSystem {
  static id = 'radio';
  static deps = ['world'];

  async init(ctx) {
    this.ctx = ctx;
    this._world = ctx.get('world');
    this._physics = null;
    this._player = null;
    this._audio = null;
    /** Active strikes: { plane, bombs, drops, travel, start, dir } */
    this.active = [];
    this._warmTicks = 0;
    this._warmed = false;
    this._off = [];
    this._off.push(ctx.events.on('game:restart', () => this.clearStrike()));
  }

  /** Compile bomber/bomb programs after visible lights settle. */
  prewarmMaterials() {
    if (this._warmed) return;
    const render = this.ctx.peek('render');
    const renderer = render?.renderer;
    if (!renderer) return;

    const scene = new THREE.Scene();
    scene.children.push(bomberMesh(), bombMesh());
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace?.() ?? 0;
    const previousMip = renderer.getActiveMipmapLevel?.() ?? 0;
    try {
      for (const material of [matBody, matDark, matProp, matBomb, matGlow]) {
        render.patcher?.patch?.(material);
      }
      renderer.setRenderTarget(render.hdrRt);
      renderer.compile(scene, this.ctx.camera, this.ctx.scene);
      this._warmed = true;
    } catch {
      // Lights may not be settled yet; retry next frame.
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      scene.children.length = 0;
    }
  }

  /* ==================================================================== */
  /*  strike                                                              */
  /* ==================================================================== */

  /** Start a strike. No-op while one is already airborne. */
  callStrike() {
    if (this.active.length) return false;
    const bounds = this._world?.bounds;
    if (!bounds) return false;

    // Street axis from spawn yaw; forward is (-sin(yaw), -cos(yaw)).
    const sp = this._world.spawn?.(0);
    const yaw = sp?.yaw ?? Math.atan2(-0.832, -0.832);
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);

    const min = bounds.min;
    const max = bounds.max;
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const corners = [
      min.x * dx + min.z * dz,
      max.x * dx + min.z * dz,
      min.x * dx + max.z * dz,
      max.x * dx + max.z * dz,
    ];
    const tMin = Math.min(...corners);
    const tMax = Math.max(...corners);
    const startT = tMin - LEAD;

    const drops = [];
    for (let t = tMin; t <= tMax + 1e-3; t += CARPET.dropStep) drops.push(t - tMin);

    const start = new THREE.Vector3(cx + dx * startT, ALTITUDE, cz + dz * startT);
    const dir = new THREE.Vector3(dx, 0, dz);
    const plane = bomberMesh();
    plane.position.copy(start);
    plane.rotation.y = Math.atan2(-dx, -dz);
    plane.rotation.z = 0.05;
    this.ctx.scene.add(plane);

    this.active.push({
      plane,
      start,
      dir,
      speed: CARPET.planeSpeed,
      travel: 0,
      drops,
      dropIdx: 0,
      bombs: [],
      engineRepeat: false,
    });

    this.ctx.events.emit('radio:strike', { position: start });
    this._audio = this._audio ?? this.ctx.peek('audio');
    this._audio?.play?.('ambient', start, { which: 'heli', level: 1.2 });
    return true;
  }

  /* ==================================================================== */
  /*  frame                                                               */
  /* ==================================================================== */

  update(dt) {
    if (!this._warmed && ++this._warmTicks > 1) this.prewarmMaterials();
    if (!this.active.length) return;
    const physics = this._physics ?? (this._physics = this.ctx.peek('physics'));
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));

    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.travel += s.speed * dt;

      s.plane.position.copy(s.start).addScaledVector(s.dir, s.travel);
      s.plane.position.y = ALTITUDE;
      s.plane.rotation.z = 0.05 + Math.sin(s.travel * 0.11) * 0.035;
      for (const p of s.plane.userData.props ?? []) p.rotation.z += dt * 26;

      while (s.dropIdx < s.drops.length && s.travel >= s.drops[s.dropIdx]) {
        s.dropIdx++;
        for (const off of CARPET.lateral) this._dropBomb(s, off);
      }
      const mid = s.drops[Math.floor(s.drops.length / 2)];
      if (!s.engineRepeat && mid != null && s.travel >= mid) {
        s.engineRepeat = true;
        audio?.play?.('ambient', s.plane.position, { which: 'heli', level: 1.2 });
      }

      // Horizontal follow is derived from the bomber; only vy is integrated.
      for (let b = s.bombs.length - 1; b >= 0; b--) {
        const bomb = s.bombs[b];
        bomb.age += dt;
        bomb.vy -= BOMB_FALL * dt;
        bomb.mesh.position.set(
          s.plane.position.x + bomb.lx,
          bomb.mesh.position.y + bomb.vy * dt,
          s.plane.position.z + bomb.lz
        );
        bomb.mesh.rotation.z += dt * 2.2;

        const gy = physics?.groundHeight?.(bomb.mesh.position.x, bomb.mesh.position.z, bomb.mesh.position.y + 2);
        if (bomb.mesh.position.y <= gy || bomb.age > BOMB_MAX_AGE) {
          const groundY = Number.isFinite(gy) ? gy : bomb.mesh.position.y;
          this._detonate(bomb, groundY);
          s.bombs.splice(b, 1);
        }
      }

      if (s.travel >= s.drops[s.drops.length - 1] + LEAD + 30 && s.bombs.length === 0) {
        s.plane.removeFromParent();
        this.active.splice(i, 1);
      }
    }
  }

  _dropBomb(s, lateral) {
    const lx = -s.dir.z * lateral;
    const lz = s.dir.x * lateral;
    const mesh = bombMesh();
    mesh.position.set(
      s.plane.position.x + lx,
      s.plane.position.y,
      s.plane.position.z + lz
    );
    this.ctx.scene.add(mesh);
    s.bombs.push({ mesh, lx, lz, vy: 0, age: 0 });
  }

  _detonate(bomb, groundY) {
    bomb.mesh.position.y = groundY + CARPET.blastHeight;
    this.ctx.events.emit('explosion', {
      position: bomb.mesh.position,
      radius: CARPET.radius,
      damage: CARPET.damage,
      source: this._player ?? (this._player = this.ctx.peek('player')),
    });
    bomb.mesh.removeFromParent();
  }

  clearStrike() {
    for (const s of this.active) {
      s.plane.removeFromParent();
      for (const b of s.bombs) b.mesh.removeFromParent();
    }
    this.active.length = 0;
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this.clearStrike();
    for (const key of Object.keys(GEO)) GEO[key].dispose();
  }
}
