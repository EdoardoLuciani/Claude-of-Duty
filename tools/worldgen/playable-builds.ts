import type { WorldManifest } from '../../src/core/model-metadata.ts';
import type { PLAYABLE_MAPS } from '../../src/core/playable-maps.ts';
import { buildWorld } from './build.ts';
import type { Assembler } from './builder.ts';
import { LEVEL_TX, LEVEL_TZ, LEVEL_YAW } from './level/config.ts';
import { buildTraining, trainingMetadata } from './level/training.ts';
import { worldMetadata } from './metadata.ts';

type BuildMetadata = Omit<WorldManifest, 'assets' | 'navigation' | 'stats' | 'mapId' | 'mode'> & {
  coordinateSystem: string;
};

export const PLAYABLE_MAP_BUILDERS: Record<
  (typeof PLAYABLE_MAPS)[number]['id'],
  (assembler: Assembler, sourceHash: string) => BuildMetadata
> = {
  courtyard(A, sourceHash): BuildMetadata {
    A.setTransform(LEVEL_YAW, LEVEL_TX, LEVEL_TZ);
    return worldMetadata(A, buildWorld(A), sourceHash);
  },
  'training-grounds'(A, sourceHash): BuildMetadata {
    buildTraining(A);
    return trainingMetadata(A, sourceHash);
  },
};
