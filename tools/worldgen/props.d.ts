import type { BufferGeometry } from 'three';

import type { Assembler } from './builder.js';
export function autoEdgeWear(geo: BufferGeometry, margin?: number, amount?: number): BufferGeometry;
export function burntCar(): BufferGeometry;
export function registerProps(assembler: Assembler): void;
