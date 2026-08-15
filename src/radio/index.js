import * as THREE from 'three';

/**
 * RADIO — the accessory strike system.
 *
 * Owns the carpet-bomb strike itself: the bomber, the falling bombs and the
 * blast chain. The radio item (equipping it, the request list, the charge
 * economy) lives in `weapons` — see WeaponSystem._updateRadio. This subsystem
 * is the "dial 1" outcome: a heavy bomber crosses the whole playable area at
 * altitude and lays down five parallel bomb lines, one bomb line every
 * DROP_STEP metres, each blast big enough to one-shot anything in the open.
 *
 * Damage flows through the canonical `explosion` event exactly like a grenade
 * blast, so the player, every enemy, the fx, audio and the HUD all react to
 * it with zero new plumbing: player/index.js applies falloff + LOS to the
 * player, ai/index.js applies the blast to every agent, fx spawns the
 * fireball and audio plays the boom. A strike therefore hurts the caller too
 * if they are caught in the open — that is the point.
 *
 * PUBLIC API — `const radio = ctx.get('radio')`
 *   radio.callStrike()   start one strike; no-op while one is airborne
 *   radio.active         strikes in flight (diagnostics/tests)
 *
 * Events emitted: radio:strike { position } (UI shows the warning banner).
 *
 * The flight path is derived from the world bounds and the street axis (the
 * spawn forward): the bomber flies the full extent of the map so the bomb
 * lines cover the street, its plazas and the flanking open ground.
 */

/** Every tuning number for a strike. */
export const CARPET = {
  planeSpeed: 40,          // m/s along the flight path
  altitude: 55,            // m the bomber flies above the ground
  dropStep: 20,            // m between bomb lines along the path
  lateral: [-14, -7, 0, 7, 14], // m offsets of the five bomb streams
  radius: 20,              // m blast radius per bomb (the grenade is 10)
  damage: 1400,            // one-shot even a fully armoured target mid-blast
};

const BOMB_FALL = 9.8;   // m/s²
const BOMB_MAX_AGE = 20; // s before an un-detonated bomb is retired
const ALTITUDE = CARPET.altitude;
/** Horizontal distance a bomb travels while falling (speed × fall time). */
const LEAD = CARPET.planeSpeed * Math.sqrt((2 * ALTITUDE) / BOMB_FALL);

/** Shared materials for the bomber and its bombs. */
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

/** A heavy bomber: 18 m long, 22 m wingspan, twin props, nose-down -Z. */
function bomberMesh() {
  const g = new THREE.Group();
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 12.5, 12), matBody);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 3.2, 12), matDark);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -7.85;
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 10), matDark);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 7.05;
  g.add(tail);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(22, 0.16, 2.8), matBody);
  wing.position.set(0, 0.35, -0.6);
  g.add(wing);
  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 1.5), matBody);
  tailWing.position.set(0, 0.4, 5.6);
  g.add(tailWing);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 1.8), matBody);
  fin.position.set(0, 1.7, 5.4);
  g.add(fin);
  g.userData.props = [];
  for (const sx of [-6.5, 6.5]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 2.6, 12), matDark);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(sx, 0.32, -3.8);
    g.add(eng);
    const prop = new THREE.Mesh(new THREE.CircleGeometry(0.95, 14), matProp);
    prop.position.set(sx, 0.32, -5.1);
    g.add(prop);
    g.userData.props.push(prop);
  }
  return g;
}

