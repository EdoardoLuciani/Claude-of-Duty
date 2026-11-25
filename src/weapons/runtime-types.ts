import type * as THREE from 'three';

import type { EngineContext, EngineSystems } from '../core/context.ts';
import type { AttachmentConfig, BuiltWeaponDef, OpticData } from './attachment-rules.ts';
import type { loadAX338 } from './ax338.ts';
import type { Clip } from './clips.ts';
import type { WeaponDef, WeaponId, WeaponMode } from './defs.ts';
import type { loadEvolys } from './evolys.ts';
import type { Arm } from './hands.ts';
import type { loadM4 } from './m4.ts';
import type { loadM590 } from './m590.ts';
import type { loadMCX } from './mcx.ts';
import type { loadMPX } from './mpx.ts';
import type { loadP320 } from './p320.ts';

export interface WeaponState {
  /** Private copy of the authored definition plus the stored build's stats. */
  def: BuiltWeaponDef;
  /** The gun's one stored build; its viewmodel entry only holds the mounted instances. */
  attachments: AttachmentConfig;
  laserEnabled: boolean;
  pattern: Float32Array;
  mag: number;
  chambered: boolean;
  /** Sum of the spare packs; never stored separately. */
  readonly reserve: number;
  /** Nonempty spare magazines, belts, or shell bundles, fullest first. */
  readonly spareMagazines: number[];
  mode: WeaponMode;
  modeIndex: number;
}
export type AuthoredModels = {
  rifle: Awaited<ReturnType<typeof loadM4>>;
  mcx: Awaited<ReturnType<typeof loadMCX>>;
  pistol: Awaited<ReturnType<typeof loadP320>>;
  lmg: Awaited<ReturnType<typeof loadEvolys>>;
  smg: Awaited<ReturnType<typeof loadMPX>>;
  sniper: Awaited<ReturnType<typeof loadAX338>>;
  shotgun: Awaited<ReturnType<typeof loadM590>>;
};
export type AuthoredWeaponModel = AuthoredModels[WeaponId];
export type WeaponModelRecord = AuthoredWeaponModel;
export interface WeaponEntry {
  id: WeaponId;
  opticGroup: THREE.Group;
  railGroup: THREE.Group;
  muzzleGroup: THREE.Group;
  /** The weapon's own `SOCKET_muzzle`, resolved before any can (whose endcap shares
   * that name) is mounted. Never look the bore exit up by name afterwards. */
  readonly baseMuzzleSocket: THREE.Object3D;
  /** Active bore exit: a mounted can's endcap, else `baseMuzzleSocket`. */
  muzzleSocket: THREE.Object3D;
  readonly ejectionSocket: THREE.Object3D;
  laserEmitter: THREE.Object3D | null;
  /** Mounted optic: live parent, mount-local sight datum and catalog presentation. */
  mountedOptic: { mount: THREE.Object3D; sight: THREE.Vector3; optic: OpticData } | null;
  def: WeaponDef;
  model: WeaponModelRecord;
  group: THREE.Object3D;
  parts: Record<string, THREE.Object3D | undefined>;
  meshes: THREE.Mesh[];
  tris: number;
  animation: WeaponAnimation;
  clips: Record<string, Clip>;
  sight: THREE.Vector3;
  /** ADS eye distance for the mounted optic, else the authored iron-sight value. */
  eyeRelief: number;
  ejectDir: THREE.Vector3;
  magLen: number;
  shell?: { caseLen: number; rimR: number };
  lhandPose: string;
  rhandPose: string;
}
export interface WeaponAnimation {
  clips(): Record<string, Clip>;
  reset(): void;
  update(
    dt: number,
    clipName: string | null,
    clipT: number,
    empty: boolean,
    magazineLoaded?: boolean,
    remainingRounds?: number
  ): void;
  fire(): void;
  dispose(): void;
  magazineBody?: THREE.Object3D;
  /** Seconds from a shot until its case leaves the port; else the shot cadence decides. */
  ejectDelay?: number;
  poseQ: THREE.Quaternion;
  handTarget(side: 'left' | 'right', position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  applyHands(left: Arm, right: Arm): void;
}
export interface ViewState {
  ads: boolean;
  sprint: boolean;
  lowReady: boolean;
  speed: number;
  crouch: boolean;
  airborne: boolean;
  empty: boolean;
  magazineLoaded?: boolean;
  remainingRounds?: number;
  /** Stance/movement factor on hip sway. */
  steadiness: number;
}
export interface ViewPoseKey {
  t?: number;
  hand: number[];
  finger: number[];
  back: number[];
  lhand: number[];
  lfinger: number[];
  lback: number[];
  rpose?: string;
  lpose?: string;
}
export type ViewmodelContext = Pick<
  EngineContext,
  'scene' | 'camera' | 'viewScene' | 'viewCamera' | 'rng'
> & {
  canvas: Pick<HTMLCanvasElement, 'height'>;
  get(id: 'render'): Pick<EngineSystems['render'], 'screenSize'> | null;
};
