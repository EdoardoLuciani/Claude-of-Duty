import type { BufferGeometry, Object3D } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ModelVec3 = [number, number, number];
export interface ModelHandNode { pos: ModelVec3; finger?: ModelVec3; back?: ModelVec3 }
export interface ModelTransform { pos: ModelVec3; rot: ModelVec3 }
export interface WeaponNodes {
  muzzle: ModelVec3; chamber: ModelVec3; eject: ModelVec3; ejectDir?: ModelVec3; sight: ModelVec3;
  gripR: ModelHandNode; gripL: ModelHandNode;
  handguard: { axis: ModelVec3; dir: ModelVec3; r: number; z0: number; z1: number };
  magSeat: ModelTransform; chargeRest: ModelTransform; chargePull?: ModelVec3;
  boltRest: ModelTransform; boltTravel?: ModelVec3; triggerPivot: ModelTransform; triggerPull?: number;
}
export interface WeaponMetadata {
  label: string; fxClass: string; nodes: WeaponNodes;
  shell: { caseLen: number; rimR: number }; magSize: { len: number };
}
export interface WeaponRecord extends WeaponMetadata {
  id: string; body: Object3D; moving: Record<string, Object3D>;
}
export interface SoldierWeapon {
  muzzle: ModelVec3; foregrip: ModelVec3; magBottom: ModelVec3;
  ejection: ModelVec3; stockTop: ModelVec3;
}
export interface SoldierVariant {
  camo: string; clothTint: ModelVec3; gearTint: ModelVec3; plateTint: ModelVec3; skinTint: ModelVec3;
  helmet: boolean; helmetCover?: boolean; helmetTint?: ModelVec3; headWrap?: boolean;
  goggles: boolean; gogglesDown?: boolean; shades?: boolean; faceWrap: boolean;
  maskHard?: boolean; beard: boolean; kneePads: boolean; fullCarrier: boolean;
  weapon: string; bulk: number; scale: number;
}
export interface SoldierMetadata {
  name: string; slots: string[]; weapon: SoldierWeapon;
  stats: { vertices: number; triangles: number }; variant: SoldierVariant;
}
export interface SoldierRecord extends SoldierMetadata {
  requestedName: string; geometry: BufferGeometry; boneNames: string[];
}
export interface WorldBuilding {
  spec: { x: number; z: number; w: number; d: number };
  floorY?: number[]; roofY?: number;
}
export interface WorldLadder { kind: 'ladder'; x: number; z: number; y0: number; y1: number; radius: number; nx?: number; nz?: number }
export interface WorldManifest {
  version: 2; sourceHash: string; assets: { visual: string; collision: string; nav: string };
  navigation?: { version: number; sha256: string; polygons?: number; components?: number; coverPoints?: number };
  transform: number[]; bounds: { min: ModelVec3; max: ModelVec3 };
  spawns: Array<{ position: ModelVec3; forward?: ModelVec3; yaw: number; tag: string }>;
  buildings?: WorldBuilding[]; volumes?: WorldLadder[];
  stats: { staticTris: number; instTris: number; instances: number; drawCalls: number; collideTris: number };
  lights: Array<{ kind: string; position: ModelVec3; color: ModelVec3; range: number; priority: number; day: number; night: number }>;
  WORLD?: { MARKERS?: { INTEL?: Array<{ id: string; tag?: string; position: ModelVec3 }> } };
  query?: { street?: { halfWidth: number; kerb: number; walkH: number; zMin: number; zMax: number }; alleys?: Array<{ rect: [number, number, number, number]; surface: string }> };
}
export interface WorldPrefetch { meta: WorldManifest; visual: GLTF; collision: GLTF }

