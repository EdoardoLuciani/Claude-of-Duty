import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Hollow instrument case with a hinged lid and a batched electronics tray. */
export function makeKit(materials) {
  const owned = [];
  const textures = [];
  const surface = (name, color, roughness, metalness) => {
    if (materials) return materials.get(name, { tint: color, scale: 0.55, parallax: 0.001 });
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    owned.push(mat);
    return mat;
  };
  const mats = {
    body: surface('metal_painted', 0x889577, 0.8, 0.15),
    metal: surface('metal_rust', 0x777c75, 0.5, 0.9),
    circuit: surface('metal_painted', 0x40895d, 0.7, 0.1),
    components: surface('rubber', 0x343a37, 0.85, 0),
    traces: surface('metal_brushed', 0xc2a35b, 0.4, 1),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff0802 }),
    leds: new THREE.MeshBasicMaterial({ color: 0x53ffb1 }),
  };
  mats.lid = mats.body;
  mats.lidMetal = mats.metal;
  mats.lining = mats.components;
  owned.push(mats.beacon, mats.leds);
  const parts = {};
  const add = (kind, geo) => (parts[kind] ??= []).push(geo);
  const box = (kind, w, h, d, x, y, z) => {
    const segments = (size) => Math.max(2, Math.min(12, Math.ceil(size / 0.06)));
    add(kind, new THREE.BoxGeometry(w, h, d, segments(w), segments(h), segments(d)).translate(x, y, z));
  };
  // Floor and walls, not a solid block: the tray remains inside the closed case.
  box('body', 0.72, 0.045, 0.46, 0, 0.075, 0);
  for (const x of [-0.34, 0.34]) box('body', 0.04, 0.29, 0.46, x, 0.235, 0);
  for (const z of [-0.21, 0.21]) box('body', 0.64, 0.29, 0.04, 0, 0.235, z);
  box('lid', 0.75, 0.045, 0.49, 0, 0.405, 0);
  box('lining', 0.64, 0.018, 0.38, 0, 0.373, 0);
  for (const x of [-0.3, 0.3]) {
    for (const z of [-0.18, 0.18]) {
      box('metal', 0.1, 0.075, 0.1, x, 0.065, z);
      box('metal', 0.1, 0.05, 0.1, x, 0.34, z);
    }
    box('lidMetal', 0.025, 0.015, 0.48, x, 0.435, 0);
    box('metal', 0.09, 0.035, 0.055, x, 0.365, -0.23);
  }
  for (const x of [-0.19, 0.19]) box('metal', 0.055, 0.09, 0.035, x, 0.31, 0.245);
  box('metal', 0.2, 0.025, 0.035, 0, 0.2, 0.275);
  for (const x of [-0.1, 0.1]) box('metal', 0.025, 0.055, 0.035, x, 0.225, 0.275);
  // Green PCB, raised ICs, copper buses, cylindrical capacitors and battery pack.
  box('circuit', 0.39, 0.018, 0.31, 0.075, 0.2, 0);
  for (const z of [-0.095, 0.02, 0.11]) {
    box('components', 0.075, 0.022, 0.05, 0.06, 0.222, z);
    for (const x of [0.007, 0.113]) box('traces', 0.022, 0.008, 0.045, x, 0.215, z);
  }
  for (const x of [-0.04, 0.16, 0.22]) {
    box('traces', 0.002, 0.002, 0.24, x, 0.211, -0.01);
    box('traces', 0.055, 0.002, 0.002, x + 0.026, 0.211, 0.11);
  }
  for (const z of [-0.105, -0.045, 0.015]) {
    add('components', new THREE.CylinderGeometry(0.013, 0.013, 0.055, 10).translate(0.2, 0.237, z));
    box('traces', 0.018, 0.002, 0.015, 0.2, 0.266, z);
  }
  box('components', 0.135, 0.07, 0.29, -0.22, 0.185, 0);
  for (const z of [-0.07, 0.07]) box('traces', 0.14, 0.007, 0.018, -0.22, 0.225, z);
  // Bundled cable routed from the battery into the controller.
  for (const z of [-0.11, -0.095, -0.08]) box('components', 0.09, 0.007, 0.007, -0.12, 0.24, z);
  // Raised exterior lens stays visible with the lid closed, from every side.
  add('beacon', new THREE.SphereGeometry(0.028, 12, 8).translate(-0.3, 0.46, 0.19));
  for (const x of [0.13, 0.16, 0.19]) box('leds', 0.009, 0.004, 0.012, x, 0.217, 0.12);
  const geos = {};
  const lidKinds = new Set(['lid', 'lidMetal', 'lining', 'label', 'beacon']);
  for (const kind of Object.keys(parts)) {
    geos[kind] = mergeGeometries(parts[kind]);
    for (const part of parts[kind]) part.dispose();
    materials?.bakeMasks(geos[kind], { wear: 0.6, grime: 0.65, upWear: 0.04 });
    if (lidKinds.has(kind)) geos[kind].translate(0, -0.38, 0.23);
  }
  if (typeof document !== 'undefined') {
    const label = document.createElement('canvas');
    label.width = 512; label.height = 256;
    const g = label.getContext('2d');
    g.fillStyle = '#c2b998'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#282d23';
    g.font = 'bold 46px monospace'; g.fillText('AL-MAKTABA', 25, 65);
    g.font = '24px monospace'; g.fillText('FIELD INTELLIGENCE', 25, 108);
    g.fillRect(25, 130, 462, 4);
    g.font = 'bold 28px monospace'; g.fillText('SEALED / 0132', 25, 180);
    g.font = '18px monospace'; g.fillText('AUTHORIZED PERSONNEL ONLY', 25, 224);
    const texture = new THREE.CanvasTexture(label);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    mats.label = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92 });
    owned.push(mats.label);
    geos.label = new THREE.PlaneGeometry(0.32, 0.16);
    geos.label.rotateX(-Math.PI / 2).translate(-0.025, 0.049, 0.22);
  }
  return {
    geos, mats, lidKinds,
    dispose() {
      for (const geo of Object.values(geos)) geo.dispose();
      for (const mat of owned) mat.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

export function makeCrate(kit) {
  const root = new THREE.Group();
  root.name = 'intel-cache';
  const lid = new THREE.Group();
  lid.name = 'intel-lid';
  lid.position.set(0, 0.38, -0.23);
  root.add(lid);
  root.lid = lid;
  for (const kind of Object.keys(kit.geos)) {
    const mesh = new THREE.Mesh(kit.geos[kind], kit.mats[kind]);
    mesh.receiveShadow = true;
    if (kind === 'beacon' || kind === 'leds') {
      mesh.userData.owNoPrepass = true;
      mesh.userData.owNoShadow = true;
    }
    (kit.lidKinds.has(kind) ? lid : root).add(mesh);
  }
  root.visible = false;
  return root;
}
