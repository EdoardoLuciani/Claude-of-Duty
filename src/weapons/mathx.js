/**
 * Deterministic math kit for the viewmodel rig.
 *
 * Canonical implementations live in src/core/math.js and src/core/noise.js
 * (shared, lead-owned — any subsystem may import them). This file re-exports
 * them so the weapons subsystem keeps its stable local import path.
 *
 * The viewmodel's semi-implicit spring is `SpringEuler` upstream; it is
 * re-exported under the historical name `Spring` here.
 */

export {
  TAU,
  DEG,
  clamp,
  clamp01,
  lerp,
  smoothstep,
  smootherstep,
  easeOutBack,
  easeOutCubic,
  easeInCubic,
  easeInOutSine,
  damp,
  wrapPi,
  SpringEuler as Spring,
  Spring3,
} from '../core/math.js';

export { Noise1 } from '../core/noise.js';
