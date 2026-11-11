import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';

import { hasOwn } from '../core/guards.ts';
import { Spring, TAU, clamp, clamp01, damp, lerp, smootherstep } from '../core/math.ts';
import { loadArmAsset } from './arm-asset.ts';
import { createWeaponMaterial } from './asset-material.ts';
import {
  BASE_ATTACHMENTS,
  configureWeaponAttachments,
  releaseAttachmentMount,
  type AttachmentConfig,
  type OpticModels,
} from './attachments.ts';
import { createWeaponAnimation } from './authored-animation.ts';
import { loadBandage } from './bandage-mesh.ts';
import {
  BANDAGE_PATH,
  BANDAGE_CONTACT,
  BANDAGE_POSES,
  BANDAGE_SEGMENTS,
  BANDAGE_WIDTH,
  BANDAGE_ELBOW_R,
} from './bandage-path.ts';
import { makeSampleResult } from './clips.ts';
import type { Clip } from './clips.ts';
import type { WeaponDef } from './defs.ts';
import { triCount } from './geometry.ts';
import { grenadeMesh } from './grenade-mesh.ts';
import { GRIP_CONTACTS, FIRING_FINGER_SPREAD } from './grip-contacts.ts';
import { Arm } from './hands.ts';
import type { ReticleMaterials } from './materials-tsl.ts';
import { Spring3, Noise1, wrapPi } from './mathx.ts';
import { radioMesh, radioScreenTexture } from './radio-mesh.ts';
import type {
  ClipResult,
  ViewPoseKey,
  ViewState,
  WeaponEntry,
  WeaponModelRecord,
  WeaponNodes,
  ViewmodelContext,
} from './runtime-types.ts';
import { SNIPER_RETICLE, sniperMradScale, sniperReticleCoverage } from './sniper-reticle.ts';

/** First-person pose stack: base hip/ADS/sprint/low-ready, sway, stride bob, lag, recoil, then clips.
 * ADS translation aligns the authored sight to camera axis at the selected eye relief.
 * viewScene -> anchor (world-camera transform) -> rig -> weapon and two-bone IK arms;
 * the collimated reticle remains on the optical axis in camera space.
 */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'XYZ');
const _m = new THREE.Matrix4();

/** Duration of the arm throw, and the beat where the grenade leaves. The
 *  long throw is the big overhead heave; the short throw is a faster, more
 *  compact toss with a much earlier release. */
const GRENADE_THROW_T = 0.52;
const GRENADE_RELEASE_AT = 0.3;
const GRENADE_SHORT_THROW_T = 0.4;
const GRENADE_SHORT_RELEASE_AT = 0.22;
const GRENADE_COOK_BLEND_T = 0.16;

/** Camera-space utility staging, independent of the equipped weapon's hip
 *  transform. The bent left arm presents a stationary, horizontal forearm. */
const BANDAGE_L = {
  hand: [-0.015, -0.13, -0.48],
  elbow: [-0.306, -0.13, -0.48],
  shoulder: [-0.23, -0.22, -0.18236262],
  // Tuck the fist out of the fixed elbow's forearm sweep.
  finger: [0.5, 0, -0.866025],
  back: [0.866025, 0, 0.5],
};
const BANDAGE_R = {
  shoulder: [0.42, -0.24, -0.25135399],
  tensionSettle: 0.1,
  release: 0.12,
};

/** Radio hold: walkie at chest height, screen toward the eye. Left hand hangs. */
const RADIO_HOLD = {
  hand: [0.07, -0.06, -0.23],
  finger: [0.16, 0.92, -0.36],
  back: [0.22, 0.32, -0.92],
  lhand: [-0.16, -0.12, -0.08],
  lfinger: [0.35, 0.55, -0.76],
  lback: [-0.4, 0.55, 0.73],
};

/** Idle hold at chest height. Left hand stays off — two gloves cannot wrap it. */
const GRENADE_HOLD = {
  hand: [0.07, 0.04, -0.13],
  finger: [0.06, 0.6, -0.8],
  back: [0.58, 0.38, -0.72],
  lhand: [-0.11, 0.01, -0.04],
  lfinger: [0.32, 0.34, -0.88],
  lback: [-0.48, 0.7, -0.53],
};

/** Long cook: cocked high-right, palm toward the eye. */
const GRENADE_COOK_LONG = {
  t: 0,
  hand: [0.0131, 0.2084, 0.0136],
  finger: [0.05, 0.67, -0.74],
  back: [0.61, 0.4, -0.68],
  lhand: [-0.182, 0.1174, 0.0741],
  lfinger: [0.19, 0.38, -0.91],
  lback: [-0.56, 0.67, -0.48],
};

/** Short cook: same palm, mid-right chest. */
const GRENADE_COOK_SHORT = {
  t: 0,
  hand: [0.06, 0.12, -0.06],
  finger: [0.08, 0.58, -0.81],
  back: [0.58, 0.4, -0.71],
  lhand: [-0.15, 0.04, 0.0],
  lfinger: [0.2, 0.32, -0.93],
  lback: [-0.52, 0.7, -0.49],
};

/** Long throw: wind up above the cook, then heave forward. */
const GRENADE_THROW_KEYS = [
  GRENADE_COOK_LONG,
  {
    t: 0.28,
    hand: [0.05, 0.26, 0.02],
    finger: [0.02, 0.78, -0.63],
    back: [0.64, 0.32, -0.7],
    lhand: [-0.18, 0.1, 0.08],
    lfinger: [0.16, 0.36, -0.92],
    lback: [-0.56, 0.66, -0.5],
  },
  {
    t: 0.58,
    hand: [0.05, 0.2, -0.08],
    finger: [0.04, 0.48, -0.88],
    back: [0.54, 0.48, -0.69],
    lhand: [-0.16, 0.08, 0.05],
    lfinger: [0.18, 0.3, -0.94],
    lback: [-0.52, 0.7, -0.49],
  },
  {
    t: 0.78,
    hand: [0.04, 0.12, -0.16],
    finger: [0.05, 0.12, -0.99],
    back: [0.42, 0.66, -0.62],
    lhand: [-0.14, 0.02, 0.02],
    lfinger: [0.2, 0.24, -0.95],
    lback: [-0.5, 0.72, -0.48],
    rpose: 'open',
  },
  { ...GRENADE_HOLD, t: 1, rpose: 'open' },
];

/** Short throw: snap from the chest cock, no overhead. */
const GRENADE_THROW_SHORT_KEYS = [
  GRENADE_COOK_SHORT,
  {
    t: 0.26,
    hand: [0.08, 0.14, -0.02],
    finger: [0.08, 0.52, -0.85],
    back: [0.56, 0.42, -0.71],
    lhand: [-0.15, 0.04, 0.02],
    lfinger: [0.2, 0.3, -0.93],
    lback: [-0.52, 0.7, -0.49],
  },
  {
    t: 0.55,
    hand: [0.07, 0.15, -0.1],
    finger: [0.08, 0.38, -0.92],
    back: [0.5, 0.52, -0.69],
    lhand: [-0.14, 0.04, 0.02],
    lfinger: [0.22, 0.26, -0.94],
    lback: [-0.5, 0.72, -0.48],
  },
  {
    t: 0.76,
    hand: [0.05, 0.08, -0.14],
    finger: [0.08, 0.1, -0.99],
    back: [0.4, 0.68, -0.62],
    lhand: [-0.12, 0.0, 0.0],
    lfinger: [0.24, 0.22, -0.95],
    lback: [-0.48, 0.72, -0.48],
    rpose: 'open',
  },
  { ...GRENADE_HOLD, t: 1, rpose: 'open' },
];

/** Right-handed hand basis from a finger direction and a back-of-hand direction. */
function handBasis(
  out: THREE.Quaternion,
  finger: ArrayLike<number>,
  back: ArrayLike<number>
): THREE.Quaternion {
  _v.set(-finger[0], -finger[1], -finger[2]).normalize(); // hand +Z
  _v2.set(back[0], back[1], back[2]);
  _v2.addScaledVector(_v, -_v2.dot(_v));
  if (_v2.lengthSq() < 1e-8) _v2.set(0, 1, 0).addScaledVector(_v, -_v.y);
  _v2.normalize(); // hand +Y
  _v3.crossVectors(_v2, _v).normalize(); // hand +X
  _m.makeBasis(_v3, _v2, _v);
  return out.setFromRotationMatrix(_m);
}

