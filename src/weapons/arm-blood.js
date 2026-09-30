import * as THREE from 'three';

// Cylindrical bind-space stains, in turns around the sleeve and metres from
// the wrist. Fixed placement keeps captures reproducible without consuming RNG.
const STAINS = [
  [.10, .095, .085, .040], [.17, .145, .065, .060],
  [.42, .080, .100, .028], [.51, .205, .080, .070],
  [.72, .125, .110, .050], [.87, .250, .075, .065],
  [.04, .330, .070, .060], [.34, .390, .090, .055],
  [.65, .470, .080, .075], [.91, .545, .090, .045],
  [.28, .245, .018, .009], [.61, .315, .025, .012],
  [.80, .365, .020, .008], [.22, .525, .023, .011],
];
const WIDTH = 128, HEIGHT = 256, LENGTH = .64;

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** One small shared mask, generated at boot, never repainted/uploaded on hits. */
export function createArmBlood() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    const z = (y + .5) / HEIGHT * LENGTH;
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + .5) / WIDTH;
      const angle = u * Math.PI * 2;
      // Periodic ragged edges and streaks, continuous across the cylinder seam.
      const warp = .16 * Math.sin(angle * 13 + z * 183) +
        .09 * Math.sin(angle * 29 - z * 317);
      let mask = 0;
      for (const [cu, cz, ru, rz] of STAINS) {
        const du = Math.abs(u - cu);
        const dx = Math.min(du, 1 - du) / ru;
        const dz = (z - cz) / rz;
        const radius = Math.hypot(dx, dz) + warp;
        mask = Math.max(mask, 1 - smooth(.55, 1.12, radius));
      }
      // Soaked cloth remains mottled, with clean fabric between localized marks.
      const grain = .80 + .12 * Math.sin(angle * 47 + z * 571) * Math.sin(z * 913);
      mask *= grain * smooth(.025, .045, z) * (1 - smooth(.60, LENGTH, z));
      const i = (y * WIDTH + x) * 4;
      data[i] = Math.round(mask * 255);
      data[i + 1] = data[i + 2] = data[i];
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT);
  texture.name = 'arm-blood-mask';
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const amount = { value: 0 };
  const mask = { value: texture };
  return {
    texture,
    amount,
    setHealthFraction(fraction) {
      if (Number.isFinite(fraction)) amount.value = 1 - Math.max(0, Math.min(1, fraction));
    },
    decorate(material) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.armBloodAmount = amount;
        shader.uniforms.armBloodMask = mask;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
#include <common>
attribute vec3 armBloodPosition;
varying vec3 vArmBloodPosition;
`).replace('#include <begin_vertex>', `
#include <begin_vertex>
vArmBloodPosition = armBloodPosition;
`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
#include <common>
uniform float armBloodAmount;
uniform sampler2D armBloodMask;
varying vec3 vArmBloodPosition;
`).replace('#include <map_fragment>', `
#include <map_fragment>
vec2 bloodUv = vec2(atan(vArmBloodPosition.y, vArmBloodPosition.x) / 6.28318530718 + 0.5,
                    vArmBloodPosition.z / ${LENGTH});
float blood = texture2D(armBloodMask, bloodUv).r * armBloodAmount;
// Keep authored weave, normal and AO; only soaked patches change albedo/roughness.
vec3 bloodColor = vec3(0.050, 0.002, 0.001) * clamp(dot(diffuseColor.rgb, vec3(10.0)), 0.70, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, bloodColor, blood);
`).replace('#include <roughnessmap_fragment>', `
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.64, blood);
`);
      };
      // Same shader at full health and injured: no mid-combat permutations.
      material.customProgramCacheKey = () => 'arm-blood-v1';
    },
    dispose() { texture.dispose(); },
  };
}

/** Separate bind coordinates survive skinning and do not disturb either UV set. */
export function addArmBloodCoordinates(geometry, source, side) {
  const positions = source.geometry.getAttribute('position').clone();
  positions.applyMatrix4(source.matrixWorld);
  // Offset the right arm's pattern rather than repeat an identical pair of marks.
  if (side > 0) {
    const c = Math.cos(.9), s = Math.sin(.9);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i);
      positions.setXY(i, c * x - s * y, s * x + c * y);
    }
  }
  geometry.setAttribute('armBloodPosition', positions);
}
