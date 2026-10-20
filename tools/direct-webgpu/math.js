// Column-major, double-precision CPU math; GPU publication explicitly rounds to f32.
export function identity(out) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}
export function multiply(out, a, b) {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
  return out;
}
export function inverseAffine(out, a) {
  const a00 = a[0],
    a01 = a[4],
    a02 = a[8],
    a10 = a[1],
    a11 = a[5],
    a12 = a[9],
    a20 = a[2],
    a21 = a[6],
    a22 = a[10];
  const c00 = a11 * a22 - a12 * a21,
    c01 = a02 * a21 - a01 * a22,
    c02 = a01 * a12 - a02 * a11;
  const d = a00 * c00 + a10 * c01 + a20 * c02;
  if (d === 0) {
    out.fill(0);
    return out;
  }
  out[0] = c00 / d;
  out[4] = c01 / d;
  out[8] = c02 / d;
  out[1] = (a12 * a20 - a10 * a22) / d;
  out[5] = (a00 * a22 - a02 * a20) / d;
  out[9] = (a02 * a10 - a00 * a12) / d;
  out[2] = (a10 * a21 - a11 * a20) / d;
  out[6] = (a01 * a20 - a00 * a21) / d;
  out[10] = (a00 * a11 - a01 * a10) / d;
  out[3] = out[7] = out[11] = 0;
  out[15] = 1;
  for (let r = 0; r < 3; r++)
    out[12 + r] = -(out[r] * a[12] + out[4 + r] * a[13] + out[8 + r] * a[14]);
  return out;
}
export function lookAtWorld(eye, target) {
  const z = eye.map((v, i) => v - target[i]);
  let l = Math.hypot(...z);
  for (let i = 0; i < 3; i++) z[i] /= l;
  const x = [z[2], 0, -z[0]];
  l = Math.hypot(...x);
  for (let i = 0; i < 3; i++) x[i] /= l;
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new Float64Array([...x, 0, ...y, 0, ...z, 0, ...eye, 1]);
}
export function ortho(extent, near = 0.1, far = 300) {
  const a = identity(new Float64Array(16));
  a[0] = a[5] = 1 / extent;
  a[10] = -1 / (far - near);
  a[14] = -near / (far - near);
  return a;
}
export function planes(matrix, out) {
  for (let p = 0; p < 6; p++) {
    const axis = p >> 1,
      sign = p % 2 === 0 ? 1 : -1;
    for (let c = 0; c < 4; c++)
      out[p * 4 + c] =
        p === 4 ? matrix[c * 4 + 2] : matrix[c * 4 + 3] + sign * matrix[c * 4 + axis];
    const n = Math.hypot(out[p * 4], out[p * 4 + 1], out[p * 4 + 2]);
    for (let c = 0; c < 4; c++) out[p * 4 + c] /= n;
  }
}
export function intersects(sphere, world, frustum) {
  const [x, y, z, r] = sphere;
  const cx = world[0] * x + world[4] * y + world[8] * z + world[12],
    cy = world[1] * x + world[5] * y + world[9] * z + world[13],
    cz = world[2] * x + world[6] * y + world[10] * z + world[14];
  const radius =
    r *
    Math.sqrt(
      Math.max(
        world[0] ** 2 + world[1] ** 2 + world[2] ** 2,
        world[4] ** 2 + world[5] ** 2 + world[6] ** 2,
        world[8] ** 2 + world[9] ** 2 + world[10] ** 2
      )
    );
  for (let p = 0; p < 24; p += 4)
    if (frustum[p] * cx + frustum[p + 1] * cy + frustum[p + 2] * cz + frustum[p + 3] < -radius)
      return false;
  return true;
}