export class Viewmodel {
  declare ctx: ViewmodelContext;
  declare radioScreen: THREE.Mesh<THREE.BufferGeometry, MeshPhysicalNodeMaterial> | null;
  declare maskUniforms: {
    uAlpha: UniformNode<'float', number>;
    uAspect: UniformNode<'float', number>;
    uSniper: UniformNode<'float', number>;
  };
  declare reticleUniforms: {
    uAlpha: UniformNode<'float', number>;
    uAspect: UniformNode<'float', number>;
    uChevron: UniformNode<'float', number>;
    uMradScale: UniformNode<'float', number>;
  };
  declare rng: import('../core/rng.ts').Rng;
  anchor: THREE.Object3D = new THREE.Object3D();
  rig: THREE.Object3D = new THREE.Object3D();
  declare armAsset: import('./arm-asset.ts').ArmAsset;
  // ---- arms -------------------------------------------------------------
  // Camera-space viewmodel stance: the firing shoulder sits farther back;
  // the support shoulder stays forward so it can reach the rear handguard.
  // A firing shoulder almost at the eye left too little shoulder/wrist
  // distance for these bone lengths and folded the wrist backwards.
  armR: Arm = new Arm(1, {
    scale: 1,
    shoulderX: 0.205,
    shoulderY: -0.2,
    shoulderZ: 0.28,
    pose: 'grip',
  });
  // Keep the support grip within reach instead of stretching the forearm.
  // The pistol supplies a less-bladed support shoulder in its definition.
  armL: Arm = new Arm(-1, {
    scale: 0.97,
    shoulderX: 0.2,
    shoulderY: -0.22,
    shoulderZ: 0.02,
    pose: 'clamp',
  });
  // ---- grenade (held in the right hand while cooking / throwing) --------
  // The shared world mesh, slightly enlarged so it reads at arm's length;
  // parented to the hand so it rides the arm through the throw.
  grenade: THREE.Object3D = grenadeMesh();
  radio: THREE.Object3D = radioMesh();
  active: WeaponEntry | null = null;
  // 0 = none, 1 = held / cooking, 2 = throwing. The throw is a short
  // hand-rolled timeline (the clip system animates the weapon, not the arms)
  // that fires `onClipEvent('grenade:release')` at the release beat. The
  // active timeline is chosen by throwGrenade(type): 'long' is the big
  // overhead heave, 'short' the compact toss.
  _grenadeState: 0 | 1 | 2 = 0;
  _throwT: number = 0;
  _throwReleased: boolean = false;
  _throwKeys: (ViewPoseKey & { t: number })[] = GRENADE_THROW_KEYS;
  _throwDuration: number = GRENADE_THROW_T;
  _throwReleaseAt: number = GRENADE_RELEASE_AT;
  _cookType: string | null = null;
  _cookBlend: number = 0;
  _grenadeFingerR: Float32Array = new Float32Array(3);
  _grenadeBackR: Float32Array = new Float32Array(3);
  _grenadeFingerL: Float32Array = new Float32Array(3);
  _grenadeBackL: Float32Array = new Float32Array(3);
  // The templates also serve world projectiles/standalone previews. Own only
  // native view copies, never patch or dispose their global shared materials.
  _propMaterials: Map<THREE.Material, THREE.Material> = new Map();
  _radioState: number = 0; // 0 = stowed, 1 = held
  bandageAsset: Awaited<ReturnType<typeof loadBandage>> | null = null;
  _bandageState: number = 0;
  _bandageProgress: number = 0;
  _bandageFinger: Float32Array = new Float32Array(3);
  _bandageBack: Float32Array = new Float32Array(3);
  _bandageElbowL: THREE.Vector3 = new THREE.Vector3();
  _bandageElbowR: THREE.Vector3 = new THREE.Vector3();
  // Blender supplies the arms' UV PBR maps and local self-occlusion bake.
  // Body-fixed shoulders, expressed in camera space and re-based into rig
  // space every frame so the elbows do not swing when the gun moves.
  shoulderR: THREE.Vector3 = new THREE.Vector3(0.205, -0.2, 0.28);
  shoulderL: THREE.Vector3 = new THREE.Vector3(-0.2, -0.22, 0.02);
  // ---- reticle ----------------------------------------------------------
  reticle: THREE.Object3D = new THREE.Object3D();
  declare dotCore: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  scopeOverlay: THREE.Object3D = new THREE.Object3D();
  declare scopeMask: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  declare scopeReticle: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  _adsPos: THREE.Vector3 = new THREE.Vector3();
  _adsQuat: THREE.Quaternion = new THREE.Quaternion();
  _sightLocal: THREE.Vector3 = new THREE.Vector3();
  // ---- animation state --------------------------------------------------
  weapons: Map<WeaponEntry['id'], WeaponEntry> = new Map();
  // preallocated working state
  _basePos: THREE.Vector3 = new THREE.Vector3();
  _baseQuat: THREE.Quaternion = new THREE.Quaternion();
  _handPos: THREE.Vector3 = new THREE.Vector3();
  _handQuat: THREE.Quaternion = new THREE.Quaternion();
  _handPosL: THREE.Vector3 = new THREE.Vector3();
  _handQuatL: THREE.Quaternion = new THREE.Quaternion();
  _tmpPos: THREE.Vector3 = new THREE.Vector3();
  _tmpQuat: THREE.Quaternion = new THREE.Quaternion();
  _angVel: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 };
  _hasPrev: boolean = false;
  _prevPitch: number = 0;
  _prevYaw: number = 0;
  adsT: number = 0;
  bobPhase: number = 0;
  // clip playback
  clip: Clip | null = null;
  clipPrevT: number = 0;
  clipResult: ClipResult = makeSampleResult();
  clipT: number = 0;
  debugFrozen: boolean = false;
  // Frequencies/damping are fitted to the previous one-step-per-frame response at 60 Hz.
  jumpSpring: Spring = new Spring(4.9, 0.75);
  landSpring: Spring = new Spring(6.35, 0.87);
  lag: Spring3 = new Spring3(5.1, 0.62);
  lagRot: Spring3 = new Spring3(5.85, 0.61);
  lowReadyT: number = 0;
  noise: Noise1[] = [];
  noiseRates: number[] = [0.13, 0.19, 0.271, 0.083, 0.117, 0.163];
  noiseT: number = 0;
  onClipEvent: ((name: string, clipName: string) => void) | null = null;
  // Frequency and damping come from the weapon's recoil definition on every shot.
  recPos: Spring3 = new Spring3();
  recRot: Spring3 = new Spring3();
  settle: Spring3 = new Spring3(2.05, 0.77);
  sprintT: number = 0;
  triggerT: number = 0;

  constructor(ctx: ViewmodelContext, mats: ReticleMaterials) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();

    this.anchor.name = 'ow-viewmodel-anchor';
    this.rig.name = 'ow-viewmodel-rig';
    this.anchor.add(this.rig);
    ctx.viewScene.add(this.anchor);

    this.rig.add(this.armR.root);
    this.rig.add(this.armL.root);

    this.grenade.name = 'ow-grenade';
    this.grenade.scale.setScalar(1.35);
    // Palm-local: fingers -Z, palm -Y. Fuze on camera, spoon on the 3/4.
    this.grenade.position.set(0.0, -0.032, -0.068);
    this.grenade.rotation.set(Math.PI + 0.28, 0.78, 0.1);
    this.grenade.visible = false;
    this.armR.hand.add(this.grenade);

    this.radio.name = 'ow-radio';
    this.radio.position.set(0.0, -0.052, -0.05);
    this.radio.rotation.set(-Math.PI / 2, Math.PI, 0);
    this.radio.visible = false;
    this.armR.hand.add(this.radio);
    for (const root of [this.grenade, this.radio])
      root.traverse((o): void => {
        if (!isMesh(o) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
        const source = o.material;
        if (!this._propMaterials.has(source))
          this._propMaterials.set(source, createWeaponMaterial(source));
        const material = this._propMaterials.get(source);
        if (material) o.material = material;
      });
    const screen: unknown = this.radio.userData.screen;
    this.radioScreen = isRadioScreen(screen) ? screen : null;

    this.reticle.name = 'ow-reticle';
    this.anchor.add(this.reticle);
    // Unit-radius dot, scaled by its published angular size in _updateReticle.
    this.dotCore = new THREE.Mesh(new THREE.CircleGeometry(1, 32), mats.reticle(0xff1206, 0.95));
    this.dotCore.renderOrder = 21;
    this.dotCore.frustumCulled = false;
    this.dotCore.userData.owNoPrepass = true;
    this.dotCore.castShadow = false;
    this.reticle.add(this.dotCore);

    this.scopeOverlay.name = 'ow-scope';
    this.scopeOverlay.visible = false;
    this.anchor.add(this.scopeOverlay);
    // Fullscreen ADS overlays. The scene draws them at a fixed clip-space
    // position (vertexNode), so they do not depend on the world camera, and they
    // are authored in TSL like every other production material.
    const maskU = (this.maskUniforms = {
      uAlpha: TSL.uniform(1),
      uAspect: TSL.uniform(16 / 9),
      uSniper: TSL.uniform(0),
    });
    const mp = TSL.uv().mul(2).sub(1).toVar();
    const mr = TSL.length(TSL.vec2(mp.x.mul(maskU.uAspect), mp.y));
    const maskHole = TSL.float(0.72);
    const maskEdge = TSL.smoothstep(maskHole, maskHole.add(0.08), mr);
    const maskRim = TSL.smoothstep(maskHole.sub(0.012), maskHole, mr).mul(
      TSL.smoothstep(maskHole, maskHole.add(0.018), mr).oneMinus()
    );
    const maskMat = new MeshBasicNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    maskMat.vertexNode = TSL.vec4(TSL.positionLocal.xy, 0, 1);
    maskMat.colorNode = TSL.mix(TSL.vec3(0), TSL.vec3(0.02, 0.02, 0.018), maskRim.mul(0.35));
    // Sniper only: a defined aperture with restrained inner lens shadow. Keep
    // the existing MCX mask, color and transition completely unchanged.
    const sniperRadius = SNIPER_RETICLE.apertureRadius;
    const edgeAA = TSL.fwidth(mr).max(0.0001);
    const sniperEdge = TSL.smoothstep(
      TSL.float(sniperRadius).sub(edgeAA.mul(0.5)),
      TSL.float(sniperRadius).add(edgeAA.mul(0.5)),
      mr
    );
    const lensShadow = TSL.smoothstep(sniperRadius - 0.045, sniperRadius, mr).mul(0.18);
    maskMat.opacityNode = maskU.uSniper
      .greaterThan(0.5)
      .select(TSL.max(sniperEdge, lensShadow), maskEdge)
      .mul(maskU.uAlpha);
    maskMat.userData.owUniforms = maskU;
    const mask = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), maskMat);
    mask.frustumCulled = false;
    mask.renderOrder = 30;
    mask.userData.owNoPrepass = true;
    mask.castShadow = false;
    this.scopeOverlay.add(mask);
    this.scopeMask = mask;

    // Distance from p to the segment a-b, then the authored w-feathered edge.
    const line = (
      p: Node<'vec2'>,
      ax: number,
      ay: number,
      bx: number,
      by: number,
      w: number
    ): Node<'float'> => {
      const a = TSL.vec2(ax, ay);
      const pa = p.sub(a);
      const ba = TSL.vec2(bx, by).sub(a);
      const h = TSL.clamp(TSL.dot(pa, ba).div(TSL.dot(ba, ba)), 0, 1);
      return TSL.smoothstep(0, w, TSL.length(pa.sub(ba.mul(h)))).oneMinus();
    };
    const retU = (this.reticleUniforms = {
      uAlpha: TSL.uniform(1),
      uChevron: TSL.uniform(0),
      uAspect: TSL.uniform(16 / 9),
      uMradScale: TSL.uniform(sniperMradScale(20)),
    });
    const rp = TSL.uv().mul(2).sub(1).toVar();
    const rc = TSL.vec2(rp.x.mul(retU.uAspect), rp.y);
    let chevron = line(rc, -0.07, -0.07, 0, 0, 0.012).add(line(rc, 0, 0, 0.07, -0.07, 0.012));
    let stadia = line(rc, 0, -0.13, 0, -0.63, 0.006);
    for (let i = 1; i <= 4; i++) {
      const y = -0.14 - i * 0.1;
      const w = 0.12 - i * 0.018;
      stadia = stadia.add(line(rc, -w, y, w, y, 0.006));
    }
    const mil = sniperReticleCoverage(rc.div(retU.uMradScale));
    // The sniper quad reaches the aperture, unlike the original small overlay.
    const milRadius = TSL.length(rc);
    const milAA = TSL.fwidth(milRadius).max(0.0001);
    const milClip = TSL.smoothstep(
      TSL.float(sniperRadius).sub(milAA.mul(0.5)),
      TSL.float(sniperRadius).add(milAA.mul(0.5)),
      milRadius
    ).oneMinus();
    const chevronCol = TSL.mix(
      TSL.vec3(0.015),
      TSL.vec3(0.85, 0.04, 0.012),
      TSL.clamp(chevron, 0, 1)
    );
    const chevronAlpha = TSL.clamp(chevron.add(stadia), 0, 1).mul(retU.uAlpha);
    const milAlpha = mil.mul(milClip).mul(retU.uAlpha);
    const useChevron = retU.uChevron.greaterThan(0.5);
    const reticleMat = new MeshBasicNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    reticleMat.vertexNode = TSL.vec4(TSL.positionLocal.xy.mul(useChevron.select(0.55, 1)), 0, 1);
    reticleMat.colorNode = useChevron.select(chevronCol, TSL.vec3(0));
    reticleMat.opacityNode = useChevron.select(chevronAlpha, milAlpha);
    reticleMat.userData.owUniforms = retU;
    const milMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), reticleMat);
    milMesh.frustumCulled = false;
    milMesh.renderOrder = 31;
    milMesh.userData.owNoPrepass = true;
    milMesh.castShadow = false;
    this.scopeOverlay.add(milMesh);
    this.scopeReticle = milMesh;

    for (let i = 0; i < 6; i++) this.noise.push(new Noise1(this.rng, 512));
  }

  /** Mount a required authored GLB and its weapon-local animation adapter. */
  addWeapon(
    model: WeaponModelRecord,
    def: WeaponDef,
    config: AttachmentConfig = BASE_ATTACHMENTS,
    optics: OpticModels = {}
  ): WeaponEntry {
    let tris = 0;
    const meshes: THREE.Mesh[] = [];
    const animation = createWeaponAnimation(model, def);
    const group = new THREE.Object3D();
    group.name = `weapon-${model.id}`;
    group.visible = false;
    this.rig.add(group);
    group.add(model.scene);
    model.scene.traverse((node: THREE.Object3D): void => {
      if (!isMesh(node)) return;
      meshes.push(node);
      tris += triCount(node.geometry);
    });
    const n: WeaponNodes = model.nodes;
    // Adapters expose only detachable, cartridge-free magazine shells here.
    const parts = { magazine: animation.magazineBody };

    const entry: WeaponEntry = {
      id: model.id,
      attachments: BASE_ATTACHMENTS,
      attachmentGroup: new THREE.Group(),
      def,
      model,
      group,
      parts,
      meshes,
      tris,
      animation,
      clips: animation.clips(),
      // the sight point and its axis, in weapon space
      sight: new THREE.Vector3().fromArray(model.nodes.sight),
      muzzle: new THREE.Vector3().fromArray(model.nodes.muzzle),
      eject: new THREE.Vector3().fromArray(model.nodes.eject),
      ejectDir: new THREE.Vector3().fromArray(model.nodes.ejectDir).normalize(),
      optic: n.opticGlass ?? null,
      gripR: model.nodes.gripR,
      gripL: model.nodes.gripL,
      magLen: model.magSize.len,
      shell: model.shell,
      lhandPose: model.id === 'lmg' ? 'wrap' : 'clamp',
      rhandPose:
        model.id === 'lmg' ? 'gripLmg' : model.id === 'shotgun' ? 'gripShotgun' : 'gripRifle',
    };
    if ('handPoses' in model) {
      entry.rhandPose = `grip:${model.id}`;
      entry.lhandPose = `support:${model.id}`;
      this.armR.poses[entry.rhandPose] = model.handPoses.right;
      this.armL.poses[entry.lhandPose] = model.handPoses.left;
    } else {
      this._fitSupportHand(entry);
      this._fitGripContacts(entry);
    }
    configureWeaponAttachments(entry, config, optics);
    this.weapons.set(model.id, entry);
    return entry;
  }

  // Refine the baseline poses against weapon-specific thumb/trigger targets.
  _fitGripContacts(w: WeaponEntry): void {
    if (!hasOwn(GRIP_CONTACTS, w.id)) return;
    const contact = GRIP_CONTACTS[w.id];
    this.armR.hand.position.fromArray(w.gripR.pos);
    handBasis(
      this.armR.hand.quaternion,
      w.gripR.finger ?? [0, -0.35, -0.94],
      w.gripR.back ?? [0.95, 0.25, 0.18]
    );
    this.armR.setPose(w.rhandPose);
    w.rhandPose = `grip:${w.id}`;
    this.armR.fitGrip(w.rhandPose, {
      thumb: vec3(contact.rightThumb),
      index: vec3(contact.trigger),
      fingers: 'rightFingers' in contact ? contact.rightFingers : undefined,
      spread: FIRING_FINGER_SPREAD,
    });
    this.armL.hand.position.fromArray(w.gripL.pos);
    handBasis(
      this.armL.hand.quaternion,
      w.gripL.finger ?? [0.82, 0.5, -0.28],
      w.gripL.back ?? [-0.5, 0.32, -0.8]
    );
    this.armL.setPose(w.lhandPose);
    this.armL.fitGrip(w.lhandPose, {
      thumb: vec3(contact.leftThumb),
      thumbPole: 'leftThumbPole' in contact ? vec3(contact.leftThumbPole) : [-1, 0, 0],
      fingers: 'leftFingers' in contact ? contact.leftFingers : undefined,
      spread: 'leftSpread' in contact ? contact.leftSpread : undefined,
    });
  }

  // MCX retains fitted support-hand posing; weapon AO belongs to the authored asset.
  _fitSupportHand(w: WeaponEntry): void {
    const nodes: WeaponNodes = w.model.nodes;
    const hg = nodes.supportContact ?? nodes.handguard;
    const gL = w.gripL;
    if (!hg) return;
    this._handPosL.fromArray(gL.pos);
    handBasis(this._handQuatL, gL.finger ?? [0.82, 0.5, -0.28], gL.back ?? [-0.5, 0.32, -0.8]);
    const poseName = `clamp:${w.id}`;
    this.armL.setPose('clamp');
    this.armL.fitToCylinder(this._handPosL, this._handQuatL, vec3(hg.axis), vec3(hg.dir), hg.r, {
      clearance: 0.001,
      poseName,
    });
    w.lhandPose = poseName;
    this.armL.setPose(poseName);
  }

  setActive(id: WeaponEntry['id']): WeaponEntry | null {
    const w = this.weapons.get(id);
    if (!w || w === this.active) return this.active;
    if (this.active) {
      this.active.group.visible = false;
      this.active.animation.reset();
    }
    this.active = w;
    w.animation.reset();
    w.group.visible = true;
    this.recPos.reset();
    this.recRot.reset();
    this.settle.reset();
    if (w.parts.magazine) w.parts.magazine.visible = true;
    this.armR.setPose(w.rhandPose);
    // The FITTED clamp for this weapon, not the authored one — see _fitSupportHand.
    this.armL.setPose(w.lhandPose);
    return w;
  }

  play(name: string): number {
    const w = this.active;
    if (!w) return 0;
    const clip = w.clips[name] as (typeof w.clips)[string] | undefined;
    if (!clip) return 0;
    w.animation.reset();
    this.clip = clip;
    this.clipT = 0;
    this.clipPrevT = -1;
    return clip.duration;
  }

  stopClip(): void {
    this.active?.animation.reset();
    this.clip = null;
    this.clipResult.active = false;
    this.clipResult.lhand.weight = 0;
  }

  get clipName(): string | null {
    return this.clip?.name ?? null;
  }

  /** Arm a grenade: stow the weapon, grenade in the right hand. */
  holdGrenade(): void {
    if (this._grenadeState === 1) return;
    // The radio and the grenade are exclusive holds — one ends the other.
    if (this._radioState === 1) this.endRadio();
    if (this._bandageState === 1) this.endBandage();
    this._grenadeState = 1;
    this._throwT = 0;
    this._throwReleased = false;
    this._cookType = null;
    this._cookBlend = 0;
    this.grenade.visible = true;
    const w = this.active;
    if (w) w.group.visible = false;
  }

  /** Pin pulled: blend from the idle hold into the cook pose for `type`. */
  cookGrenade(type: string = 'long'): void {
    if (this._grenadeState !== 1) return;
    this._cookType = type === 'short' ? 'short' : 'long';
  }

  /** Release: the arm throws; fires `grenade:release` at the release beat.
   *  `type` selects the animation: 'long' (overhead heave) or 'short'
   *  (compact toss) — each has its own keyframes and release timing. */
  throwGrenade(type: string = 'long'): void {
    if (this._grenadeState !== 1) return;
    this._grenadeState = 2;
    this._throwT = 0;
    this._throwReleased = false;
    this._cookType = type === 'short' ? 'short' : 'long';
    this._cookBlend = 1;
    if (type === 'short') {
      this._throwKeys = GRENADE_THROW_SHORT_KEYS;
      this._throwDuration = GRENADE_SHORT_THROW_T;
      this._throwReleaseAt = GRENADE_SHORT_RELEASE_AT;
    } else {
      this._throwKeys = GRENADE_THROW_KEYS;
      this._throwDuration = GRENADE_THROW_T;
      this._throwReleaseAt = GRENADE_RELEASE_AT;
    }
  }

  /** End the grenade state without throwing (overcook / death / reset). */
  endGrenade(): void {
    if (this._grenadeState === 0) return;
    this._grenadeState = 0;
    this._throwT = 0;
    this._throwReleased = false;
    this._cookType = null;
    this._cookBlend = 0;
    this.grenade.visible = false;
    const w = this.active;
    if (w) w.group.visible = true;
  }

  holdRadio(): void {
    if (this._radioState === 1) return;
    if (this._grenadeState === 1) this.endGrenade();
    if (this._bandageState === 1) this.endBandage();
    this._radioState = 1;
    this.radio.visible = true;
    const w = this.active;
    if (w) w.group.visible = false;
  }

  endRadio(): void {
    if (this._radioState === 0) return;
    this._radioState = 0;
    this.radio.visible = false;
    const w = this.active;
    if (w) w.group.visible = true;
  }

  holdBandage(): void {
    if (this._bandageState === 1) return;
    if (this._grenadeState) this.endGrenade();
    if (this._radioState === 1) this.endRadio();
    this._bandageState = 1;
    this._bandageProgress = 0;
    if (this.bandageAsset) this.bandageAsset.roll.visible = true;
    const w = this.active;
    if (w) w.group.visible = false;
    this._syncBandage(0);
  }

  setBandageProgress(p: number): void {
    this._bandageProgress = clamp01(p);
  }

  endBandage(): void {
    if (this._bandageState === 0) return;
    this._bandageState = 0;
    this._bandageProgress = 0;
    if (this.bandageAsset) this.bandageAsset.roll.visible = false;
    this._syncBandage(0);
    const w = this.active;
    if (w) w.group.visible = true;
  }

  setRadioScreen(count: number): void {
    const screen = this.radioScreen;
    if (!screen) return;
    const old = screen.material.map;
    screen.material.map = radioScreenTexture(count);
    old?.dispose();
  }

  /**
   * World position the thrown grenade leaves from: the grenade mesh's
   * position at the release beat, in viewScene space (= world space because
   * the anchor tracks the camera).
   */
  grenadeReleaseWorld(out: THREE.Vector3): THREE.Vector3 {
    this.armR.root.updateMatrixWorld();
    out.setFromMatrixPosition(this.grenade.matrixWorld);
    return out;
  }

  /** Lerp two grenade pose keys into the shared hand targets. */
  _applyGrenadePose(a: ViewPoseKey, b: ViewPoseKey, w: number): void {
    this._handPos.set(
      a.hand[0] + (b.hand[0] - a.hand[0]) * w,
      a.hand[1] + (b.hand[1] - a.hand[1]) * w,
      a.hand[2] + (b.hand[2] - a.hand[2]) * w
    );
    const finger = this._grenadeFingerR;
    finger[0] = a.finger[0] + (b.finger[0] - a.finger[0]) * w;
    finger[1] = a.finger[1] + (b.finger[1] - a.finger[1]) * w;
    finger[2] = a.finger[2] + (b.finger[2] - a.finger[2]) * w;
    const back = this._grenadeBackR;
    back[0] = a.back[0] + (b.back[0] - a.back[0]) * w;
    back[1] = a.back[1] + (b.back[1] - a.back[1]) * w;
    back[2] = a.back[2] + (b.back[2] - a.back[2]) * w;
    handBasis(this._handQuat, finger, back);
    const rpose = w < 0.45 ? (a.rpose ?? 'grenade') : (b.rpose ?? 'grenade');
    if (this.armR.pose !== rpose) this.armR.setPose(rpose, 0.1);
    this.armR.solve(this._handPos, this._handQuat);
    const lpose = w < 0.45 ? (a.lpose ?? 'open') : (b.lpose ?? 'open');
    this._handPosL.set(
      a.lhand[0] + (b.lhand[0] - a.lhand[0]) * w,
      a.lhand[1] + (b.lhand[1] - a.lhand[1]) * w,
      a.lhand[2] + (b.lhand[2] - a.lhand[2]) * w
    );
    const lfinger = this._grenadeFingerL;
    lfinger[0] = a.lfinger[0] + (b.lfinger[0] - a.lfinger[0]) * w;
    lfinger[1] = a.lfinger[1] + (b.lfinger[1] - a.lfinger[1]) * w;
    lfinger[2] = a.lfinger[2] + (b.lfinger[2] - a.lfinger[2]) * w;
    const lback = this._grenadeBackL;
    lback[0] = a.lback[0] + (b.lback[0] - a.lback[0]) * w;
    lback[1] = a.lback[1] + (b.lback[1] - a.lback[1]) * w;
    lback[2] = a.lback[2] + (b.lback[2] - a.lback[2]) * w;
    handBasis(this._handQuatL, lfinger, lback);
    if (this.armL.pose !== lpose) this.armL.setPose(lpose, 0.1);
    this.armL.solve(this._handPosL, this._handQuatL);
  }

  /** Sample the grenade hand pose into the shared hand targets. */
  _solveGrenadeHands(): void {
    if (this._grenadeState === 2) {
      const t = smootherstep(0, 1, clamp01(this._throwT / this._throwDuration));
      const keys = this._throwKeys;
      let a = keys[0];
      let b = keys[keys.length - 1];
      let w = 1;
      for (let i = 0; i < keys.length - 1; i++) {
        if (keys[i + 1].t > t) {
          a = keys[i];
          b = keys[i + 1];
          const span = b.t - a.t;
          w = span > 1e-6 ? clamp01((t - a.t) / span) : 1;
          w = smootherstep(0, 1, w);
          break;
        }
      }
      this._applyGrenadePose(a, b, w);
      return;
    }
    const cook =
      this._cookType === 'short'
        ? GRENADE_COOK_SHORT
        : this._cookType === 'long'
          ? GRENADE_COOK_LONG
          : GRENADE_HOLD;
    const w = smootherstep(0, 1, this._cookBlend);
    this._applyGrenadePose(GRENADE_HOLD, cook, w);
  }

  /** Static radio hold: right hand grips it at chest height, left hangs. */
  _solveRadioHands(): void {
    this._handPos.set(RADIO_HOLD.hand[0], RADIO_HOLD.hand[1], RADIO_HOLD.hand[2]);
    handBasis(this._handQuat, RADIO_HOLD.finger, RADIO_HOLD.back);
    if (this.armR.pose !== 'radio') this.armR.setPose('radio');
    this.armR.solve(this._handPos, this._handQuat);
    this._handPosL.set(RADIO_HOLD.lhand[0], RADIO_HOLD.lhand[1], RADIO_HOLD.lhand[2]);
    handBasis(this._handQuatL, RADIO_HOLD.lfinger, RADIO_HOLD.lback);
    if (this.armL.pose !== 'open') this.armL.setPose('open');
    this.armL.solve(this._handPosL, this._handQuatL);
  }

  /** Left forearm presented; right hand winds the bandage as progress advances. */
  _solveBandageHands(): void {
    const p = this._bandageProgress;
    const wind = clamp01((p - 0.2) / 0.62);
    const finish = smootherstep(0, 1, (p - 0.93) / 0.07);
    const press = Math.sin(Math.PI * clamp01((p - 0.82) / 0.08)) ** 2;
    this._handPosL.fromArray(BANDAGE_L.hand);
    this._bandageElbowL.fromArray(BANDAGE_L.elbow);
    handBasis(this._handQuatL, BANDAGE_L.finger, BANDAGE_L.back);
    if (this.armL.pose !== 'bandageFist') this.armL.setPose('bandageFist', 0.12);
    this.armL.solve(this._handPosL, this._handQuatL, this._bandageElbowL);

    // Sample the authored guide in the solved left forearm's space.
    const at = wind * (BANDAGE_PATH.length - 1);
    const i = Math.min(BANDAGE_PATH.length - 2, Math.floor(at));
    const f = at - i;
    const a = BANDAGE_PATH[i],
      b = BANDAGE_PATH[i + 1];
    this.armL.forePivot.updateWorldMatrix(true, false);
    _v.set(lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f));
    // Restore the circular radius lost by linear guide interpolation. Both
    // winding and finishing stay on the fixed elbow's rigid reach sphere.
    const grow = 1 - BANDAGE_R.tensionSettle * press + BANDAGE_R.release * finish;
    const along = _v.z - BANDAGE_ELBOW_R[2];
    const radius = Math.sqrt(this.armR.l2 ** 2 - along ** 2) * grow;
    const scale = radius / Math.hypot(_v.x, _v.y);
    _v.x *= scale;
    _v.y *= scale;
    _v.z = BANDAGE_ELBOW_R[2] + Math.sqrt(this.armR.l2 ** 2 - radius ** 2);
    this.armL.forePivot.localToWorld(_v);
    this.rig.worldToLocal(_v);
    this._handPos.copy(_v);
    // The elbow stays planted. Keep the hand's long axis exactly in line with
    // the forearm, including between guide keys and during the finishing pull.
    this._bandageElbowR.fromArray(BANDAGE_ELBOW_R);
    this.armL.forePivot.localToWorld(this._bandageElbowR);
    this.rig.worldToLocal(this._bandageElbowR);
    // Blender's back-of-hand track supplies the small pronation adjustments.
    this.armL.forePivot.getWorldQuaternion(_q2);
    this.rig.getWorldQuaternion(_q).invert();
    _q2.premultiply(_q);
    const finger = this._bandageFinger;
    const back = this._bandageBack;
    _v.copy(this._handPos).sub(this._bandageElbowR).normalize();
    finger[0] = _v.x;
    finger[1] = _v.y;
    finger[2] = _v.z;
    _v.set(lerp(a[6], b[6], f), lerp(a[7], b[7], f), lerp(a[8], b[8], f))
      .applyQuaternion(_q2)
      .normalize();
    back[0] = _v.x;
    back[1] = _v.y;
    back[2] = _v.z;
    handBasis(this._handQuat, finger, back);
    const pose = p < 0.15 || p > 0.9 ? 'bandageLoose' : 'bandage';
    if (this.armR.pose !== pose) this.armR.setPose(pose, 0.12);
    if (p >= 0.12) {
      // Authored pressure beats: tighten on the pull, soften to feed the roll.
      // Keep a firm cylinder hold, with slightly different pressure per finger.
      const grip =
        clamp01(lerp(a[10], b[10], f) + 0.15 * press) *
        smootherstep(0, 1, (p - 0.12) / 0.08) *
        (1 - smootherstep(0, 1, (p - 0.9) / 0.08));
      const soft = BANDAGE_POSES.bandageLoose,
        firm = BANDAGE_POSES.bandage;
      for (let k = 0; k < 4; k++)
        for (let j = 0; j < 3; j++) {
          this.armR.fingers[k].joints[j].rotation.x = -lerp(
            soft.fingers[k][j],
            firm.fingers[k][j],
            clamp01(grip * (1.06 - 0.04 * k))
          );
        }
      for (let j = 0; j < 2; j++)
        this.armR.thumb.joints[j].rotation.x = -lerp(soft.thumb[j], firm.thumb[j], grip);
      this.armR.updateFlex();
    }
    this.armR.solve(this._handPos, this._handQuat, this._bandageElbowR);
    // Cloth and physical winding share the authored, nonuniform timing.
    this._syncBandage(lerp(a[9], b[9], f));
  }

  _syncBandage(feed: number): void {
    const asset = this.bandageAsset;
    if (!asset) return;
    const section = Math.floor(feed * BANDAGE_SEGMENTS);
    asset.wrap.geometry.setDrawRange(0, section * 24);
    // A roll actually pays out cloth: its diameter and face angle change.
    const radius = 1 - feed * 0.38;
    asset.body.scale.set(1, radius, radius);
    asset.cap.scale.copy(asset.body.scale);
    asset.body.rotation.x = feed * Math.PI * 4.8;
    asset.cap.rotation.x = asset.body.rotation.x;
    asset.tail.visible = this._bandageState === 1 && feed > 0 && this._bandageProgress < 0.9;
    if (!asset.tail.visible) return;
    const contact = BANDAGE_CONTACT[section];
    this.armR.hand.updateWorldMatrix(true, false);
    _v.set(0, -0.019 * radius, 0); // inner lip: the free span must not run through the roll
    _v2.set(1, -0.019 * radius, 0); // axle supplies the free end's width
    asset.roll.localToWorld(_v);
    asset.roll.localToWorld(_v2);
    asset.wrap.worldToLocal(_v);
    asset.wrap.worldToLocal(_v2);
    _v2.sub(_v).normalize();
    const pos = asset.tail.geometry.attributes.position;
    const x0 = _v.x,
      y0 = _v.y,
      z0 = _v.z;
    const x1 = Math.hypot(contact[0], contact[1]),
      z1 = contact[2];
    // Join the roll to the CURRENT contact, not a fixed +X waypoint. The
    // tensioned span stays outside the sleeve even across the azimuth seam.
    const angle0 = Math.atan2(y0, x0);
    const delta = Math.atan2(
      Math.sin(Math.atan2(contact[1], contact[0]) - angle0),
      Math.cos(Math.atan2(contact[1], contact[0]) - angle0)
    );
    const r0 = Math.hypot(x0, y0);
    for (let i = 0; i <= 12; i++) {
      const blend = i / 12;
      const free = Math.min(1, blend * 2);
      const seated = Math.max(0, blend * 2 - 1);
      const angle = angle0 + delta * seated;
      const r = blend <= 0.5 ? lerp(r0, x1 + 0.006, free) : x1 + 0.006 * (1 - seated);
      const x = r * Math.cos(angle),
        y = r * Math.sin(angle);
      const z = lerp(z0, z1, free);
      _v3
        .set(_v2.x * (1 - blend), _v2.y * (1 - blend), _v2.z * (1 - blend) + blend)
        .normalize()
        .multiplyScalar(BANDAGE_WIDTH * 0.5);
      pos.setXYZ(i * 2, x - _v3.x, y - _v3.y, z - _v3.z);
      pos.setXYZ(i * 2 + 1, x + _v3.x, y + _v3.y, z + _v3.z);
    }
    pos.needsUpdate = true;
    asset.tail.geometry.computeVertexNormals();
  }

  /**
   * Per-shot viewmodel kick. `pitch`/`yaw` are the aim-space recoil for this
   * shot (from the deterministic pattern) so the visual climb matches where the
   * bullets are actually going.
   */
  addRecoil(pitch: number, yaw: number, first = false): void {
    const w = this.active;
    if (!w) return;
    w.animation.fire();
    // MCX/P320 bake the kick; mechanism-only assets retain reactive recoil.
    if (!('reactiveFire' in w.model && w.model.reactiveFire)) return;
    const r = w.def.recoil;
    const ads = this.adsT;
    // Aiming braces the weapon: less travel, faster return.
    const scale = lerp(1, 0.54, ads) * (first ? 1.18 : 1);
    const jitter = 0.86 + this.rng.float() * 0.3;
    this.recPos.freq = r.freq;
    this.recPos.damping = r.damping;
    this.recRot.freq = r.freq * 0.92;
    this.recRot.damping = r.damping;
    // A velocity impulse of v0 on a spring of angular frequency w peaks at
    // roughly v0/w, so the kick amplitudes below are in real metres/radians.
    const wp = TAU * this.recPos.freq;
    const wr = TAU * this.recRot.freq;
    this.recPos.impulse(
      this.rng.signed() * r.kickBack * 0.2 * scale * wp,
      r.kickUp * scale * jitter * wp,
      r.kickBack * scale * jitter * wp
    );
    this.recRot.impulse(
      (pitch * 5.5 + r.pitch * 1.4) * scale * jitter * wr,
      (-yaw * 4.5 - this.rng.signed() * r.yaw * 0.8) * scale * wr,
      (this.rng.signed() * 0.4 + 0.6) * r.roll * scale * wr
    );
    // Slow settling drift after a burst — the muzzle keeps wandering a little.
    const ws = TAU * this.settle.freq;
    this.settle.impulse(
      this.rng.signed() * 0.0012 * scale * ws,
      0.0018 * scale * ws,
      this.rng.signed() * 0.003 * scale * ws
    );
  }

  jump(): void {
    this.jumpSpring.impulse(-1.2);
  }

  land(speed: number = 3): void {
    this.landSpring.impulse(clamp(speed * 0.45, 0.4, 3.4));
  }

  /** Load authored skins before adding weapons (which fits contact poses). */
  async loadArms(): Promise<void> {
    this.armAsset = await loadArmAsset();
    this.armR.attachAsset(this.armAsset);
    this.armL.attachAsset(this.armAsset);
    Object.assign(this.armR.poses, BANDAGE_POSES);
    Object.assign(this.armL.poses, BANDAGE_POSES);
    this.bandageAsset = await loadBandage();
    this.armR.hand.add(this.bandageAsset.roll);
    this.armL.forePivot.add(this.bandageAsset.wrap, this.bandageAsset.tail);
  }

  update(dt: number, s: ViewState): void {
    const w = this.active;
    if (!w) return;
    const def = w.def;
    // Defensive: a non-positive or absurd dt would integrate the whole
    // animation stack backwards (a negative step snaps ADS straight to 1).
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    this.armR.updatePose(dt);
    this.armL.updatePose(dt);

    this.syncToCamera();

    _e.setFromQuaternion(this.anchor.quaternion, 'YXZ');
    const yaw = _e.y;
    const pitch = _e.x;
    if (this._hasPrev && dt > 1e-5) {
      const dy = wrapPi(yaw - this._prevYaw) / dt;
      const dp = wrapPi(pitch - this._prevPitch) / dt;
      // Low-pass, then clamp: a teleport must not throw the gun off screen.
      this._angVel.yaw = damp(this._angVel.yaw, clamp(dy, -9, 9), 18, dt);
      this._angVel.pitch = damp(this._angVel.pitch, clamp(dp, -9, 9), 18, dt);
    } else {
      this._angVel.yaw = 0;
      this._angVel.pitch = 0;
    }
    this._prevYaw = yaw;
    this._prevPitch = pitch;
    this._hasPrev = true;

    const adsRate = 1 / Math.max(0.05, def.adsTime);
    // Pumping keeps held ADS; its authored handling motion remains additive.
    const wantAds =
      this.clip && this.clip.name !== 'draw' && this.clip.name !== 'pump' ? 0 : s.ads ? 1 : 0;
    // Linear rate with a smootherstep shaping: a spring here reads as mushy.
    this.adsT = clamp01(this.adsT + (wantAds ? adsRate : -adsRate * 1.25) * dt);
    const ads = smootherstep(0, 1, this.adsT);

    const sprintTarget = s.sprint && !this.clip ? 1 : 0;
    this.sprintT = damp(this.sprintT, sprintTarget, 9, dt);
    this.lowReadyT = damp(this.lowReadyT, s.lowReady ? 1 : 0, 8, dt);

    this.triggerT = damp(this.triggerT, s.trigger ? 1 : 0, 26, dt);

    const hipP = def.hipPos;
    const hipR = def.hipRot;
    this._basePos.set(hipP[0], hipP[1], hipP[2]);
    _e.set(hipR[0], hipR[1], hipR[2], 'XYZ');
    this._baseQuat.setFromEuler(_e);

    // Sprint / low-ready poses replace the hip pose.
    if (this.sprintT > 1e-3) {
      const p = def.sprintPos;
      const r = def.sprintRot;
      this._tmpPos.set(p[0], p[1], p[2]);
      _e.set(r[0], r[1], r[2], 'XYZ');
      this._tmpQuat.setFromEuler(_e);
      this._basePos.lerp(this._tmpPos, this.sprintT);
      this._baseQuat.slerp(this._tmpQuat, this.sprintT);
    }
    if (this.lowReadyT > 1e-3) {
      const p = def.lowReadyPos;
      const r = def.lowReadyRot;
      this._tmpPos.set(p[0], p[1], p[2]);
      _e.set(r[0], r[1], r[2], 'XYZ');
      this._tmpQuat.setFromEuler(_e);
      this._basePos.lerp(this._tmpPos, this.lowReadyT);
      this._baseQuat.slerp(this._tmpQuat, this.lowReadyT);
    }

    if (ads > 1e-4) {
      const cant = def.adsCant;
      _e.set(cant[0], cant[1], cant[2], 'XYZ');
      this._adsQuat.setFromEuler(_e);
      // sight point in rig space, then the translation that lands it on axis
      this._sightLocal.copy(w.sight).applyQuaternion(this._adsQuat);
      this._adsPos.set(0, 0, -def.eyeRelief).sub(this._sightLocal);
      this._basePos.lerp(this._adsPos, ads);
      this._baseQuat.slerp(this._adsQuat, ads);
    }

    const swayScale = def.swayScale * lerp(1, 0.22, ads) * lerp(1, 1.5, this.sprintT);
    this.noiseT += dt;
    const n = this.noise;
    const nr = this.noiseRates;
    const t = this.noiseT;
    // Layered, incommensurate rates: the pattern does not repeat in a session.
    const swayX = n[0].fbm(t * nr[0], 3) * 0.55 + n[3].fbm(t * nr[3] * 2.3, 2) * 0.45;
    const swayY = n[1].fbm(t * nr[1], 3) * 0.55 + n[4].fbm(t * nr[4] * 2.1, 2) * 0.45;
    const swayZ = n[2].fbm(t * nr[2], 2) * 0.6 + n[5].fbm(t * nr[5] * 1.7, 2) * 0.4;
    // Breathing: a slow 0.22 Hz cycle under the noise.
    const breath = Math.sin(t * 1.38) * 0.5 + Math.sin(t * 0.61 + 1.1) * 0.25;

    let px = swayX * 0.0075 * swayScale;
    let py = (swayY * 0.006 + breath * 0.0022) * swayScale;
    let pz = swayZ * 0.004 * swayScale;
    let rx = (swayY * 0.021 + breath * 0.006) * swayScale;
    let ry = swayX * 0.028 * swayScale;
    let rz = swayZ * 0.017 * swayScale;

    const speed = s.speed;
    const bobAmt =
      def.bobScale * clamp01(speed / 4.2) * lerp(1, 0.28, ads) * (s.airborne ? 0.25 : 1);
    if (speed > 0.05) {
      // Stride frequency scales with speed; sprint takes longer strides.
      this.bobPhase += dt * (3.1 + speed * 0.72) * (s.sprint ? 1.05 : 1);
      if (this.bobPhase > TAU * 64) this.bobPhase -= TAU * 64;
    }
    const bp = this.bobPhase;
    px += Math.sin(bp) * 0.0165 * bobAmt;
    py += (Math.abs(Math.cos(bp)) - 0.6) * 0.0125 * bobAmt;
    pz += Math.sin(bp * 2) * 0.0055 * bobAmt;
    rz += Math.sin(bp) * 0.031 * bobAmt;
    rx += Math.cos(bp * 2) * 0.014 * bobAmt;
    ry += Math.sin(bp + 0.6) * 0.019 * bobAmt;

    const lagScale = lerp(1, 0.42, ads);
    const av = this._angVel;
    this.lag.step(
      dt,
      clamp(-av.yaw * 0.019, -0.05, 0.05) * lagScale,
      clamp(av.pitch * 0.014, -0.04, 0.04) * lagScale,
      clamp(-Math.abs(av.yaw) * 0.006, -0.03, 0.03) * lagScale
    );
    this.lagRot.step(
      dt,
      clamp(-av.pitch * 0.075, -0.24, 0.24) * lagScale,
      clamp(av.yaw * 0.085, -0.3, 0.3) * lagScale,
      clamp(-av.yaw * 0.055, -0.2, 0.2) * lagScale
    );
    px += this.lag.x;
    py += this.lag.y;
    pz += this.lag.z;
    rx += this.lagRot.x;
    ry += this.lagRot.y;
    rz += this.lagRot.z;

    this.recPos.step(dt, 0, 0, 0);
    this.recRot.step(dt, 0, 0, 0);
    this.settle.step(dt, 0, 0, 0);
    px += this.recPos.x;
    py += this.recPos.y;
    pz += this.recPos.z;
    rx += this.recRot.x + this.settle.y;
    ry += this.recRot.y + this.settle.x;
    rz += this.recRot.z + this.settle.z;

    this.jumpSpring.step(dt, 0);
    this.landSpring.step(dt, 0);
    py -= this.landSpring.value * 0.014 + this.jumpSpring.value * 0.006;
    rx -= this.landSpring.value * 0.05;

    const res = this.clipResult;
    if (this.clip) {
      this.clipT += dt;
      const c = this.clip;
      const tt = clamp(this.clipT, 0, c.duration);
      c.sample(tt, res);
      for (const ev of c.events) {
        if (ev.t > this.clipPrevT && ev.t <= tt) this.onClipEvent?.(ev.name, c.name);
      }
      this.clipPrevT = tt;
      px += res.pos[0];
      py += res.pos[1];
      pz += res.pos[2];
      rx += res.rot[0];
      ry += res.rot[1];
      rz += res.rot[2];
      // An end callback can start draw (or the next tube reload) immediately.
      // Do not clear that new clip while finishing the previous one.
      if (this.clip === c && this.clipT >= c.duration) {
        this.stopClip();
      }
    }

    if (this._grenadeState === 1) {
      const k = dt / GRENADE_COOK_BLEND_T;
      this._cookBlend = clamp01(this._cookBlend + (this._cookType ? k : -k));
    }
    if (this._grenadeState === 2 && !this.debugFrozen) {
      this._throwT += dt;
      if (!this._throwReleased && this._throwT >= this._throwReleaseAt) {
        this._throwReleased = true;
        this.grenade.visible = false;
        this.onClipEvent?.('grenade:release', 'grenadeThrow');
      }
      if (this._throwT >= this._throwDuration) {
        this._grenadeState = 0;
        this._throwT = 0;
        const w = this.active;
        if (w) w.group.visible = true;
        this.play('draw'); // the rifle comes back up
        this.onClipEvent?.('grenade:done', 'grenadeThrow');
      }
    }

    this.rig.position.set(this._basePos.x + px, this._basePos.y + py, this._basePos.z + pz);
    _e.set(rx, ry, rz, 'XYZ');
    _q.setFromEuler(_e);
    this.rig.quaternion.copy(this._baseQuat).multiply(_q);
    if (this._bandageState) {
      // No idle sway, weapon recoil or weapon-specific hip transform can move
      // the braced left forearm while the other hand winds around it.
      const present = smootherstep(0, 1, this._bandageProgress / 0.16);
      const stow = smootherstep(0, 1, (this._bandageProgress - 0.93) / 0.07);
      this.rig.position.set(0, -0.35 * (1 - present + stow), 0);
      this.rig.quaternion.identity();
    }
    this.rig.updateMatrix();
    this.rig.updateMatrixWorld(true);

    // Baked parts must be sampled before solving arms and querying sockets.
    w.animation.update(dt, this.clipName, this.clipT, s.empty, s.magazineLoaded, s.remainingRounds);
    this._solveHands(w, res);

    const fovBase = 60;
    const targetFov = fovBase * lerp(1, def.viewFov, ads);
    const vcam = this.ctx.viewCamera;
    if (Math.abs(vcam.fov - targetFov) > 1e-3) {
      vcam.fov = targetFov;
      vcam.updateProjectionMatrix();
    }
    // Reticle sizing must use the projection that renders this same frame.
    this._updateReticle(w, ads);
    this._updateScope(w, ads);
  }

  _solveHands(w: WeaponEntry, res: ClipResult): void {
    if (this._bandageState) {
      // Raise/stow the authored pose as a unit. Neither elbow nor upper arm
      // participates in the winding motion; only the right forearm and hand do.
      this.armL.shoulder.fromArray(BANDAGE_L.shoulder);
      this.armR.shoulder.fromArray(BANDAGE_R.shoulder);
      this.armL.bodyUp.set(0, 1, 0);
      this.armR.bodyUp.set(0, 1, 0);
      this._solveBandageHands();
      return;
    }
    // Weapon shoulders are body-fixed: express camera-space anchors in rig space.
    _q.copy(this.rig.quaternion).invert();
    const hipShoulderZ = w.def.firingShoulderZ ?? 0.28;
    this.shoulderR.z = lerp(
      hipShoulderZ,
      w.def.adsFiringShoulderZ ?? hipShoulderZ,
      smootherstep(0, 1, this.adsT)
    );
    _v.copy(this.shoulderR).sub(this.rig.position).applyQuaternion(_q);
    this.armR.shoulder.copy(_v);
    this.shoulderL.z = w.def.supportShoulderZ ?? 0.02;
    _v.copy(this.shoulderL).sub(this.rig.position).applyQuaternion(_q);
    this.armL.shoulder.copy(_v);
    this.armR.bodyUp.set(0, 1, 0).applyQuaternion(_q);
    this.armL.bodyUp.copy(this.armR.bodyUp);
    this.armR.bodyRight.set(1, 0, 0).applyQuaternion(_q);
    this.armL.bodyRight.copy(this.armR.bodyRight);
    this.armR.pole.set(0.46, -0.86, 0.22).normalize().applyQuaternion(_q);
    this.armL.pole.set(-0.46, -0.86, 0.22).normalize().applyQuaternion(_q);

    // Grenade state: both arms leave the weapon and work the grenade.
    if (this._grenadeState) {
      this._solveGrenadeHands();
      return;
    }

    // Radio state: the right hand holds the radio at the chest; the left
    // hangs free. Mutually exclusive with the grenade by construction.
    if (this._radioState) {
      this._solveRadioHands();
      return;
    }

    // ---- shooting hand: welded to the grip ----
    const gR = w.gripR;
    this._handPos.fromArray(gR.pos);
    handBasis(this._handQuat, gR.finger ?? [0, -0.35, -0.94], gR.back ?? [0.95, 0.25, 0.18]);
    let poseR = w.rhandPose;

    if (poseR !== this.armR.pose) this.armR.setPose(poseR, 0.1);
    w.animation.handTarget?.('right', this._handPos, this._handQuat);
    this.armR.solve(this._handPos, this._handQuat);
    this.armR.setTrigger(this.triggerT);

    // ---- support hand: grip, or wherever the clip puts it ----
    const gL = w.gripL;
    let pos = gL.pos;
    let finger = gL.finger ?? [0.82, 0.5, -0.28];
    let back = gL.back ?? [-0.5, 0.32, -0.8];
    let pose = w.lhandPose;
    if (res.active && res.lhand.weight > 0.5) {
      pos = res.lhand.pos;
      finger = res.lhand.finger;
      back = res.lhand.back;
      pose = res.lhand.pose;
      // Clip keys that hold the weapon (return beats, and the whole pump stroke)
      // carry the generic wrap label; restore the fitted contact pose whenever the
      // hand is on the support grip — at rest, or riding the forend's travel.
      if (pose === 'wrap' || pose === 'clamp') {
        if (
          Math.abs(pos[0] - gL.pos[0]) +
            Math.abs(pos[1] - gL.pos[1]) +
            Math.abs(pos[2] - gL.pos[2]) <
          1e-5
        ) {
          pose = w.lhandPose;
        }
      }
    }
    this._handPosL.set(pos[0], pos[1], pos[2]);
    handBasis(this._handQuatL, finger, back);
    w.animation.handTarget?.('left', this._handPosL, this._handQuatL);
    pose = w.animation.leftPose ?? pose;
    if (pose !== this.armL.pose) this.armL.setPose(pose, 0.1);
    this.armL.solve(this._handPosL, this._handQuatL);
    w.animation.applyHands?.(this.armL, this.armR);
  }

  /**
   * The collimated dot.
   *
   * A red dot sight is a collimator: the reticle sits at optical infinity along
   * the tube axis, so its apparent direction from the eye is the tube axis —
   * independent of where the eye is. Reproducing that exactly (rather than
   * gluing a sprite to the glass) is why the dot stays on target while the
   * weapon sways, and why it vignettes out when you look through the tube from
   * an angle.
   */
  _updateReticle(w: WeaponEntry, ads: number): void {
    const optic = w.optic;
    if (!optic || optic.kind === 'scope') {
      this.reticle.visible = false;
      return;
    }
    _v.fromArray(optic.center);
    _v3.set(0, 0, -1);
    // Mounted optics follow the animated authored root; integrated optic data
    // retains its existing weapon-space convention.
    if (w.attachments.optic !== null) {
      _v.applyMatrix4(w.model.root.matrix);
      _v3.transformDirection(w.model.root.matrix);
    }
    _v.applyQuaternion(this.rig.quaternion).add(this.rig.position);
    _v3.applyQuaternion(this.rig.quaternion).normalize();

    // Where the axis ray from the eye crosses the lens plane.
    const s = _v.dot(_v3);
    if (s <= 0.02) {
      this.reticle.visible = false;
      return;
    }
    _v2.copy(_v3).multiplyScalar(s); // dot position in camera space
    // Vignette: how far off the lens centre the apparent dot lands.
    const offX = _v2.x - _v.x;
    const offY = _v2.y - _v.y;
    const off = Math.hypot(offX, offY);
    const apertureR = optic.apertureR ?? 0.01;
    let alpha = 1 - smootherstep(apertureR * 0.5, apertureR * 1.05, off);
    alpha *= lerp(0.55, 1, ads); // brighter once the eye is behind the glass

    if (alpha <= 0.01) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.position.copy(_v2);
    this.reticle.lookAt(this.anchor.getWorldPosition(_v));
    // Published angular diameter, independent of eye distance/stance. Below
    // pixel resolution, use the optic's explicit small readability floor.
    // MOA belongs to the target/world view, not the independently framed
    // weapon camera. Narrowing weapon FOV must not magnify the dot.
    const worldTan = Math.tan((this.ctx.camera.fov * Math.PI) / 360);
    const viewTan = Math.tan((this.ctx.viewCamera.fov * Math.PI) / 360);
    const angularR = Math.tan(((optic.dotMoa ?? 0) * Math.PI) / (180 * 120)) / worldTan;
    const height = this.ctx.get('render')?.screenSize.height ?? this.ctx.canvas.height;
    this.dotCore.scale.setScalar(
      s * viewTan * Math.max(angularR, (optic.minDotPixels ?? 0) / height)
    );
    this.dotCore.material.opacity = alpha * (optic.dotOpacity ?? 1);
  }

  _updateScope(w: WeaponEntry, ads: number): void {
    // Holster 'end' calls setActive() earlier in this same update(). Always
    // drive visibility from the live weapon so we don't undig the one we hid.
    if (this.active) w = this.active;
    const optic = w.optic;
    const scoped = optic?.kind === 'scope';
    const accessory = this._grenadeState || this._radioState || this._bandageState;
    this.scopeOverlay.visible = scoped && ads > 0.85 && !accessory;
    const gunVisible = !scoped || 1 - smootherstep(0.72, 0.96, ads) > 0.02;
    const armsVisible = Boolean(accessory || gunVisible);
    if (!accessory) w.group.visible = gunVisible;
    this.armL.root.visible = armsVisible;
    this.armR.root.visible = armsVisible;
    const mask = this.maskUniforms;
    mask.uAlpha.value = smootherstep(0.82, 0.97, ads);
    mask.uAspect.value = this.ctx.viewCamera.aspect;
    mask.uSniper.value = optic?.reticle === 'p4fl' ? 1 : 0;
    const reticle = this.reticleUniforms;
    reticle.uAlpha.value = smootherstep(0.88, 0.99, ads);
    reticle.uChevron.value = optic?.reticle === 'chevron' ? 1 : 0;
    reticle.uAspect.value = this.ctx.viewCamera.aspect;
    reticle.uMradScale.value = sniperMradScale(this.ctx.camera.fov, this.ctx.camera.zoom);
  }

  /** Copy the gameplay camera onto the viewmodel anchor and view camera. */
  syncToCamera(): void {
    const cam = this.ctx.camera;
    const vcam = this.ctx.viewCamera;
    cam.updateMatrixWorld();
    this.anchor.position.setFromMatrixPosition(cam.matrixWorld);
    this.anchor.quaternion.setFromRotationMatrix(cam.matrixWorld);
    // Force the hierarchy: child updateMatrixWorld() does not refresh ancestors,
    // so a stale vibrated matrixWorld would leak into muzzleWorld().
    this.anchor.updateMatrixWorld(true);
    vcam.position.copy(this.anchor.position);
    vcam.quaternion.copy(this.anchor.quaternion);
  }

  /** Muzzle position in WORLD space (for the flash and the shell). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    w.group.updateMatrixWorld();
    return requiredSocket(w.model.root, 'SOCKET_muzzle').getWorldPosition(out);
  }

  ejectWorld(out: THREE.Vector3): THREE.Vector3 {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    w.group.updateMatrixWorld();
    return requiredSocket(w.model.root, 'SOCKET_ejection').getWorldPosition(out);
  }

  ejectVelocity(out: THREE.Vector3, speed = 2.6): THREE.Vector3 {
    const w = this.active;
    if (!w) return out.set(0, 0, 0);
    out.copy(w.ejectDir);
    out.applyQuaternion(w.animation.poseQ);
    out.transformDirection(w.group.matrixWorld).multiplyScalar(speed);
    return out;
  }

  /** Bore direction in world space. */
  boreDir(out: THREE.Vector3): THREE.Vector3 {
    const w = this.active;
    if (!w) return out.set(0, 0, -1);
    out.set(0, 0, -1);
    out.applyQuaternion(w.animation.poseQ);
    out.transformDirection(w.group.matrixWorld).normalize();
    return out;
  }

  // Engine teardown disposes every system, even one whose init never ran or failed.
  /* oxlint-disable typescript/no-unnecessary-condition */
  dispose(): void {
    for (const w of this.weapons.values()) {
      releaseAttachmentMount(w.attachmentGroup);
      w.animation.dispose();
      for (const m of w.meshes) m.geometry.dispose();
    }
    this.weapons.clear();
    this.armL.dispose();
    this.armR.dispose();
    this.armAsset?.dispose();
    // Radio geometry is instance-owned; the grenade's geometry is shared with
    // world projectiles and must not be released with the arm skin.
    this.radio?.traverse((o): void => {
      if (isMesh(o)) o.geometry.dispose();
    });
    for (const material of this._propMaterials.values()) material.dispose();
    this._propMaterials.clear();
    this.bandageAsset?.dispose();
    this.bandageAsset?.roll.removeFromParent();
    this.bandageAsset?.wrap.removeFromParent();
    this.bandageAsset?.tail.removeFromParent();
    this.dotCore.geometry.dispose();
    this.scopeMask?.geometry.dispose();
    this.scopeMask?.material.dispose();
    this.scopeReticle?.geometry.dispose();
    this.scopeReticle?.material.dispose();
    this.radio?.removeFromParent();
    this.anchor.removeFromParent();
  }
  /* oxlint-enable typescript/no-unnecessary-condition */
}

export type ViewModel = Viewmodel;

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return 'isMesh' in object && object.isMesh === true;
}

function isRadioScreen(
  screen: unknown
): screen is THREE.Mesh<THREE.BufferGeometry, MeshPhysicalNodeMaterial> {
  return (
    screen instanceof THREE.Mesh &&
    screen.geometry instanceof THREE.BufferGeometry &&
    screen.material instanceof MeshPhysicalNodeMaterial
  );
}

function requiredSocket(root: THREE.Object3D, name: string): THREE.Object3D {
  const socket = root.getObjectByName(name);
  if (!socket) throw new Error(`[weapons] missing ${name}`);
  return socket;
}

function vec3(value: readonly number[]): [number, number, number] {
  if (value.length !== 3) throw new Error('[weapons] expected a three-component node');
  return [value[0], value[1], value[2]];
}
