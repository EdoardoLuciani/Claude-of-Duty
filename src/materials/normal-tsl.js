import { normalize, texture, uv, vec2, vec3 } from 'three/tsl';

/** Tangent-space Sobel normal from the texture forge's linear height channel. */
export function normalFromHeight(height, texel, strength) {
  const coords = uv();
  const h = (x, y) => texture(height, coords.add(vec2(x, y).mul(texel))).r;
  const tl = h(-1, 1), t = h(0, 1), tr = h(1, 1);
  const l = h(-1, 0), r = h(1, 0);
  const bl = h(-1, -1), b = h(0, -1), br = h(1, -1);
  const dx = tr.add(r.mul(2)).add(br).sub(tl.add(l.mul(2)).add(bl)).mul(0.125);
  const dy = tl.add(t.mul(2)).add(tr).sub(bl.add(b.mul(2)).add(br)).mul(0.125);
  return normalize(vec3(dx.div(texel.x).mul(strength).negate(),
    dy.div(texel.y).mul(strength).negate(), 1)).mul(0.5).add(0.5);
}
