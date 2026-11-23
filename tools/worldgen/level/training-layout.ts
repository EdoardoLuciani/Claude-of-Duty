import type { CourseGate } from '../../../src/core/model-metadata.ts';

export const START_HURDLE = { x: -13.5, z: -1.6 } as const;
export const LADDER = {
  kind: 'ladder',
  x: -12.15,
  z: -16.5,
  y0: 1.45,
  y1: 5.2,
  nx: 0,
  nz: 1,
  radius: 0.42,
} as const;

export const BAY_SHIFT = 18;
export const FIRING_LINE = 12;

/** Centers and extents of the flat target faces in world space, facing +Z. */
export const RANGE_TARGETS = [
  { x: 0, y: 1.55, z: 2, width: 0.95, height: 1.1 },
  { x: -5.7, y: 1.55, z: -13, width: 1.25, height: 1.45 },
  { x: 6.2, y: 1.55, z: -28, width: 1.65, height: 1.8 },
  { x: 13, y: 1.55, z: FIRING_LINE - 80, width: 1.9, height: 2.1 },
  { x: 20, y: 1.55, z: FIRING_LINE - 160, width: 2.25, height: 2.4 },
] as const;

const YARD_TARGETS = [
  { label: 'A', x: -9.7, y: 6.65, z: -24, width: 1.0, height: 1.15 },
  { label: 'B', x: -11.0, y: 7.2, z: -31.4, width: 1.05, height: 1.2 },
] as const;
export const TRAINING_TARGETS = [...RANGE_TARGETS, ...YARD_TARGETS];
// The return flight runs toward +Z over the ladder. Gates use the approach side of each lip.
export const RETURN_FLIGHT = {
  x: -12.65,
  window: -21.83,
  sill: 7.2,
  edge: -17.0,
  gap: 3.67,
  rise: 2.0,
} as const;
export const COURSE: CourseGate[] = [
  {
    action: 'vault',
    position: [START_HURDLE.x, 0.45, START_HURDLE.z],
    radius: 1.6,
    hint: 'Vault the start hurdle',
  },
  {
    action: 'climb',
    position: [LADDER.x, LADDER.y1 - 0.4, LADDER.z],
    radius: 0.65,
    hint: 'Follow the trestles up the ladder',
  },
  { action: 'A', position: [-12.55, 5.2, -15.15], radius: 1.55, hint: 'Hit A from the lookout' },
  {
    action: 'crouch',
    position: [-15.5, 5.8, -25.9],
    radius: 1.15,
    hint: 'Jump left, cross the beam and crouch under the roof',
  },
  {
    action: 'mantle',
    position: [-12.65, 3.6, -26.5],
    radius: 1.5,
    hint: 'Drop right, turn back. Hold jump into the first ledge',
  },
  {
    action: 'mantle',
    position: [-12.65, 4.85, -24.2],
    radius: 1.5,
    hint: 'Mantle the striped summit ledge',
  },
  {
    action: 'B',
    position: [-12.65, 6.0, -22.9],
    radius: 1.3,
    hint: 'Turn around and hit B from the summit',
  },
  {
    action: 'mantle',
    position: [RETURN_FLIGHT.x, 6.3, RETURN_FLIGHT.window - 0.55],
    radius: 1.0,
    hint: 'Turn toward the pavilion. Mantle through the window',
  },
  {
    action: 'mantle',
    position: [
      RETURN_FLIGHT.x,
      RETURN_FLIGHT.sill + 0.36,
      RETURN_FLIGHT.edge + RETURN_FLIGHT.gap - 0.55,
    ],
    radius: 0.88,
    hint: 'Sprint to the stripe. Jump there and hold jump to catch the lip',
  },
];

export const TRAINING_STATION = { x: -2.55, z: 12.5 } as const;
