import type { Renderer } from 'three/webgpu';

import * as complete from './fixture-targets.ts';
import { fixture } from './fixture.ts';

/** A native renderer boundary for graph construction without requesting a GPU. */
export function renderFixture(members: Partial<Renderer> = {}): Renderer {
  return fixture<Renderer>(
    {
      toneMapping: 0,
      outputColorSpace: 'srgb-linear',
      ...members,
    },
    complete.testRenderer()
  );
}

/** Capture a method unchanged for deliberate replacement/restoration or identity checks. */
export function captureMethod<T, K extends keyof T>(owner: T, key: K): T[K] {
  return owner[key];
}
