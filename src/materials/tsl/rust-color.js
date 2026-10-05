import { Fn, mix, smoothstep } from 'three/tsl';
import { authoredColor } from '../color-tsl.js';

// Young orange bloom, mature dark oxide and powdery high-grain edges.
export const rustColor = Fn(([age, grain]) => {
  const young = authoredColor(0.560, 0.290, 0.110);
  const middle = authoredColor(0.380, 0.180, 0.085);
  const mature = authoredColor(0.190, 0.100, 0.060);
  const powder = authoredColor(0.640, 0.400, 0.190);
  const c = mix(young, middle, smoothstep(0.15, 0.6, age)).toVar();
  c.assign(mix(c, mature, smoothstep(0.55, 1, age)));
  c.assign(mix(c, powder, smoothstep(0.55, 0.95, grain).mul(0.45)));
  return c.mul(grain.mul(0.36).add(0.82));
});
