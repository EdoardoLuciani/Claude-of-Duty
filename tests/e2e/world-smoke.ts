#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { WorldSystem } from '../../src/world/index.ts';
import { ensureDevServer, launchChromium, stopDevServer } from '../../tools/lib/browser-harness.ts';
import { waitForGame } from '../../tools/lib/native-render.ts';

const port = Number(process.env.PORT ?? 5173);
const server = await ensureDevServer({ port });
const browser = await launchChromium({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors: string[] = [];
page.on('pageerror', (error): void => {
  errors.push(error.message);
});
page.on('console', (message): void => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await waitForGame(page, { timeout: 90000 });
  const expected: unknown = JSON.parse(
    readFileSync(new URL('../../public/models/world/level.json', import.meta.url), 'utf8')
  );
  const assets = await page.evaluate(async (): Promise<unknown> => {
    const engine = window.__ENGINE__;
    if (!engine) throw Error('engine not ready');
    return (await engine.ctx.get('models').worldPrefetch).meta.assets;
  });
  assert(expected && typeof expected === 'object' && 'assets' in expected);
  assert.deepEqual(assets, expected.assets, 'world smoke must exercise this checkout’s assets');
  interface TraversalResult {
    name: string;
    progress: number;
    passed: boolean;
  }
  interface SmokeResult {
    stats: WorldSystem['stats'];
    physicsTris: number;
    buildings: number;
    bulbs: number;
    lamps: number;
    spawns: { tag: string; ground: number; delta: number }[];
    roundTripError: number;
    enemySpawns: { pickFail: number; pickUnder: number };
    doorTraversal: TraversalResult[];
    aiOpenings: { name: string; walkable: boolean; expected: boolean }[];
  }
  const result = await page.evaluate((): SmokeResult => {
    const engine = window.__ENGINE__;
    if (!engine) throw Error('engine not ready');
    const world = engine.ctx.get('world');
    const physics = engine.ctx.get('physics');
    const spawns = world.spawnPoints.map(
      (spawn): { tag: string; ground: number; delta: number } => {
        const ground = physics.groundHeight(
          spawn.position.x,
          spawn.position.z,
          spawn.position.y + 0.5
        );
        return {
          tag: spawn.tag,
          ground,
          delta: Math.abs(ground - spawn.position.y),
        };
      }
    );
    const level = world.worldToLevel(12.5, 3.25, -8.75);
    const roundTrip = world.levelToWorld(level.x, level.y, level.z);

    // Wave jitter used to land inside the gate/stalls and fall through the street.
    const ai = engine.ctx.get('ai');
    let pickFail = 0,
      pickUnder = 0;
    for (const spawn of world.spawnPoints) {
      for (let i = 0; i < 24; i++) {
        const p = ai._pickSpawnNear(spawn);
        if (!p) pickFail++;
        else if (p.y < -0.5) pickUnder++;
      }
    }

    const traverse = (
      name: string,
      fromLevel: [number, number, number],
      toLevel: [number, number, number]
    ): TraversalResult => {
      const from = world.levelToWorld(...fromLevel);
      const to = world.levelToWorld(...toLevel);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = Math.hypot(dx, dz);
      const ux = dx / length;
      const uz = dz / length;
      const ground = physics.groundHeight(from.x, from.z, from.y + 2);
      const character = physics.createCharacter({
        radius: 0.32,
        height: 1.78,
        stepHeight: 0.42,
        position: { x: from.x, y: ground + 0.01, z: from.z },
      });
      // Initialize ground state exactly as live controllers do.
      character.teleport(from.x, ground + 0.01, from.z);
      let progress = 0;
      const required = length - 0.25;
      for (let i = 0; i < 100 && progress < required; i++) {
        character.velocity.x = ux * 3;
        character.velocity.y = -0.24;
        character.velocity.z = uz * 3;
        character.move(ux * 0.03, -0.002, uz * 0.03);
        progress = (character.position.x - from.x) * ux + (character.position.z - from.z) * uz;
      }
      physics.removeCharacter(character);
      return { name, progress, passed: progress >= required };
    };
    interface Opening {
      kind: string;
      side: number;
      w: number;
      from: [number, number, number];
      to: [number, number, number];
    }
    function coordinates(value: unknown): [number, number, number] {
      if (!Array.isArray(value) || value.length !== 3) throw Error('invalid opening coordinates');
      const values: unknown[] = value;
      const [x, y, z] = values;
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number')
        throw Error('invalid opening coordinates');
      return [x, y, z];
    }
    function readBuilding(value: unknown): { spec: { id: string }; traversable: Opening[] } {
      if (
        !value ||
        typeof value !== 'object' ||
        !('spec' in value) ||
        !value.spec ||
        typeof value.spec !== 'object' ||
        !('id' in value.spec) ||
        typeof value.spec.id !== 'string' ||
        !('traversable' in value) ||
        !Array.isArray(value.traversable)
      )
        throw Error('invalid traversal metadata');
      const entries: unknown[] = value.traversable;
      const traversable = entries.map((entry): Opening => {
        if (
          !entry ||
          typeof entry !== 'object' ||
          !('kind' in entry) ||
          typeof entry.kind !== 'string' ||
          !('side' in entry) ||
          typeof entry.side !== 'number' ||
          !('w' in entry) ||
          typeof entry.w !== 'number' ||
          !('from' in entry) ||
          !('to' in entry)
        )
          throw Error('invalid opening metadata');
        return {
          kind: entry.kind,
          side: entry.side,
          w: entry.w,
          from: coordinates(entry.from),
          to: coordinates(entry.to),
        };
      });
      return { spec: { id: value.spec.id }, traversable };
    }
    if (!world.buildings || !world.bulbs || !world.lamps || !ai.grid)
      throw Error('world not ready');
    const doorTraversal: TraversalResult[] = [];
    const aiOpenings: SmokeResult['aiOpenings'] = [];
    for (const candidate of world.buildings) {
      const building = readBuilding(candidate);
      for (let index = 0; index < building.traversable.length; index++) {
        const opening = building.traversable[index];
        const offsetCap = opening.kind === 'door' ? 0.1 : 0.25;
        const maxOffset = Math.max(0, Math.min(offsetCap, (opening.w - 0.64) / 2 - 0.08));
        const offsets = maxOffset > 0.08 ? [-maxOffset, 0, maxOffset] : [0];
        for (const offset of offsets) {
          const from: [number, number, number] = [...opening.from];
          const to: [number, number, number] = [...opening.to];
          const axis = opening.side === 0 || opening.side === 2 ? 0 : 2;
          from[axis] += offset;
          to[axis] += offset;
          const label = `${building.spec.id} ${opening.kind} ${index} ${offset.toFixed(2)}`;
          doorTraversal.push(traverse(`${label} in`, from, to));
          doorTraversal.push(traverse(`${label} out`, to, from));
        }
        const inside = world.levelToWorld(...opening.to);
        // Stay on the authored floor: the old +2 m ray incorrectly selected the
        // W2 shop counter top instead of testing its obstructed ground target.
        const ground = physics.groundHeight(inside.x, inside.z, inside.y + 0.5);
        inside.y = ground;
        const walkable = !!ai.grid.project(inside, inside, null, true);
        const expected = !(building.spec.id === 'W2' && opening.kind === 'shop' && index === 0);
        aiOpenings.push({
          name: `${building.spec.id} ${opening.kind} ${index}`,
          walkable,
          expected,
        });
      }
    }

    return {
      stats: world.stats,
      physicsTris: physics.triangleCount,
      buildings: world.buildings.length,
      bulbs: world.bulbs.length,
      lamps: world.lamps.length,
      spawns,
      roundTripError: Math.hypot(roundTrip.x - 12.5, roundTrip.y - 3.25, roundTrip.z + 8.75),
      enemySpawns: { pickFail, pickUnder },
      doorTraversal,
      aiOpenings,
    };
  });

  const failures = [...errors];
  // Stable authored gate-skirt seeds reroll only local debris: 7705 -> 7706.
  // Keep an exact budget so unrelated placement/batching changes still fail.
  if (result.stats.drawCalls !== 174 || result.stats.instances !== 7706)
    failures.push('world draw/instance budget changed');
  if (result.physicsTris < 300000 || result.physicsTris > 340000) {
    failures.push(`physics triangle budget changed: ${result.physicsTris}`);
  }
  if (result.buildings !== 20 || result.bulbs !== 15 || result.lamps !== 5)
    failures.push('manifest marker counts changed');
  if (result.roundTripError > 1e-5)
    failures.push(`level transform round-trip error ${result.roundTripError}`);
  for (const spawn of result.spawns) {
    if (!Number.isFinite(spawn.ground) || spawn.delta > 0.5) {
      failures.push(`spawn ${spawn.tag} has invalid ground/collision`);
    }
  }
  const es = result.enemySpawns;
  if (es.pickFail > 8) failures.push(`enemy spawn picker failed ${es.pickFail} times`);
  if (es.pickUnder) failures.push(`enemy spawn picker returned ${es.pickUnder} underground points`);
  for (const door of result.doorTraversal) {
    if (!door.passed) failures.push(`${door.name} blocked at ${door.progress.toFixed(2)} m`);
  }
  for (const opening of result.aiOpenings) {
    if (opening.walkable !== opening.expected)
      failures.push(
        `${opening.name} physical attachment was ${opening.walkable}, expected ${opening.expected}`
      );
  }
  console.log(JSON.stringify({ ok: failures.length === 0, ...result, errors: failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
  stopDevServer(server);
}
