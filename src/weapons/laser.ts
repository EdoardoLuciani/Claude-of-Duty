import * as THREE from 'three';
import { attribute, float, smoothstep, uv } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import type { EngineSystems } from '../core/context.ts';
import { MASK } from '../physics/surfaces.ts';
import { dropAt } from './ballistics.ts';
import type { WeaponDef } from './defs.ts';

/** One retained world draw for the beam and surface spot; no lights or decals.
 * Only transforms/attributes change when mounted: the shader is warmed at boot.
 * Flashlight (#506) owns a spotlight, not this unlit ribbon; the authored emitter
 * convention (-Z forward) can be shared without coupling either effect's lifetime. */
export class WeaponLaser {
  readonly geometry = new THREE.BufferGeometry();
  readonly material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
  });
  readonly mesh = new THREE.Mesh(this.geometry, this.material);
  private readonly positions = new THREE.BufferAttribute(new Float32Array(24), 3).setUsage(
    THREE.DynamicDrawUsage
  );
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly vertical = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2)
    );
    // Green 520 nm TOR Mini: a faint scattering ribbon and a bright surface spot.
    this.geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        [
          0.01, 0.4, 0.003, 0.01, 0.4, 0.003, 0.01, 0.4, 0.003, 0.01, 0.4, 0.003, 0.6, 12, 0.15,
          0.6, 12, 0.15, 0.6, 12, 0.15, 0.6, 12, 0.15,
        ],
        3
      )
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    this.material.colorNode = attribute('color', 'vec3');
    this.material.opacityNode = float(1).sub(smoothstep(0.1, 1, uv().sub(0.5).mul(2).length()));
    this.mesh.name = 'weapon-laser';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.userData.owNoPrepass = true;
    scene.add(this.mesh);
  }

  /** Capture gameplay aim before the camera/viewmodel's cosmetic firing overlay. */
  updateAim(
    camera: THREE.PerspectiveCamera,
    def: WeaponDef,
    muzzle: THREE.Vector3,
    physics: EngineSystems['physics'],
    owner: unknown
  ): void {
    // Match tryFire's unspread, zeroed bore. This is a sight aid, not a predictor
    // of random spread/penetration or the round's curved flight beyond its zero.
    this.direction.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.end
      .copy(camera.position)
      .addScaledVector(this.direction, def.zeroRange)
      .addScaledVector(this.up, dropAt(def, def.zeroRange));
    this.direction.copy(this.end).sub(muzzle).normalize();
    const aim = physics.raycast(muzzle, this.direction, def.maxRange, MASK.BULLET, owner);
    this.end.copy(aim.point); // pooled query results must be copied before the next query
  }

  update(
    camera: THREE.PerspectiveCamera,
    viewCamera: THREE.PerspectiveCamera,
    emitter: THREE.Object3D,
    physics: EngineSystems['physics'],
    owner: unknown,
    height: number
  ): void {
    emitter.getWorldPosition(this.origin);
    // The model is rendered with the separate first-person FOV. Map its apparent
    // emitter to the world projection so the ribbon starts on the actual lens.
    camera.updateMatrixWorld();
    viewCamera.updateMatrixWorld();
    this.origin.applyMatrix4(viewCamera.matrixWorldInverse);
    const ratio =
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
      Math.tan(THREE.MathUtils.degToRad(viewCamera.fov / 2));
    this.origin.x *= ratio;
    this.origin.y *= ratio;
    this.origin.applyMatrix4(camera.matrixWorld);
    this.direction.copy(this.end).sub(this.origin).normalize();
    const hit = physics.raycast(
      this.origin,
      this.direction,
      this.origin.distanceTo(this.end) + 0.02,
      MASK.BULLET,
      owner
    );
    this.end.copy(hit.point);
    this.normal.copy(hit.normal);

    this.up.copy(camera.position).sub(this.origin);
    // Small pixel floors keep the sub-millimetre beam/spot from disappearing
    // under temporal AA. They affect presentation only, never the query.
    const pixelScale = (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2) / height;
    this.side.crossVectors(this.direction, this.up).normalize();
    const startWidth = Math.max(0.0012, this.origin.distanceTo(camera.position) * pixelScale * 0.4);
    const endWidth = Math.max(0.0012, this.end.distanceTo(camera.position) * pixelScale * 0.4);
    this.side.multiplyScalar(startWidth);
    this.corner(0, this.origin, this.side, 1);
    this.corner(1, this.origin, this.side, -1);
    this.side.multiplyScalar(endWidth / startWidth);
    this.corner(2, this.end, this.side, -1);
    this.corner(3, this.end, this.side, 1);
    if (hit.hit) {
      this.end.addScaledVector(this.normal, 0.002);
      const radius = Math.max(0.004, this.end.distanceTo(camera.position) * pixelScale * 1.5);
      this.up.set(0, Math.abs(this.normal.y) < 0.9 ? 1 : 0, Math.abs(this.normal.y) < 0.9 ? 0 : 1);
      this.side.crossVectors(this.normal, this.up).normalize().multiplyScalar(radius);
      this.vertical.crossVectors(this.normal, this.side).normalize().multiplyScalar(radius);
      for (let i = 0; i < 4; i++) {
        this.corner(
          i + 4,
          this.end,
          this.side,
          i === 0 || i === 3 ? -1 : 1,
          this.vertical,
          i < 2 ? -1 : 1
        );
      }
    }
    this.geometry.setDrawRange(0, hit.hit ? 12 : 6);
    this.positions.needsUpdate = true;
    this.mesh.visible = true;
  }

  private corner(
    index: number,
    center: THREE.Vector3,
    side: THREE.Vector3,
    sign: number,
    vertical = this.vertical,
    verticalSign = 0
  ): void {
    this.positions.setXYZ(
      index,
      center.x + side.x * sign + vertical.x * verticalSign,
      center.y + side.y * sign + vertical.y * verticalSign,
      center.z + side.z * sign + vertical.z * verticalSign
    );
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
