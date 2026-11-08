import type { BufferGeometry } from 'three';

import type { Assembler } from '#worldgen/builder';
export function autoEdgeWear(geo: BufferGeometry, margin?: number, amount?: number): BufferGeometry;
export function burntCar(): BufferGeometry;
export function registerProps(assembler: Assembler): void;
