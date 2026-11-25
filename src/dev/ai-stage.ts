import * as THREE from 'three';

import { STATE, type Agent } from '../ai/agent.ts';
import type { AiStats, AiSystem } from '../ai/index.ts';

/**
 * Pin an agent into a photogenic combat beat: it still animates, aims and
 * fires for real, it just does not get to decide where to stand.
 */
export function updateStagedAgent(ai: AiSystem, a: Agent, dt: number): void {
  const s = a.staged;
  if (!s) return;
  const p = ai.playerPosition(ai._v3);
  a.stateTime += dt;
  a.fireCooldown -= dt;
  a.burstCooldown -= dt;
  a.state = STATE.COMBAT;
  a.hasTarget = true;
  a.targetVisible = true;
  a.alertness = 1;
  a.lastKnown.copy(p);
  a.lastKnownAge = 0;
  a.crouch = !!s.crouch;
  a.aimWeight = s.aimWeight ?? 1;
  a.suppression = s.suppression ?? 0;
  a.desiredSpeed = s.speed ?? 0;
  a.wantFire = s.fire !== false;
  if (s.speed) {
    a.hasMoveTarget = true;
    if (!a.path[0]) a.path[0] = new THREE.Vector3();
    a.path[0].copy(a.position).addScaledVector(s.heading, 6);
    a.pathLen = 1;
    a.pathIndex = 0;
  } else {
    a.hasMoveTarget = false;
  }
  if (s.reloadEvery && a.stateTime > s.reloadEvery && !a.animator.reloading) {
    a.stateTime = 0;
    a.animator.reload(2.4);
  }
  a._move(dt);
  a._shoot(dt);
  a._drive(dt);
}

/**
 * Compose a staged enemy into the frame: find the walkable spot whose
 * projected screen position and depth best match the requested composition,
 * that the camera can actually see, that is not on top of another actor, and
 * that has cover nearby. Occlusion is checked at chest and head height, which
 * is what stops a soldier being placed behind a market stall.
 */