/** JSON is unknown until each field consumed by runtime has been checked. */
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('[models] expected metadata object');
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('[models] expected metadata string');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('[models] expected finite metadata number');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('[models] expected metadata boolean');
  return value;
}
function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('[models] expected metadata array');
  return value.map((item: unknown) => parse(item));
}
function vec3(value: unknown): ModelVec3 {
  const values = array(value, number);
  if (values.length !== 3) throw new Error('[models] expected three metadata coordinates');
  return [values[0], values[1], values[2]];
}
function optional<T>(value: unknown, parse: (item: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}
function transform(value: unknown): ModelTransform {
  const source = object(value);
  return { ...source, pos: vec3(source.pos), rot: vec3(source.rot) };
}
function hand(value: unknown): ModelHandNode {
  const source = object(value);
  return { ...source, pos: vec3(source.pos), finger: optional(source.finger, vec3), back: optional(source.back, vec3) };
}
export function parseWeaponMetadata(value: unknown): WeaponMetadata {
  const source = object(value), nodes = object(source.nodes), handguard = object(nodes.handguard);
  const shell = object(source.shell), magSize = object(source.magSize);
  return {
    ...source, label: string(source.label), fxClass: string(source.fxClass),
    nodes: { ...nodes,
      muzzle: vec3(nodes.muzzle), chamber: vec3(nodes.chamber), eject: vec3(nodes.eject),
      ejectDir: optional(nodes.ejectDir, vec3), sight: vec3(nodes.sight),
      gripR: hand(nodes.gripR), gripL: hand(nodes.gripL),
      handguard: { ...handguard, axis: vec3(handguard.axis), dir: vec3(handguard.dir), r: number(handguard.r), z0: number(handguard.z0), z1: number(handguard.z1) },
      magSeat: transform(nodes.magSeat), chargeRest: transform(nodes.chargeRest), chargePull: optional(nodes.chargePull, vec3),
      boltRest: transform(nodes.boltRest), boltTravel: optional(nodes.boltTravel, vec3),
      triggerPivot: transform(nodes.triggerPivot), triggerPull: optional(nodes.triggerPull, number),
    },
    shell: { ...shell, caseLen: number(shell.caseLen), rimR: number(shell.rimR) },
    magSize: { ...magSize, len: number(magSize.len) },
  };
}
export function parseSoldierMetadata(value: unknown): SoldierMetadata {
  const source = object(value), weapon = object(source.weapon), variant = object(source.variant);
  const stats = source.stats == null ? { vertices: 0, triangles: 0 } : object(source.stats);
  return {
    ...source, name: string(source.name), slots: array(source.slots, string),
    weapon: { ...weapon, muzzle: vec3(weapon.muzzle), foregrip: vec3(weapon.foregrip), magBottom: vec3(weapon.magBottom), ejection: vec3(weapon.ejection), stockTop: vec3(weapon.stockTop) },
    stats: { ...stats, vertices: number(stats.vertices), triangles: number(stats.triangles) },
    variant: { ...variant,
      camo: string(variant.camo), clothTint: vec3(variant.clothTint), gearTint: vec3(variant.gearTint), plateTint: vec3(variant.plateTint), skinTint: vec3(variant.skinTint),
      helmet: boolean(variant.helmet), helmetCover: optional(variant.helmetCover, boolean), helmetTint: optional(variant.helmetTint, vec3), headWrap: optional(variant.headWrap, boolean),
      goggles: boolean(variant.goggles), gogglesDown: optional(variant.gogglesDown, boolean), shades: optional(variant.shades, boolean),
      faceWrap: boolean(variant.faceWrap), maskHard: optional(variant.maskHard, boolean), beard: boolean(variant.beard),
      kneePads: boolean(variant.kneePads), fullCarrier: boolean(variant.fullCarrier), weapon: string(variant.weapon), bulk: number(variant.bulk), scale: number(variant.scale),
    },
  };
}
export function parseWorldAssets(value: unknown): WorldManifest['assets'] {
  const source = object(value);
  if (source.version !== 2) throw new Error(`[models] unsupported world manifest version ${String(source.version)}`);
  const assets = object(source.assets);
  if (!assets.nav) throw new Error('[models] missing navigation asset');
  return { ...assets, visual: string(assets.visual), collision: string(assets.collision), nav: string(assets.nav) };
}
export function parseWorldManifest(value: unknown): WorldManifest {
  const source = object(value), assets = parseWorldAssets(source);
  const bounds = object(source.bounds), stats = object(source.stats);
  const world = optional(source.WORLD, (value) => {
    const world = object(value);
    return { ...world, MARKERS: optional(world.MARKERS, (value) => {
      const markers = object(value);
      return { ...markers, INTEL: optional(markers.INTEL, (value) => array(value, (value) => {
        const marker = object(value);
        return { ...marker, id: string(marker.id), tag: optional(marker.tag, string), position: vec3(marker.position) };
      })) };
    }) };
  });
  const transform = array(source.transform, number);
  if (transform.length !== 16) throw new Error('[models] expected world transform matrix');
  return { ...source, version: 2, sourceHash: string(source.sourceHash),
    navigation: optional(source.navigation, (value) => {
      const navigation = object(value);
      return { ...navigation, version: number(navigation.version), sha256: string(navigation.sha256), polygons: optional(navigation.polygons, number), components: optional(navigation.components, number), coverPoints: optional(navigation.coverPoints, number) };
    }),
    assets,
    transform, bounds: { ...bounds, min: vec3(bounds.min), max: vec3(bounds.max) },
    stats: { ...stats, staticTris: number(stats.staticTris), instTris: number(stats.instTris), instances: number(stats.instances), drawCalls: number(stats.drawCalls), collideTris: number(stats.collideTris) },
    spawns: array(source.spawns, (value) => {
      const spawn = object(value);
      return { ...spawn, position: vec3(spawn.position), forward: optional(spawn.forward, vec3), yaw: number(spawn.yaw), tag: string(spawn.tag) };
    }),
    lights: array(source.lights, (value) => {
      const light = object(value);
      return { ...light, kind: string(light.kind), position: vec3(light.position), color: vec3(light.color), range: number(light.range), priority: number(light.priority), day: number(light.day), night: number(light.night) };
    }),
    buildings: optional(source.buildings, (value) => array(value, (value) => {
      const building = object(value), spec = object(building.spec);
      return { ...building, spec: { ...spec, x: number(spec.x), z: number(spec.z), w: number(spec.w), d: number(spec.d) }, floorY: optional(building.floorY, (value) => array(value, number)), roofY: optional(building.roofY, number) };
    })),
    volumes: optional(source.volumes, (value) => array(value, (value): WorldLadder => {
      const volume = object(value);
      if (volume.kind !== 'ladder') throw new Error('[models] unsupported world volume');
      return { ...volume, kind: 'ladder', x: number(volume.x), z: number(volume.z), y0: number(volume.y0), y1: number(volume.y1), radius: number(volume.radius), nx: optional(volume.nx, number), nz: optional(volume.nz, number) };
    })),
    WORLD: world,
    query: optional(source.query, (value) => {
      const query = object(value);
      return { ...query, street: optional(query.street, (value) => {
        const street = object(value);
        return { ...street, halfWidth: number(street.halfWidth), kerb: number(street.kerb), walkH: number(street.walkH), zMin: number(street.zMin), zMax: number(street.zMax) };
      }), alleys: optional(query.alleys, (value) => array(value, (value) => {
        const alley = object(value), rect = array(alley.rect, number);
        if (rect.length !== 4) throw new Error('[models] expected alley rectangle');
        return { ...alley, rect: [rect[0], rect[1], rect[2], rect[3]] as [number, number, number, number], surface: string(alley.surface) };
      })) };
    }),
  };
}
