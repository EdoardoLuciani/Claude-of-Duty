import type { BuildingSpec } from '../buildings.js';
export const BUILDINGS: BuildingSpec[];
export const STREET: { halfWidth: number; kerb: number; walkH: number; zMin: number; zMax: number };
export const ALLEYS: Array<{ rect: [number, number, number, number]; surface: string }>;
