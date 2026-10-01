import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Shared, batched hard-case kit. Only the indicator is emissive; no point lights. */
export function makeKit(materials) {
  const owned = [];
  const surface = (name, color, roughness, metalness) => {
    if (materials) return materials.get(name, { tint: color, scale: 0.55, parallax: 0.001 });
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    owned.push(mat);
    return mat;
  };
  const mats = {
    body: surface('metal_painted', 0x889577, 0.8, 0.15),
    metal: surface('metal_rust', 0x777c75, 0.5, 0.9),
    beacon: new THREE.MeshBasicMaterial({ color: 0xffb34b }),
  };
  owned.push(mats.beacon);
  const parts = { body: [], metal: [] };
  const box = (kind, w, h, d, x, y, z) => {
    // Interior face vertices keep curvature wear at the edges, not across entire panels.
    const segments = (size) => Math.max(2, Math.min(12, Math.ceil(size / 0.06)));
    parts[kind].push(new THREE.BoxGeometry(w, h, d, segments(w), segments(h), segments(d)).translate(x, y, z));
  };
  box('body', 0.72, 0.32, 0.46, 0, 0.2, 0);
  box('body', 0.75, 0.06, 0.49, 0, 0.39, 0);
  box('body', 0.18, 0.085, 0.12, 0.19, 0.46, -0.06);
  for (const x of [-0.3, 0.3]) {
    for (const z of [-0.18, 0.18]) {
      box('metal', 0.1, 0.075, 0.1, x, 0.065, z);
      box('metal', 0.1, 0.075, 0.1, x, 0.35, z);
    }
    box('metal', 0.03, 0.025, 0.48, x, 0.425, 0);
  }
  for (const x of [-0.19, 0.19]) box('metal', 0.055, 0.09, 0.035, x, 0.31, 0.245);
  box('metal', 0.2, 0.025, 0.035, 0, 0.2, 0.275);
  box('metal', 0.025, 0.055, 0.035, -0.1, 0.225, 0.275);
  box('metal', 0.025, 0.055, 0.035, 0.1, 0.225, 0.275);
  parts.metal.push(new THREE.CylinderGeometry(0.005, 0.009, 0.23, 6).translate(0.25, 0.58, -0.07));
  const geos = {};
  for (const kind of ['body', 'metal']) {
    geos[kind] = mergeGeometries(parts[kind]);
    for (const part of parts[kind]) part.dispose();
    materials?.bakeMasks(geos[kind], { wear: 0.6, grime: 0.65, upWear: 0.04 });
  }
  geos.beacon = new THREE.BoxGeometry(0.045, 0.012, 0.018).translate(0.15, 0.51, -0.025);

  // A small readable stencil, not an emissive outline around the entire prop.
  let labelTexture = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const g = canvas.getContext('2d');
    g.fillStyle = '#c2b998'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#282d23';
    g.font = 'bold 46px monospace'; g.fillText('AL-MAKTABA', 25, 65);
    g.font = '24px monospace'; g.fillText('FIELD INTELLIGENCE', 25, 108);
    g.fillRect(25, 130, 462, 4);
    g.font = 'bold 28px monospace'; g.fillText('SEALED / 0132', 25, 180);
    g.font = '18px monospace'; g.fillText('AUTHORIZED PERSONNEL ONLY', 25, 224);
    labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    mats.label = new THREE.MeshStandardMaterial({ map: labelTexture, roughness: 0.92 });
    owned.push(mats.label);
    geos.label = new THREE.PlaneGeometry(0.32, 0.16);
    geos.label.rotateX(-Math.PI / 2).translate(-0.025, 0.426, -0.01);
  }
  return {
    geos, mats,
    dispose() {
      for (const geo of Object.values(geos)) geo.dispose();
      for (const mat of owned) mat.dispose();
      labelTexture?.dispose();
    },
  };
}

export function makeCrate(kit) {
  const root = new THREE.Group();
  root.name = 'intel-cache';
  for (const kind of Object.keys(kit.geos)) {
    const mesh = new THREE.Mesh(kit.geos[kind], kit.mats[kind]);
    if (kind === 'beacon') {
      mesh.userData.owNoPrepass = true;
      mesh.userData.owNoShadow = true;
    }
    root.add(mesh);
  }
  root.visible = false;
  return root;
}