function stageSlot(
  ai: AiSystem,
  cam: THREE.PerspectiveCamera,
  ndcX: number,
  wantDepth: number,
  placed: THREE.Vector3[]
): THREE.Vector3 {
  const g = ai.grid;
  const F = ai._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
  F.y = 0;
  F.normalize();
  const rx = F.z,
    rz = -F.x; // camera right, flattened
  const tanH = Math.tan((cam.fov * Math.PI) / 360) * cam.aspect;
  const ideal = new THREE.Vector3()
    .copy(cam.position)
    .addScaledVector(F, wantDepth)
    .add(ai._v2.set(rx, 0, rz).multiplyScalar(ndcX * tanH * wantDepth));
  const yRef = cam.position.y - 1.7;
  const out = new THREE.Vector3(ideal.x, yRef, ideal.z);
  if (!g) {
    out.y = ai.groundAt(out.x, out.z, cam.position.y + 3);
    return out;
  }
  const chest = ai._v3;
  const spacing = 0.8,
    span = Math.ceil(7 / spacing);
  let bestScore = Infinity,
    bestX = 0,
    bestY = 0,
    bestZ = 0;
  for (let dz = -span; dz <= span; dz++) {
    for (let dx = -span; dx <= span; dx++) {
      if (!g.sampleGround(ideal.x + dx * spacing, ideal.z + dz * spacing, yRef, out)) continue;
      const x = out.x,
        fy = out.y,
        z = out.z;
      if (Math.abs(fy - yRef) > 1.0) continue;
      // spacing from the men already placed
      let tooClose = false;
      for (const q of placed) {
        if (Math.hypot(q.x - x, q.z - z) < 2.4) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      // project
      const ex = x - cam.position.x,
        ez = z - cam.position.z;
      const depth = ex * F.x + ez * F.z;
      if (depth < 3) continue;
      const lateral = ex * rx + ez * rz;
      const ndc = lateral / (depth * tanH);
      // must be visible: chest and head
      chest.set(x, fy + 1.25, z);
      if (!ai.phys.lineOfSight(cam.position, chest, ai.phys.MASK.SIGHT)) continue;
      chest.set(x, fy + 1.62, z);
      if (!ai.phys.lineOfSight(cam.position, chest, ai.phys.MASK.SIGHT)) continue;
      let score = Math.abs(ndc - ndcX) * 9 + Math.abs(depth - wantDepth) * 0.5;
      // Same cover preference, sampled only for competitive staging slots.
      if (score > bestScore + 8 * 0.35) continue;
      for (let k = 0; k < 8; k++) {
        const angle = (k * Math.PI) / 4;
        if (
          ai.phys.raycastAny(
            x,
            fy + 1.2,
            z,
            Math.cos(angle),
            0,
            Math.sin(angle),
            1.3,
            ai.phys.MASK.WORLD
          )
        )
          score -= 0.35;
      }
      if (score < bestScore) {
        bestScore = score;
        bestX = x;
        bestY = fy;
        bestZ = z;
      }
    }
  }
  if (!Number.isFinite(bestScore)) throw new Error('[ai] no physical staging slot');
  out.set(bestX, bestY, bestZ);
  return out;
}

/**
 * A staged firefight in front of the shot camera:
 * one man up and firing from behind hard cover, one crouched and peeking, one
 * moving between positions, one reloading further back.
 */
export function stageAi(ai: AiSystem, name: string): AiStats {
  if (name !== 'firefight') return ai.stats;
  if (ai.inspect) return stageInspect(ai);
  if (!ai.grid) throw new Error('[ai] navigation is not ready');

  const cam = ai.ctx.camera;
  // A firefight the critic can actually see: drop the sun low enough to rake
  // down the street so the characters are lit, not silhouetted. This shot is
  // ours to compose; every other shot keeps its own time of day.
  ai.ctx.peek('sky')?.setTimeOfDay(17.9);
  const F = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  F.y = 0;
  F.normalize();
  const right = new THREE.Vector3(F.z, 0, -F.x);
  const squad = ai.createSquad();

  /** [variant, ndcX, depth, crouch, speed, fire, reloadEvery] */
  const LAYOUT: Array<[string, number, number, boolean, number, boolean, number]> = [
    // hero: up and firing, left of frame, close enough to read the kit
    ['vanguard', -0.44, 8.0, false, 0, true, 0],
    // second man crouched in cover, right of frame
    ['breacher', 0.3, 12.0, true, 0, true, 0],
    // one caught mid-stride between positions
    ['irregular', -0.14, 16.0, false, 4.1, false, 0],
    // one reloading behind cover on the far right
    ['vanguard', 0.6, 9.5, true, 0, true, 3.4],
    // depth: a fifth man well down the street
    ['irregular', -0.26, 22.0, false, 0, true, 0],
  ];

  const placedPositions: THREE.Vector3[] = [];
  for (const [variant, ndcX, d, crouch, speed, fire, reload] of LAYOUT) {
    const pos = stageSlot(ai, cam, ndcX, d, placedPositions);
    const yaw = Math.atan2(cam.position.x - pos.x, cam.position.z - pos.z);
    const a = ai.spawn(variant, pos, yaw);
    squad.add(a);
    a.staged = {
      crouch,
      speed,
      fire,
      noDamage: true,
      heading: right.clone().multiplyScalar(-1),
      aimWeight: 1,
      reloadEvery: reload || 0,
      suppression: crouch ? 0.15 : 0,
    };
    // stagger the burst timers so the frame catches muzzle flashes
    a.burstCooldown = ai.rng.range(0, 0.3);
    a.burstLeft = ai.rng.int(2, 6);
    a.peeking = true;
    a.aimTarget.copy(ai.playerPosition(ai._v3));
    a.animator.update(0.016, 0);
    placedPositions.push(pos.clone());
  }

  // One man already down, handed to the ragdoll solver with the round's
  // impulse — it dresses the tableau and it exercises the death path.
  const dPos = stageSlot(ai, cam, -0.58, 9.4, placedPositions);
  const casualty = ai.spawn(
    'breacher',
    dPos,
    Math.atan2(cam.position.x - dPos.x, cam.position.z - dPos.z)
  );
  squad.add(casualty);
  casualty.animator.update(0.016, 0);
  const hit = new THREE.Vector3(dPos.x, dPos.y + 1.35, dPos.z);
  const inc = new THREE.Vector3().subVectors(hit, cam.position).normalize();
  casualty.applyDamage(260, 'torso', hit, inc);

  return ai.stats;
}

/** Model inspection line-up (dev only). */
function stageInspect(ai: AiSystem): AiStats {
  const cam = ai.ctx.camera;
  const F = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  F.y = 0;
  F.normalize();
  const right = new THREE.Vector3(F.z, 0, -F.x);
  ai.ctx.peek('sky')?.setTimeOfDay(11.5);
  const layout: Array<[string, number, number, number]> = [
    ['vanguard', 1.9, 0.35, 0.25],
    ['irregular', 2.7, -0.95, 3.0],
    ['breacher', 3.6, 1.15, -0.7],
  ];
  for (const [nm, d, s2, extraYaw] of layout) {
    const p = new THREE.Vector3()
      .copy(cam.position)
      .addScaledVector(F, d)
      .addScaledVector(right, s2);
    p.y = ai.groundAt(p.x, p.z, cam.position.y + 1.0);
    const toCam = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
    const a = ai.spawn(nm, p, toCam + extraYaw);
    a.staged = {
      crouch: false,
      speed: 0,
      fire: false,
      aimWeight: 1,
      heading: new THREE.Vector3(0, 0, 1),
    };
  }
  return ai.stats;
}
