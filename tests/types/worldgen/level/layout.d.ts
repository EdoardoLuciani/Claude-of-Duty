import type { BuildingSpec } from '#worldgen/buildings';
export const BUILDINGS: BuildingSpec[];
export const STREET: { halfWidth: number; kerb: number; walkH: number; zMin: number; zMax: number };
export const ALLEYS: Array<{ rect: [number, number, number, number]; surface: string }>;
