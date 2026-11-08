import * as THREE from 'three';

/** Grounding uses a body ellipse and two foot lobes to supplement shadow-map contact detail.
 * Near-black alpha-over approximates multiplication across exposure, with a small sky-blue term.
 * Contact strength changes sprite size as feet lift; body/foot instances remain two draws.
 */

/** Radial occlusion sprite. rgb white, alpha = occlusion. */
function buildTexture(size = 64, power = 3.4): THREE.DataTexture {
  const buf = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      const r = Math.min(1, Math.hypot(u, v));
      let a = Math.exp(-r * r * power);
      a *= 1 - r * r * r; // hard zero at the rim: no visible disc edge
      const i = (y * size + x) * 4;
      buf[i] = 255;
      buf[i + 1] = 255;
      buf[i + 2] = 255;
      buf[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
    }
  }
  const t = new THREE.DataTexture(buf, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

interface GroundedAgent {
  position: THREE.Vector3;
  scale?: number;
  crouch?: boolean;
  yaw: number;
  animator?: { bonePos(name: string, out: THREE.Vector3): void };
}

export class GroundShadows {
  capacity: number;
  texture: THREE.DataTexture;
  footTexture: THREE.DataTexture;
  _src: THREE.PlaneGeometry;
  bodyMat: THREE.MeshBasicMaterial;
  footMat: THREE.MeshBasicMaterial;
  body: THREE.InstancedMesh;
  feet: THREE.InstancedMesh;
  _m: THREE.Matrix4;
  _q: THREE.Quaternion;
  _up: THREE.Vector3;
  _pos: THREE.Vector3;
  _scale: THREE.Vector3;
  _foot: THREE.Vector3;
  _flat: THREE.Quaternion;
  _nBody: number;
  _nFeet: number;

  /**
   * @param {THREE.Object3D} parent  scene graph node to attach to
   * @param {number} actors          expected actor count (hard cap)
   */
  constructor(parent: THREE.Object3D, actors = 12) {
    this.capacity = Math.max(4, actors);
    this.texture = buildTexture(64, 3.4);
    this.footTexture = buildTexture(64, 4.6);

    this._src = new THREE.PlaneGeometry(1, 1, 1, 1);
    // Not pure black: a contact shadow is lit by the sky it is occluding less
    // of, so it keeps a trace of the sky's blue. 0.05 linear, i.e. deep but not
    // a hole.
    const mk = (tex: THREE.DataTexture, opacity: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.045, 0.05, 0.062),
        map: tex,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      });
      return m;
    };
    this.bodyMat = mk(this.texture, 0.62);
    this.footMat = mk(this.footTexture, 0.85);

    this.body = this._mesh(this._src, this.bodyMat, this.capacity, 'ai-ground-ao-body');
    this.feet = this._mesh(this._src, this.footMat, this.capacity * 2, 'ai-ground-ao-feet');
    parent.add(this.body);
    parent.add(this.feet);

    /* scratch */
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._pos = new THREE.Vector3();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._foot = new THREE.Vector3();
    // lie-flat rotation, built once: the per-frame path must never allocate
    this._flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this._nBody = 0;
    this._nFeet = 0;
  }

  _mesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    count: number,
    name: string
  ): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.renderOrder = 6; // after the opaque world, before the FX smoke
    m.name = name;
    m.userData.owProbe = true;
    m.userData.owNoPrepass = true;
    m.count = 0;
    m.visible = false;
    return m;
  }

  begin(): void {
    this._nBody = 0;
    this._nFeet = 0;
  }

  /** One occlusion quad on `mesh` at index i. */
  _place(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    rx: number,
    rz: number,
    yaw: number
  ): void {
    this._q.setFromAxisAngle(this._up, yaw).multiply(this._flat);
    this._pos.set(x, y + 0.015, z);
    this._scale.set(rx * 2, rz * 2, 1);
    this._m.compose(this._pos, this._q, this._scale);
    mesh.setMatrixAt(i, this._m);
  }

  /** Upload whatever was added this frame. */
  end(): void {
    this.body.count = this._nBody;
    this.feet.count = this._nFeet;
    if (this._nBody > 0) this.body.instanceMatrix.needsUpdate = true;
    if (this._nFeet > 0) this.feet.instanceMatrix.needsUpdate = true;
    this.body.visible = this._nBody > 0;
    this.feet.visible = this._nFeet > 0;
  }

  /**
   * Emit the quads for one actor: body ellipse plus a lobe per boot. The body
   * ellipse is oriented to his facing so it is long across the stance.
   */
  addActor(agent: GroundedAgent): void {
    const p = agent.position;
    if (!Number.isFinite(p.y)) return;
    const scale = agent.scale ?? 1;
    const crouch = agent.crouch ? 0.86 : 1;
    if (this._nBody < this.capacity) {
      this._place(
        this.body,
        this._nBody++,
        p.x,
        p.y,
        p.z,
        0.44 * scale * crouch,
        0.34 * scale * crouch,
        agent.yaw
      );
    }
    const an = agent.animator;
    if (!an?.bonePos) return;
    for (const name of FEET) {
      if (this._nFeet >= this.feet.instanceMatrix.count) break;
      an.bonePos(name, this._foot);
      if (!Number.isFinite(this._foot.y)) continue;
      // A boot 6 cm off the floor still darkens it; at 35 cm it does not. The
      // contact shrinks rather than fading, which is what a real one does.
      const h = this._foot.y - p.y;
      const k = 1 - Math.min(1, Math.max(0, (h - 0.06) / 0.29));
      if (k <= 0.05) continue;
      this._place(
        this.feet,
        this._nFeet++,
        this._foot.x,
        p.y,
        this._foot.z,
        0.15 * scale * k,
        0.21 * scale * k,
        agent.yaw
      );
    }
  }

  dispose(): void {
    for (const m of [this.body, this.feet]) {
      m.parent?.remove(m);
      m.dispose();
    }
    this._src.dispose();
    this.bodyMat.dispose();
    this.footMat.dispose();
    this.texture.dispose();
    this.footTexture.dispose();
  }
}

const FEET = ['FootR', 'FootL'];
