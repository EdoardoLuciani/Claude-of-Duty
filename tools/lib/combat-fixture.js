// Browser E2E placement only: exact clear lanes, not snapping authored offsets
// into walls and then mistaking a setup failure for a combat failure.
export function combatLane(ai, world, physics, slots) {
  const eye = world.spawnPoints[0].position.clone(), target = eye.clone();
  for (const anchor of world.spawnPoints) for (let turn = 0; turn < 32; turn++) {
    const angle = turn * Math.PI / 16, fx = Math.sin(angle), fz = Math.cos(angle);
    const positions = [];
    let component;
    for (const [distance, lateral] of [[0, 0], ...slots]) {
      const x = anchor.position.x + fx * distance - fz * lateral;
      const z = anchor.position.z + fz * distance + fx * lateral;
      const p = eye.clone();
      const ref = ai.grid.sampleGround(x, z, anchor.position.y, p);
      if (!ref || Math.hypot(p.x - x, p.z - z) > .1 || !ai.grid.canStand(p)) break;
      const next = ai.grid.components.get(ref);
      if (positions.length && next !== component) break;
      component = next;
      target.copy(p); target.y += 1.2;
      if (positions.length && !physics.lineOfSight(eye, target, physics.MASK.SIGHT)) break;
      positions.push(p);
      if (positions.length === 1) { eye.copy(p); eye.y += 1.2; }
    }
    if (positions.length === slots.length + 1) return { positions, fx, fz };
  }
  throw new Error('no physically clear combat lane for the requested fixture');
}
