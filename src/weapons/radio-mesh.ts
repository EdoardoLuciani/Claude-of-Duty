import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

import { bindingLabel } from '../core/bindings.ts';
import { isMesh, isSingleMaterialMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';

/** Handheld radio. Origin at the grip; +Y up the body, screen on +Z. */

const SCREEN_W = 256;
const SCREEN_H = 128;

function drawScreen(g: CanvasRenderingContext2D, count: number): void {
  g.fillStyle = '#04100a';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  g.fillStyle = 'rgba(90,255,160,0.05)';
  g.fillRect(0, 0, SCREEN_W, 3);

  g.fillStyle = 'rgba(140,255,180,0.85)';
  g.font = '700 17px ui-monospace, monospace';
  g.fillText('FIELD RADIO', 12, 23);
  g.fillStyle = 'rgba(205,238,215,0.68)';
  g.font = '10px ui-monospace, monospace';
  g.fillText(`REQ/${bindingLabel('slot1')}-${bindingLabel('slot3')}`, 188, 21);
  g.fillStyle = 'rgba(140,255,180,0.14)';
  g.fillRect(8, 32, SCREEN_W - 16, 1);

  const row = (
    y: number,
    text: string,
    color: string,
    count: string | null,
    countColor = color
  ): void => {
    g.fillStyle = color;
    g.font = '700 19px ui-monospace, monospace';
    g.fillText(text, 14, y);
    if (count !== null) {
      g.fillStyle = countColor;
      g.font = '700 16px ui-monospace, monospace';
      g.textAlign = 'right';
      g.fillText(count, 244, y + 1);
      g.textAlign = 'left';
    }
  };

  if (count > 0) {
    row(62, `${bindingLabel('slot1')}  CARPET BOMB`, '#46ff7d', `x${count}`, '#a8ffc4');
    g.fillStyle = 'rgba(70,255,125,0.16)';
    g.fillRect(8, 44, SCREEN_W - 16, 26);
  } else {
    row(62, `${bindingLabel('slot1')}  CARPET BOMB`, '#ef8580', 'NO CHG', '#ff8a8a');
    g.fillStyle = 'rgba(255,90,90,0.08)';
    g.fillRect(8, 44, SCREEN_W - 16, 26);
  }
  g.fillStyle = 'rgba(255,190,90,0.14)';
  g.fillRect(8, 72, SCREEN_W - 16, 52);
  row(90, `${bindingLabel('slot2')}  REQUEST`, '#ffc27b', null);
  g.fillStyle = '#ff9892';
  g.font = '700 12px ui-monospace, monospace';
  g.fillText('TOP-SECRET', 166, 92);
  row(118, `${bindingLabel('slot3')}  REQUEST`, '#ffc27b', null);
  g.fillStyle = '#ff9892';
  g.font = '700 12px ui-monospace, monospace';
  g.fillText('TOP-SECRET', 166, 120);
}

export async function loadRadio(renderer: Parameters<typeof loadWeaponGLTF>[0]): Promise<{
  scene: THREE.Group;
  setScreen(count: number): void;
  dispose(): void;
}> {
  const { scene } = await loadWeaponGLTF(renderer, '/models/player/field-radio.runtime.glb');
  const geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((object): void => {
    if (isMesh(object)) geometries.add(object.geometry);
  });
  const finishes = convertWeaponScene(scene);
  const dispose = (): void => {
    scene.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    geometries.clear();
    disposeWeaponMaterials(finishes);
  };
  try {
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
    let displayed = -1;
    const setScreen = (count: number): void => {
      const next = Math.min(99, Math.max(0, count));
      if (next === displayed) return;
      drawScreen(ctx, next);
      live.needsUpdate = true;
      displayed = next;
    };
    setScreen(1);
    return { scene, setScreen, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
