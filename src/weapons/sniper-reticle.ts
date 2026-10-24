import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';

/** P4FL-inspired game adaptation, not the manufacturer's 1-mrad reticle.
 * The game's ~20° ADS view is much wider than the real PM II's sight picture.
 * Use true 5-mrad major / 2.5-mrad minor intervals rather than mislabelling an
 * enlarged 1-mrad pattern. Omit the reference's auxiliary rangefinder.
 * Reference: Schmidt-Bender-Datasheet-P4FL-FFP-5-25x56-PMII, rev. 00.
 */
export const SNIPER_RETICLE = {
  majorMrad: 5,
  minorMrad: 2.5,
  postStartMrad: 25,
  fineWidthMrad: 0.2,
  postWidthMrad: 2,
  majorLengthMrad: 2,
  minorLengthMrad: 1,
  minLinePixels: 1.1,
  apertureRadius: 0.72,
} as const;

/** Tangent-plane projection: NDC per mrad, from the live world camera's vFOV.
 * Linear mil graduations use the usual small-angle reticle approximation.
 */
export function sniperMradScale(verticalFovDegrees: number, zoom = 1): number {
  return (0.001 * zoom) / Math.tan((verticalFovDegrees * Math.PI) / 360);
}

/** Analytic coverage in angular coordinates; derivatives track render resolution
 * (including DPR/render scale). Minimum stroke width is a readability exception,
 * never a change to graduation spacing. No texture or per-frame geometry.
 */
export function sniperReticleCoverage(p: Node<'vec2'>): Node<'float'> {
  const s = SNIPER_RETICLE;
  const pixel = TSL.fwidth(p.y).max(0.0001).toVar();
  const fine = TSL.max(s.fineWidthMrad / 2, pixel.mul(s.minLinePixels / 2));
  const post = TSL.max(s.postWidthMrad / 2, fine);
  const x = TSL.abs(p.x);
  const y = TSL.abs(p.y);
  const horizontal = y.sub(x.greaterThanEqual(s.postStartMrad).select(post, fine));
  // P4FL-style heavy posts left/right/up; the lower fine stadia stay open.
  const vertical = x.sub(p.y.greaterThanEqual(s.postStartMrad).select(post, fine));
  const ticks = (along: Node<'float'>, across: Node<'float'>, lower: boolean) => {
    const nearest = TSL.round(along.div(s.minorMrad)).mul(s.minorMrad);
    const major = TSL.abs(TSL.mod(nearest, s.majorMrad)).lessThan(0.01);
    const halfLength = major.select(s.majorLengthMrad / 2, s.minorLengthMrad / 2);
    const distance = TSL.max(
      TSL.abs(along.sub(nearest)).sub(fine),
      TSL.abs(across).sub(halfLength.max(fine))
    );
    const withinPosts = lower
      ? nearest.lessThan(s.postStartMrad)
      : TSL.abs(nearest).lessThan(s.postStartMrad);
    const enabled = TSL.abs(nearest).greaterThanEqual(s.majorMrad).and(withinPosts);
    return enabled.select(distance, TSL.float(1e6));
  };
  const distance = TSL.min(
    TSL.min(horizontal, vertical),
    TSL.min(ticks(p.x, p.y, false), ticks(p.y, p.x, true))
  );
  return TSL.smoothstep(pixel.mul(-0.5), pixel.mul(0.5), distance).oneMinus();
}
