/**
 * Al-Maktaba drop sites, level space, metres. Y is the walkable slab.
 *
 * Reachable rooms, upper floors, one terrace, roofs, and the west courtyard.
 * Not street doorways. Metadata writes these to WORLD.MARKERS.INTEL.
 */
export const INTEL_POINTS = [
  { id: 'w5-living', x: -10.4, y: 0.16, z: 34.2, tag: 'W5 living' },
  { id: 'w5-f1', x: -13.6, y: 3.45, z: 34.8, tag: 'W5 upper' },
  { id: 'w1-roof', x: -16.4, y: 6.5, z: 12.6, tag: 'W1 roof' },
  { id: 'w2-living', x: -18.4, y: 0.42, z: 1.8, tag: 'W2 living' },
  { id: 'w2-f1', x: -17.6, y: 3.45, z: 2.6, tag: 'W2 upper' },
  { id: 'w2-terrace', x: -7.8, y: 3.45, z: 2.2, tag: 'W2 terrace' },
  { id: 'w3-f1', x: -10, y: 3.45, z: -16.8, tag: 'W3 upper' },
  { id: 'w4-workshop', x: -9.4, y: 0.16, z: -30.2, tag: 'W4 workshop' },
  { id: 'e5-living', x: 15.2, y: 0.16, z: 35.6, tag: 'E5 living' },
  { id: 'e1-f2', x: 19, y: 6.5, z: 20.4, tag: 'E1 upper' },
  { id: 'e1-roof', x: 19.4, y: 9.55, z: 11.2, tag: 'E1 roof' },
  { id: 'e2-roof', x: 15.2, y: 9.55, z: -7.4, tag: 'E2 roof' },
  { id: 'e4-f2', x: 12.6, y: 6.5, z: -35.4, tag: 'E4 upper' },
  { id: 'courtyard-west', x: -18, y: 0.06, z: 7.6, tag: 'west courtyard' },
];
