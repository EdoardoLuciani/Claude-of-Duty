import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';

import { bindingLabel } from '../core/bindings.ts';
import { isMesh, isSingleMaterialMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';

/** Handheld radio. Origin at the grip; +Y up the body, screen on +Z. */

const SCREEN_W = 256;
const SCREEN_H = 128;

/** The LCD is the radio interface: charges, request bindings/locks and stow. */
function drawScreen(g: CanvasRenderingContext2D, count: number): void {
  g.fillStyle = '#04100a';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);

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
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(left, 14, y + h / 2 + 1);
    g.textAlign = 'right';
    g.fillText(right, SCREEN_W - 14, y + h / 2 + 1);
  };

  g.font = '700 17px ui-monospace, monospace';
  row(4, 26, 'rgba(140,255,180,0.10)', 'FIELD RADIO', `${bindingLabel('radio')} STOW`, '#a8ffc4');
  g.font = '700 19px ui-monospace, monospace';
  const ready = count > 0;
  row(
    34,
    30,
    ready ? 'rgba(70,255,125,0.22)' : 'rgba(255,90,90,0.16)',
    `${bindingLabel('slot1')} CARPET BOMB`,
    ready ? `x${count}` : 'EMPTY',
    ready ? '#5cff8f' : '#ff8a84'
  );
  g.font = '700 18px ui-monospace, monospace';
  row(66, 28, 'rgba(255,190,90,0.12)', `${bindingLabel('slot2')} REQUEST`, 'LOCKED', '#ffc27b');
  row(96, 28, 'rgba(255,190,90,0.12)', `${bindingLabel('slot3')} REQUEST`, 'LOCKED', '#ffc27b');
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
