/** Explicit runtime calibration only; never builds a soldier or reads model products. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RIG, GRIP_R, GRIP_L, BORE_DIR, BORE_ORIGIN } from '../../../src/ai/rig.ts';
import { VARIANTS, MATERIAL_SLOTS, SOLDIER_MATERIALS } from '../../../src/ai/soldier.ts';

export function soldierReference() {
  const { bones, skeleton } = RIG.createSkeleton();
  try {
    return {
      version: 1,
      rig: {
        names: RIG.names,
        parent: RIG.parent,
        bindPos: RIG.bindPos.map((v) => v.toArray()),
        tail: RIG.tail.map((v) => v.toArray()),
        length: RIG.length,
        worldMatrices: bones.map((b) => b.matrixWorld.toArray()),
        inverseBinds: skeleton.boneInverses.map((m) => m.toArray()),
        gripR: GRIP_R,
        gripL: GRIP_L,
        boreDir: BORE_DIR,
        boreOrigin: BORE_ORIGIN,
      },
      variants: VARIANTS,
      slots: MATERIAL_SLOTS,
      materials: SOLDIER_MATERIALS,
    };
  } finally {
    skeleton.dispose();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output || !path.isAbsolute(output))
    throw new Error('Usage: node reference.mjs ABS_OUTPUT.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(soldierReference(), null, 2)}\n`);
}
