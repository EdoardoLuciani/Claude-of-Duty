import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Offline spent 12g, in the casing pool's 45 mm / 4.95 mm reference basis.
 * The event supplies the actual 70 mm / 11.05 mm dimensions. Split vertices
 * keep plastic/metal PBR discontinuous without material groups or extra draws.
 * Red matches tools/blender/m590.py; unlike the insert hull the mouth is open.
 */
export function buildSpentHull() {
  const part = (profile, color, metalness, roughness) => {
    const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 32);
    const pos = geo.getAttribute('position'), colors = [], pbr = [];
    for (let i = 0; i < pos.count; i++) {
      // Small authored drawing/scuff variation, not a runtime texture bake.
      const mark = Math.sin(i * 13.7) * .025;
      colors.push(...color.map(c => c * (1 + mark)));
      pbr.push(metalness, roughness + mark);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('_shellpbr', new THREE.Float32BufferAttribute(pbr, 2));
    geo.scale(.00495 / .01105, .045 / .07, .00495 / .01105);
    geo.translate(0, -.0225, 0);
    return geo;
  };
  const head = part([[0, 0], [.01105, 0], [.01105, .002], [.0096, .002], [.0096, .0035], [.010, .004], [.010, .012], [0, .012]], [.48, .29, .09], 1, .36);
  const plastic = part([[0, .012], [.00906, .012], [.00906, .07], [.0083, .07], [.0083, .013], [0, .013]], [.28, .032, .019], 0, .62);
  const geometry = mergeGeometries([head, plastic]);
  head.dispose(); plastic.dispose();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name: 'spent12g-authoring', vertexColors: true }));
  mesh.name = 'spent12g';
  return mesh;
}
