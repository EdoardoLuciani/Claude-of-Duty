import type { Assembler } from '#worldgen/builder';
import type { BuildingInfo } from '#worldgen/buildings';

import type { WorldManifest } from '../../../src/core/model-metadata.ts';

export function worldMetadata(
  assembler: Assembler,
  buildings: BuildingInfo[],
  sourceHash: string
): Omit<WorldManifest, 'assets' | 'navigation' | 'stats'>;