/** One bomb: 1.1 m of ordnance with a red tail marker so it reads at altitude. */
function bombMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8), matBomb);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), matBomb);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.8;
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), matBomb);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.72;
  g.add(tail);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), matGlow);
  glow.position.z = -0.66;
  g.add(glow);
  // Nose-down on release: +Z (nose) maps to -Y under this pitch.
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
    this._off = [];
    this._off.push(ctx.events.on('game:restart', () => this._clear()));
  }

  /* ==================================================================== */
  /*  strike                                                              */
  /* ==================================================================== */

  /**
   * Call in a carpet bomb. The bomber spawns immediately at one end of the
   * map and starts its crossing; the first bomb lands a few seconds later,
   * so the player has a window to get under cover. No-op while a strike is
   * already airborne (one bomber at a time keeps the sky legible).
   */
  callStrike() {
    if (this.active.length) return false;
    const bounds = this._world?.bounds;
    if (!bounds) return false;

    // The street axis from the first spawn's forward — the map is a rotated
    // street, so the bomber runs its full length.
    const sp = this._world.spawn?.(0);
    const fx = sp?.forward?.[0] ?? 0.832;
    const fz = sp?.forward?.[2] ?? 0.832;
    const fl = Math.hypot(fx, fz) || 1;
    const dx = fx / fl;
    const dz = fz / fl;

    const min = bounds.min;
    const max = bounds.max;
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    // Extent of the (axis-aligned) bounds along the flight axis.
    const corners = [
      min.x * dx + min.z * dz,
      max.x * dx + min.z * dz,
      min.x * dx + max.z * dz,
      max.x * dx + max.z * dz,
    ];
    const tMin = Math.min(...corners);
    const tMax = Math.max(...corners);
    const startT = tMin - LEAD;

    // Bomb lines: impacts every dropStep metres along the whole extent; the
    // bombs carry the plane's horizontal speed, so each is released `LEAD`
    // metres before its impact point. `t` is the travel distance from spawn
    // at which the line drops.
    const drops = [];
    for (let t = tMin; t <= tMax + 1e-3; t += CARPET.dropStep) {
      drops.push({ t: t - tMin });
    }

    const start = new THREE.Vector3(cx + dx * startT, ALTITUDE, cz + dz * startT);
    const dir = new THREE.Vector3(dx, 0, dz);
    const plane = bomberMesh();
    plane.position.copy(start);
    plane.rotation.y = Math.atan2(-dx, -dz);
    plane.rotation.z = 0.05; // a lazy bank for life
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
    if (!this.active.length) return;
    const physics = this._physics ?? (this._physics = this.ctx.peek('physics'));
    const audio = this._audio ?? (this._audio = this.ctx.peek('audio'));

    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.travel += s.speed * dt;

      // Fly the bomber along the path.
      s.plane.position.copy(s.start).addScaledVector(s.dir, s.travel);
      s.plane.position.y = ALTITUDE;
      s.plane.rotation.z = 0.05 + Math.sin(s.travel * 0.11) * 0.035;
      for (const p of s.plane.userData.props ?? []) p.rotation.z += dt * 26;

      // Drop the next bomb line when the bomber reaches its release point.
      while (s.dropIdx < s.drops.length && s.travel >= s.drops[s.dropIdx].t) {
        s.dropIdx++;
        for (const off of CARPET.lateral) this._dropBomb(s, off);
      }
      // Repeat the flyover drone around the middle of the bomb run.
      const mid = s.drops[Math.floor(s.drops.length / 2)];
      if (!s.engineRepeat && mid && s.travel >= mid.t) {
        s.engineRepeat = true;
        audio?.play?.('ambient', s.plane.position, { which: 'heli', level: 1.2 });
      }

      // Fall the bombs; the first to touch down detonate.
      for (let b = s.bombs.length - 1; b >= 0; b--) {
        const bomb = s.bombs[b];
        bomb.age += dt;
        bomb.vy -= BOMB_FALL * dt;
        bomb.pos.addScaledVector(s.dir, s.speed * dt);
        bomb.pos.y += bomb.vy * dt;
        bomb.mesh.position.copy(bomb.pos);
        bomb.mesh.rotation.z += dt * 2.2; // tumble

        const gy = physics?.groundHeight?.(bomb.pos.x, bomb.pos.z, bomb.pos.y + 2);
        if (bomb.pos.y <= gy || bomb.age > BOMB_MAX_AGE) {
          const groundY = Number.isFinite(gy) ? gy : bomb.pos.y;
          this._detonate(s, bomb, groundY);
          s.bombs.splice(b, 1);
        }
      }

      // The run is over once the bomber is past the map and every bomb hit.
      if (s.travel >= s.drops[s.drops.length - 1].t + LEAD + 30 && s.bombs.length === 0) {
        s.plane.removeFromParent();
        this.active.splice(i, 1);
      }
    }
  }

  _dropBomb(s, lateral) {
    const lx = -s.dir.z * lateral;
    const lz = s.dir.x * lateral;
    const mesh = bombMesh();
    const pos = new THREE.Vector3(
      s.plane.position.x + lx,
      s.plane.position.y,
      s.plane.position.z + lz
    );
    mesh.position.copy(pos);
    this.ctx.scene.add(mesh);
    s.bombs.push({ mesh, pos, vy: 0, age: 0 });
  }

  /** A bomb reached the ground: the blast chain. Bigger than any grenade. */
  _detonate(s, bomb, groundY) {
    bomb.pos.y = groundY;
    this.ctx.events.emit('explosion', {
      position: bomb.pos,
      radius: CARPET.radius,
      damage: CARPET.damage,
      source: this._player ?? (this._player = this.ctx.peek('player')),
    });
    bomb.mesh.removeFromParent();
  }

  _clear() {
    for (const s of this.active) {
      s.plane.removeFromParent();
      for (const b of s.bombs) b.mesh.removeFromParent();
    }
    this.active.length = 0;
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this._clear();
  }
}
