import * as THREE from 'three';

/**
 * The field radio — the player's accessory.
 *
 * A handheld walkie-talkie held in the right hand, with a working little
 * screen: the three request rows are painted onto a shared canvas texture
 * (row 1 = CARPET BOMB, green when a charge is left, red when spent; rows
 * 2-3 = TOP-SECRET, locked). Shared geometry/materials, one instance in the
 * viewmodel — exactly the pattern `grenade-mesh.js` uses.
 *
 * Local space: origin is the grip in the palm; the radio extends up (+Y),
 * the screen faces +Z (toward the camera when held).
 */

const SCREEN_W = 256;
const SCREEN_H = 128;

/** Paint the screen texture. `ready` toggles the carpet-bomb row state;
 *  `count` is the live charge count painted next to it (market purchases
 *  change the number without re-painting the whole handset). */
export function radioScreenTexture(ready = true, count = 1) {
  if (typeof document === 'undefined') {
    const t = new THREE.DataTexture(new Uint8Array([6, 16, 9, 255]), 1, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement('canvas');
  c.width = SCREEN_W;
  c.height = SCREEN_H;
  const g = c.getContext('2d');

  // glass
  g.fillStyle = '#04100a';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  g.fillStyle = 'rgba(90,255,160,0.05)';
  g.fillRect(0, 0, SCREEN_W, 3);

  // header
  g.fillStyle = 'rgba(140,255,180,0.55)';
  g.font = '700 17px ui-monospace, monospace';
  g.fillText('FIELD RADIO', 12, 22);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.font = '10px ui-monospace, monospace';
  g.fillText('REQ/1-3', 180, 18);
  g.fillStyle = 'rgba(140,255,180,0.14)';
  g.fillRect(8, 32, SCREEN_W - 16, 1);

  const row = (y, text, color, count, countColor) => {
    g.fillStyle = color;
    g.font = '700 19px ui-monospace, monospace';
    g.fillText(text, 14, y);
    if (count !== null) {
      g.fillStyle = countColor ?? color;
      g.font = '700 16px ui-monospace, monospace';
      g.fillText(count, 204, y + 1);
    }
  };

  // Row 1 — carpet bomb (the only unlocked request).
  if (ready && count > 0) {
    row(62, '1  CARPET BOMB', '#46ff7d', `x${Math.min(count, 99)}`, '#a8ffc4');
    g.fillStyle = 'rgba(70,255,125,0.16)';
    g.fillRect(8, 44, SCREEN_W - 16, 26);
  } else {
    row(62, '1  CARPET BOMB', '#b04848', 'NO CHG', '#ff8a8a');
    g.fillStyle = 'rgba(255,90,90,0.08)';
    g.fillRect(8, 44, SCREEN_W - 16, 26);
  }
  // Rows 2-3 — locked.
  g.fillStyle = 'rgba(255,190,90,0.14)';
  g.fillRect(8, 72, SCREEN_W - 16, 52);
  row(90, '2  REQUEST', 'rgba(255,190,90,0.8)', null);
  g.fillStyle = 'rgba(255,120,120,0.85)';
  g.font = '700 12px ui-monospace, monospace';
  g.fillText('TOP-SECRET', 176, 94);
  row(118, '3  REQUEST', 'rgba(255,190,90,0.8)', null);
  g.fillStyle = 'rgba(255,120,120,0.85)';
  g.font = '700 12px ui-monospace, monospace';
  g.fillText('TOP-SECRET', 176, 122);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ---- shared materials -----------------------------------------------------

const bodyMat = new THREE.MeshStandardMaterial({
  color: 0x3a3d32, roughness: 0.62, metalness: 0.42,
});
const darkMat = new THREE.MeshStandardMaterial({
  color: 0x23251e, roughness: 0.78, metalness: 0.3,
});
const grillMat = new THREE.MeshStandardMaterial({
  color: 0x11130e, roughness: 0.9, metalness: 0.1,
});
const screenMat = new THREE.MeshStandardMaterial({
  color: 0x061009,
  roughness: 0.25,
  metalness: 0.05,
  emissive: 0x0d2a16,
  emissiveIntensity: 1.4,
});
const ledMat = new THREE.MeshStandardMaterial({
  color: 0x220000,
  emissive: 0xff2211,
  emissiveIntensity: 3,
});

/**
 * A fresh radio group. Shared geometry and materials; the screen material's
 * map is swapped by the viewmodel when the charge state changes.
 */
export function radioMesh() {
  const g = new THREE.Group();

  // body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.098, 0.034), bodyMat);
  body.position.y = 0.056;
  g.add(body);

  // top cap + side grip ridges
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.008, 0.036), darkMat);
  cap.position.y = 0.108;
  g.add(cap);
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.003, 0.036), grillMat);
    r.position.y = 0.024 - i * 0.012;
    r.position.z = 0.0;
    g.add(r);
  }

  // screen frame + glass
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.047, 0.037, 0.003), darkMat);
  frame.position.set(0, 0.084, 0.0175);
  g.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.043, 0.033), screenMat);
  screen.position.set(0, 0.084, 0.0192);
  screen.material.map = radioScreenTexture(true);
  g.add(screen);
  g.userData.screen = screen;

  // speaker grill
  for (let i = 0; i < 4; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0022, 0.004), grillMat);
    slot.position.set(0, 0.048 - i * 0.007, 0.018);
    g.add(slot);
  }

  // antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.085, 6), darkMat);
  ant.position.set(0.012, 0.155, -0.006);
  g.add(ant);

  // channel knob
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.009, 10), darkMat);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.02, 0.112, 0.0);
  g.add(knob);

  // transmit LED
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0024, 6, 6), ledMat);
  led.position.set(-0.012, 0.1, 0.0195);
  g.add(led);

  return g;
}
