import assert from 'node:assert/strict';

import { INFANTRY } from '../../src/ai/capabilities.ts';
import { NAV_PROFILE } from '../../src/ai/nav-format.ts';
import { VARIANTS } from '../../src/ai/soldier.ts';
import { CharacterController } from '../../src/physics/character.ts';

export function ladderProfiles() {
  return [
    { name: 'NAV_PROFILE', ...NAV_PROFILE },
    ...Object.entries(VARIANTS).map(([name, v]) => ({
      name,
      radius: INFANTRY.radius * v.scale,
      height: INFANTRY.height * v.scale,
    })),
  ];
}
export function ladderController(world, descriptor, direction, profile) {
  return new CharacterController(world, {
    ...profile,
    position: descriptor.points[direction === 'up' ? 0 : 3],
    stepHeight: INFANTRY.stepHeight,
    snapDistance: 0.32,
    slopeLimit: INFANTRY.slopeRadians,
  });
}
export function assertLadderRestored(controller) {
  assert.equal(controller.stepHeight, INFANTRY.stepHeight);
  assert.equal(controller.snapDistance, 0.32);
}
export const ladderCursor = () => ({ segment: 0, distance: 0, pendingTime: 0, moves: 0 });
export const directedPoints = (descriptor, direction) =>
  direction === 'up' ? descriptor.points : descriptor.points.toReversed();
export function segmentSpan(descriptor, direction, segment) {
  const points = directedPoints(descriptor, direction),
    a = points[segment],
    b = points[segment + 1];
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
export function reverseCursor(descriptor, cursor) {
  return {
    segment: 1,
    distance: descriptor.points[2].y - descriptor.points[1].y - cursor.distance,
    pendingTime: 0,
    moves: 0,
  };
}
