import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as THREE from 'three/webgpu';

import { isMesh } from '../core/three-guards.ts';
import { isWeaponId } from '../weapons/defs.ts';
import type { WeaponSystem } from '../weapons/index.ts';
import { MARKET_ART, type MarketItemId } from './market-art.ts';
import { el, setText } from './util.ts';

type InspectionModel = Awaited<ReturnType<WeaponSystem['createInspectionModel']>>;

/** Local supply artwork and one lazy weapon studio, independent of sim time. */
export class MarketInspection {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  title: HTMLElement;
  status: HTMLElement;
  threeControls: HTMLElement;
  image: HTMLImageElement | null = null;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  controls: OrbitControls;
  renderer: THREE.Renderer | null = null;
  environment: THREE.RenderTarget | null = null;
  model: InspectionModel | null = null;
  ready: Promise<void> | null = null;
  activeId: MarketItemId | null = null;
  active = false;
  disposed = false;
  failed = false;
  dirty = true;
  revision = 0;
  distance = 1;
  framing = new THREE.Box3();
  width = 0;
  height = 0;
  abort = new AbortController();

  weapons: WeaponSystem;

  constructor(parent: HTMLElement, weapons: WeaponSystem) {
    this.weapons = weapons;
    this.root = el('section', 'ow-market-inspection', parent);
    this.root.setAttribute('aria-label', 'Item inspection');
    el('div', 'ow-market-sec-l', this.root, 'ITEM INSPECTION');
    this.title = el('h2', 'ow-market-inspect-title', this.root, 'HOVER OR FOCUS AN ITEM');
    const view = el('div', 'ow-market-inspect-view', this.root);
    this.canvas = el('canvas', 'ow-market-inspect-canvas', view);
    this.canvas.hidden = true;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      'aria-label',
      '3D weapon view. Arrow keys rotate, plus and minus zoom, Home resets.'
    );
    this.status = el(
      'div',
      'ow-market-inspect-status',
      this.root,
      'Inspect without spending credits'
    );
    this.status.setAttribute('role', 'status');
    this.threeControls = el('div', 'ow-market-inspect-3d', this.root);
    this.threeControls.hidden = true;
    const toolbar = el('div', 'ow-market-inspect-tools', this.threeControls);
    const button = (label: string, action: () => void): HTMLButtonElement => {
      const btn = el('button', null, toolbar, label);
      btn.type = 'button';
      btn.addEventListener('click', action, { signal: this.abort.signal });
      return btn;
    };
    button('ZOOM IN', (): void => this.zoom(0.8));
    button('ZOOM OUT', (): void => this.zoom(1.25));
    button('RESET', (): void => this.reset());
    el('p', 'ow-market-inspect-help', this.threeControls, 'Drag to rotate · Scroll to zoom');
    el(
      'p',
      'ow-market-inspect-help',
      this.threeControls,
      'Keyboard: arrows rotate · + / − zoom · Home reset'
    );
    el(
      'p',
      'ow-market-inspect-help',
      this.root,
      'Click any card to keep it selected. Only BUY / SWAP spends credits.'
    );

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = false;
    this.controls.addEventListener('change', (): void => {
      this.dirty = true;
    });
    this.canvas.addEventListener('keydown', (event): void => this.key(event), {
      signal: this.abort.signal,
    });
    this.canvas.addEventListener('pointerdown', (): void => this.canvas.focus(), {
      signal: this.abort.signal,
    });
    this.scene.background = new THREE.Color(0x10151b);
    this.scene.add(new THREE.HemisphereLight(0xb9d3ff, 0x3b3025, 2));
    const key = new THREE.DirectionalLight(0xffe5c8, 4);
    key.position.set(2, 3, 4);
    const rim = new THREE.DirectionalLight(0x91b9ff, 3);
    rim.position.set(-3, 1, -2);
    this.scene.add(key, rim);
  }

  private async initRenderer(): Promise<void> {
    // Strict WebGPU, like the game: do not install Three's automatic WebGL fallback.
    const parameters = { canvas: this.canvas, antialias: true };
    const renderer = new THREE.Renderer(new THREE.WebGPUBackend(parameters), parameters);
    renderer.library = new THREE.StandardNodeLibrary();
    try {
      await renderer.init();
      if (this.disposed) {
        await renderer.dispose();
        return;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.toneMapping = THREE.AgXToneMapping;
      const onDeviceLost = renderer.onDeviceLost;
      renderer.onDeviceLost = (info): void => {
        if (info.reason === 'destroyed') return;
        onDeviceLost.call(renderer, info);
        this.fail();
      };
      this.renderer = renderer;
      const room = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      try {
        this.environment = pmrem.fromScene(room);
      } finally {
        room.dispose();
        pmrem.dispose();
      }
      this.scene.environment = this.environment.texture;
      this.dirty = true;
    } catch (error) {
      // Three's cleanup awaits init too, so it can reject with the same failure.
      await renderer.dispose().catch((): void => {});
      this.renderer = null;
      throw error;
    }
  }

  private fail(): void {
    this.clearModel();
    this.failed = true;
    this.controls.enabled = false;
    // A late device-loss notification must not replace a working supply illustration.
    if (this.activeId && !isWeaponId(this.activeId)) return;
    ++this.revision;
    this.canvas.hidden = true;
    this.threeControls.hidden = true;
    setText(this.status, '3D preview unavailable. Purchases and resupply still work.');
  }

  async select(id: MarketItemId, label: string): Promise<void> {
    if (!this.active || this.disposed || id === this.activeId) return;
    this.activeId = id;
    const revision = ++this.revision;
    this.clearModel();
    this.clearImage();
    setText(this.title, label);
    const weapon = isWeaponId(id);
    this.canvas.hidden = true;
    this.threeControls.hidden = !weapon;
    this.controls.enabled = weapon && !this.failed;
    if (!isWeaponId(id)) {
      const art = MARKET_ART[id];
      const image = el('img', 'ow-market-inspect-art');
      this.image = image;
      image.alt = art.alt;
      image.width = 960;
      image.height = 640;
      image.hidden = true;
      image.onload = (): void => {
        if (revision !== this.revision || this.disposed) return;
        image.hidden = false;
        setText(this.status, 'Preview only · field supply illustration');
      };
      image.onerror = (): void => {
        if (revision !== this.revision || this.disposed) return;
        image.hidden = true;
        setText(this.status, 'Artwork unavailable. Purchases and resupply still work.');
      };
      setText(this.status, 'Loading illustration…');
      this.canvas.after(image);
      image.src = art.src;
      return;
    }
    if (this.failed) {
      this.fail();
      return;
    }
    setText(this.status, 'Loading preview…');
    try {
      this.ready ??= this.initRenderer();
      await this.ready;
      if (this.disposed || revision !== this.revision || this.failed) return;
      const model = await this.weapons.createInspectionModel(id);
      if (this.disposed || revision !== this.revision || !this.active) {
        model.dispose();
        return;
      }
      this.model = model;
      // Bound visible meshes only: authored spare magazines/cases must not spoil framing.
      const bounds = new THREE.Box3();
      const box = new THREE.Box3();
      model.scene.updateMatrixWorld(true);
      model.scene.traverseVisible((node): void => {
        if (!isMesh(node)) return;
        const mesh = node;
        mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox)
          bounds.union(box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
      });
      const center = bounds.getCenter(new THREE.Vector3());
      model.scene.position.sub(center);
      this.scene.add(model.scene);
      const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.05);
      this.framing.copy(bounds).translate(center.negate());
      this.controls.minDistance = radius * 0.65;
      this.camera.near = radius * 0.01;
      this.canvas.hidden = false;
      this.reset();
      this.update();
      if (!this.failed) setText(this.status, 'Preview only · current weapon configuration');
    } catch {
      if (!this.disposed && revision === this.revision) this.fail();
    }
  }

  reset(): void {
    this.controls.target.set(0, 0, 0);
    // Authored weapons point down -Z; start nearly broadside, slightly above.
    this.camera.position.set(1, 0.3, 0.35).normalize();
    this.camera.lookAt(0, 0, 0);
    this.camera.aspect =
      Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
    if (!this.framing.isEmpty()) {
      const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
        this.camera.quaternion.clone().invert()
      );
      const box = this.framing.clone().applyMatrix4(rotation);
      const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      this.distance =
        (Math.max(box.max.x / (tan * this.camera.aspect), box.max.y / tan) + box.max.z) * 1.15;
      this.controls.maxDistance = this.distance * 2.5;
      this.camera.far = this.distance * 10;
    }
    this.camera.position.multiplyScalar(this.distance);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.dirty = true;
  }

  zoom(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(
      THREE.MathUtils.clamp(
        offset.length() * factor,
        this.controls.minDistance,
        this.controls.maxDistance
      )
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  private key(event: KeyboardEvent): void {
    if (!this.controls.enabled) return;
    const x = Number(event.key === 'ArrowRight') - Number(event.key === 'ArrowLeft');
    const y = Number(event.key === 'ArrowUp') - Number(event.key === 'ArrowDown');
    if (x || y) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += x * 0.12;
      spherical.phi -= y * 0.12;
      spherical.makeSafe();
      this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
      this.controls.update();
    } else if (event.key === '+' || event.key === '=') this.zoom(0.8);
    else if (event.key === '-' || event.key === '_') this.zoom(1.25);
    else if (event.key === 'Home') this.reset();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  update(): void {
    if (
      !this.active ||
      !this.activeId ||
      !isWeaponId(this.activeId) ||
      !this.renderer ||
      this.disposed ||
      this.failed
    )
      return;
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      this.fail();
    }
  }

  hide(): void {
    this.active = false;
    this.controls.enabled = false;
    this.activeId = null;
    ++this.revision;
    this.clearModel();
    this.clearImage();
    this.canvas.hidden = true;
    this.threeControls.hidden = true;
    setText(this.title, 'HOVER OR FOCUS AN ITEM');
    setText(this.status, 'Inspect without spending credits');
  }

  private clearImage(): void {
    if (!this.image) return;
    this.image.onload = null;
    this.image.onerror = null;
    this.image.removeAttribute('src');
    this.image.remove();
    this.image = null;
  }

  private clearModel(): void {
    this.model?.dispose();
    this.model = null;
    this.dirty = true;
  }

  dispose(): void {
    this.hide();
    this.disposed = true;
    this.abort.abort();
    this.controls.dispose();
    this.environment?.dispose();
    void this.renderer?.dispose();
    this.root.remove();
  }
}
