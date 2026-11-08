import type { BufferGeometry, Material, Matrix4, Mesh, Object3D } from 'three';
import type { MaterialOptions } from '../../src/materials/index.ts';
import type { SurfaceName } from '../../src/physics/surfaces.ts';
export type InstanceMasks = [number, number, number];
export interface AssemblyOptions {
  masks?: InstanceMasks;
  paint?: (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: number[]) => void;
}
export interface PrototypeSpec {
  geo: BufferGeometry; visualGeo?: BufferGeometry; key: string;
  ballisticSurface?: SurfaceName; sheetThickness?: number; skirt?: number;
  castShadow?: boolean; receiveShadow?: boolean; chunk?: boolean;
  maxDist?: number; noPrepass?: boolean;
}
export interface Prototype {
  id: string; geo: BufferGeometry; visualGeo: BufferGeometry | null; key: string;
  ballisticSurface: SurfaceName; sheetThickness: number; skirt: number;
  castShadow: boolean; receiveShadow: boolean; chunk: boolean;
  maxDist: number; noPrepass: boolean;
  matrices: Matrix4[]; masks: Array<InstanceMasks | null>;
}
export interface AssemblyMaterials { get(name: string, opts: MaterialOptions): Material }
export class Assembler {
  constructor(options: { materials: AssemblyMaterials });
  materials: AssemblyMaterials;
  _mats: Map<string, Material>;
  _protos: Map<string, Prototype>;
  _geoCache: Map<string, BufferGeometry>;
  meshes: Mesh[];
  xform: Matrix4;
  interiorLights: Array<{ x: number; y: number; z: number }>;
  lampAnchors: Array<{ x: number; y: number; z: number }>;
  _identity: boolean;
  ry?: number;
  stats: { staticTris: number; instTris: number; instances: number; drawCalls: number };
  setTransform(ry: number, tx?: number, tz?: number): this;
  _x(matrix?: Matrix4 | null): Matrix4 | null;
  mat(key: string): Material;
  surfaceOf(key: string): SurfaceName;
  add(key: string, geo: BufferGeometry, matrix?: Matrix4 | null, opts?: AssemblyOptions | null): this;
  addBox(key: string, geo: BufferGeometry, x: number, y: number, z: number, ry?: number, sx?: number, sy?: number, sz?: number, opts?: AssemblyOptions | null): this;
  cache(key: string, factory: () => BufferGeometry): BufferGeometry;
  addOnce(key: string, geo: BufferGeometry, matrix?: Matrix4 | null, opts?: AssemblyOptions | null): this;
  releaseCache(): void;
  proto(id: string, spec: PrototypeSpec): string;
  has(id: string): boolean;
  place(id: string, matrix: Matrix4, masks?: InstanceMasks | null): this;
  put(id: string, x: number, y: number, z: number, ry?: number, s?: number, masks?: InstanceMasks | null, rx?: number, rz?: number): this;
  putS(id: string, x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, masks?: InstanceMasks | null, rx?: number, rz?: number): this;
  finalize(root: Object3D, collisionSource?: Object3D | null): this;
  dispose(): void;
}
