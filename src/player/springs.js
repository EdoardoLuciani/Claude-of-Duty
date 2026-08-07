/**
 * Player scalar math + spring integrators.
 *
 * Canonical implementations live in src/core/math.js (shared, lead-owned —
 * any subsystem may import it). This file re-exports them so the player
 * subsystem keeps its stable local import path.
 */

export {
  TAU,
  DEG,
  clamp,
  clamp01,
  lerp,
  smoothstep,
  smootherstep,
  easeOutCubic,
  easeInOutSine,
  approach,
  moveToward,
  angleDelta,
  hashNoise,
  Spring,
  RecoilAxis,
} from '../core/math.js';
