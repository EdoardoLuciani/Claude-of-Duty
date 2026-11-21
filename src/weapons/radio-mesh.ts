import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

import { bindingLabel } from '../core/bindings.ts';
import { disposeMaterials } from '../core/dispose-materials.ts';
import { isMesh, isSingleMaterialMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, type WeaponSceneMaterials } from './asset-material.ts';

/** Handheld radio. Origin at the grip; +Y up the body, screen on +Z. */

const SCREEN_W = 256;
const SCREEN_H = 128;
/** LCD request rows: the carpet bomb, then locked requests. */
export const RADIO_REQUESTS = 3;

/** The LCD is the radio interface: controls, charges, request locks and a cursor. */
function drawScreen(g: CanvasRenderingContext2D, count: number, cursor: number): void {
  g.fillStyle = '#04100a';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  g.textBaseline = 'middle';

  const row = (
    y: number,
    h: number,
    band: string,
    left: string,
    right: string,
    ink: string
  ): void => {
    g.fillStyle = band;
    g.fillRect(6, y, SCREEN_W - 12, h);
    g.fillStyle = ink;
    g.textAlign = 'left';
    g.fillText(left, 12, y + h / 2 + 1);
    g.textAlign = 'right';
    g.fillText(right, SCREEN_W - 14, y + h / 2 + 1);
  };

  g.font = '700 15px ui-monospace, monospace';
  const select =
    `${bindingLabel('radioUp')}${bindingLabel('radioDown')} ${bindingLabel('radioSend')} SEND`.toUpperCase();
  const stow = `${bindingLabel('slot1')}/${bindingLabel('slot2')} STOW`;
  row(4, 24, 'rgba(140,255,180,0.10)', select, stow, '#a8ffc4');

  const ready = count > 0;
  g.font = '700 18px ui-monospace, monospace';
  g.lineWidth = 2;
  for (let i = 0; i < RADIO_REQUESTS; i++) {
    const name = i === 0 ? 'CARPET BOMB' : 'REQUEST';
    const state = i > 0 ? 'LOCKED' : ready ? `x${count}` : 'EMPTY';
    const ink = i > 0 ? '#ffc27b' : ready ? '#5cff8f' : '#ff8a84';
    const y = 32 + i * 31;
    const on = i === cursor;
    row(
      y,
      29,
      on ? 'rgba(140,255,180,0.24)' : 'rgba(140,255,180,0.06)',
      `${on ? '>' : ' '} ${name}`,
      state,
      ink
    );
    if (on) {
      g.strokeStyle = ink;
      g.strokeRect(7, y + 1, SCREEN_W - 14, 27);
    }
  }
}

export async function loadRadio(renderer: Parameters<typeof loadWeaponGLTF>[0]): Promise<{
  scene: THREE.Group;
  setScreen(count: number, cursor: number): void;
  dispose(): void;
}> {
  const { scene } = await loadWeaponGLTF(renderer, 'models/player/field-radio.runtime.glb');
  const geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((object): void => {
    if (isMesh(object)) geometries.add(object.geometry);
  });
  let finishes: WeaponSceneMaterials = { materials: new Set(), textures: new Set() };
  const dispose = (): void => {
    scene.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    geometries.clear();
    disposeMaterials(finishes);
  };
  try {
    finishes = convertWeaponScene(scene);
    const grip = scene.getObjectByName('GRIP_radio');
    const housing = scene.getObjectByName('Radio_housing');
    const screen = scene.getObjectByName('SCREEN_radio');
    if (
      !grip ||
      !isSingleMaterialMesh(housing) ||
      !isSingleMaterialMesh(screen) ||
      housing.parent !== grip ||
      screen.parent !== grip ||
      screen.material === housing.material ||
      !screen.geometry.hasAttribute('uv') ||
      !(screen.material instanceof MeshPhysicalNodeMaterial) ||
      screen.material.map ||
      screen.material.emissiveMap
    )
      throw new Error(
        'Field radio: expected Radio_housing and a separate UV-mapped LCD under GRIP_radio'
      );
    const material = screen.material;
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Field radio: Canvas 2D is unavailable');
    const live = new THREE.CanvasTexture(canvas);
    live.name = 'FR12 live LCD';
    live.colorSpace = THREE.SRGBColorSpace;
    live.flipY = false; // glTF UVs run from the top, as does the canvas upload.
    live.anisotropy = 4;
    finishes.textures.add(live);
    // Lit opaque cover glass, with the LCD content contributing its own light.
    material.emissive.set(0xffffff);
    material.emissiveIntensity = 1.15;
    material.emissiveMap = live;
    let displayed = -1; // count * RADIO_REQUESTS + cursor
    const setScreen = (count: number, cursor: number): void => {
      const next = Math.min(99, Math.max(0, count));
      const key = next * RADIO_REQUESTS + cursor;
      if (key === displayed) return;
      drawScreen(ctx, next, cursor);
      live.needsUpdate = true;
      displayed = key;
    };
    setScreen(1, 0);
    return { scene, setScreen, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
