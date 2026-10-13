import type * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import type { EngineContext, EngineSystems } from '../core/context.ts';
import type { WEAPON_DEFS } from './defs.ts';
import type { Clip, ClipSample } from './clips.ts';
import type { WeaponMaterialsNode } from './materials-tsl.ts';
import type { Arm } from './hands.ts';
import type { Assembly } from './geometry.ts';
import type { WeaponRecord } from '../core/models.ts';
import type { loadM4 } from './m4.ts';
import type { loadMCX } from './mcx.ts';
import type { loadP320 } from './p320.ts';
import type { loadEvolys } from './evolys.ts';
import type { loadMPX } from './mpx.ts';
import type { loadAX338 } from './ax338.ts';

type Definitions = typeof WEAPON_DEFS[keyof typeof WEAPON_DEFS];
type UnionKeys<T> = T extends T ? keyof T : never;
type UnionValue<T, K extends PropertyKey> = T extends T ? K extends keyof T ? T[K] : never : never;
/** Common tuning is required; weapon-specific tuning is optional on a live slot. */
export type WeaponDef = { [K in keyof Definitions]: Definitions[K] } & {
  [K in Exclude<UnionKeys<Definitions>, keyof Definitions>]?: UnionValue<Definitions, K>
} & { cycleTime?: number; firingShoulderZ?: number; adsFiringShoulderZ?: number; supportShoulderZ?: number };
type WeaponId = keyof typeof WEAPON_DEFS;
type WeaponMode = WeaponDef['modes'][number];
export interface WeaponState {
  def: WeaponDef; pattern: Float32Array; mag: number; chambered: boolean;
  reserve: number; mode: WeaponMode; modeIndex: number;
}
export type AuthoredModels = {
  rifle: Awaited<ReturnType<typeof loadM4>>; mcx: Awaited<ReturnType<typeof loadMCX>>;
  pistol: Awaited<ReturnType<typeof loadP320>>; lmg: Awaited<ReturnType<typeof loadEvolys>>;
  smg: Awaited<ReturnType<typeof loadMPX>>; sniper: Awaited<ReturnType<typeof loadAX338>>;
};
export type AuthoredWeaponModel = AuthoredModels[keyof AuthoredModels];
export type WeaponAssembly = Assembly | THREE.Object3D;
export interface GripData { pos: number[]; finger?: number[]; back?: number[] }
export interface TransformData { pos: number[]; rot?: number[] }
export interface CylinderContact { axis: [number, number, number]; dir: [number, number, number]; r: number; z0: number; z1: number }
export interface OpticData {
  kind?: string; reticle?: string; center: number[]; apertureR?: number;
  dotMoa?: number; minDotPixels?: number; dotOpacity?: number;
}
export interface WeaponNodes {
  sight: number[]; muzzle: number[]; eject: number[]; ejectDir?: number[];
  opticGlass?: OpticData | null; magSeat: { pos: number[]; rot: number[] };
  gripR: GripData; gripL: GripData; chargePull?: number[]; boltTravel?: number[]; triggerPull?: number;
  chargeRest?: TransformData; boltRest?: TransformData; triggerPivot?: TransformData; selectorPivot?: TransformData;
  supportContact?: CylinderContact; handguard?: { axis: number[]; dir: number[]; r: number; z0: number; z1: number };
}
export interface ProceduralWeaponModel {
  id: string; body: WeaponAssembly; moving?: Record<string, WeaponAssembly>;
  nodes: WeaponNodes; shell?: { caseLen: number; rimR: number }; magSize?: { len: number };
}
export type WeaponModelRecord = AuthoredWeaponModel | WeaponRecord | ProceduralWeaponModel;
export function isAuthoredWeapon(model: WeaponModelRecord): model is AuthoredWeaponModel {
  return 'animations' in model;
}
/** Each authored loader owns one adapter identity; procedural records have no clips. */
export function isWeaponAdapter<K extends keyof AuthoredModels>(model: WeaponModelRecord, id: K): model is AuthoredModels[K] {
  return isAuthoredWeapon(model) && model.id === id;
}
export interface WeaponEntry {
  id: string; def: WeaponDef; model: WeaponModelRecord; group: THREE.Object3D;
  parts: Record<string, THREE.Object3D | undefined>; meshes: THREE.Mesh[]; tris: number;
  animation: WeaponAnimation | null; clips: Record<string, Clip>;
  sight: THREE.Vector3; muzzle: THREE.Vector3; eject: THREE.Vector3; ejectDir: THREE.Vector3;
  optic: OpticData | null; magSeatPos: THREE.Vector3; magSeatQuat: THREE.Quaternion;
  gripR: GripData; gripL: GripData; chargePull: THREE.Vector3; boltTravel: THREE.Vector3;
  triggerPull: number; magLen: number; shell?: { caseLen: number; rimR: number };
  lhandPose: string; rhandPose: string;
}
export interface WeaponAnimation {
  clips(): Record<string, Clip>; reset(): void;
  update(dt: number, clipName: string | null, clipT: number, empty: boolean, magazineLoaded?: boolean, remainingRounds?: number): void;
  fire(): void; dispose(): void; magazineBody?: THREE.Object3D;
  poseQ: THREE.Quaternion; handTarget?(side: 'left' | 'right', position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  leftPose?: string | null; applyHands?(left: Arm, right: Arm): void;
}
export interface ViewState {
  ads: boolean; sprint: boolean; lowReady: boolean; speed: number; crouch: boolean;
  airborne: boolean; trigger: boolean; empty: boolean; magazineLoaded?: boolean; remainingRounds?: number;
}
export interface ViewPoseKey {
  t?: number; hand: number[]; finger: number[]; back: number[]; lhand: number[];
  lfinger: number[]; lback: number[]; rpose?: string; lpose?: string;
}
export type ViewmodelContext = Pick<EngineContext, 'scene' | 'camera' | 'viewScene' | 'viewCamera' | 'canvas' | 'rng'> & {
  get(id: 'render'): Pick<EngineSystems['render'], 'screenSize'> | null;
};
export interface MaskShapeOptions { wearAmp?: number; grimeAmp?: number; aoAmp?: number; wearExp?: number; grimeExp?: number; aoExp?: number }
export interface WeaponRuntimeDependencies { rng: Rng; mats: WeaponMaterialsNode }
export type WeaponKey = WeaponId;
export type ClipResult = ClipSample;
export type WeaponAnimationModel = AuthoredWeaponModel;
