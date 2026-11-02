import type { Container } from 'pixi.js';
import { Text } from 'pixi.js';

/** Bottom-HUD hierarchy: primary counts, secondary counts, supporting labels. */
export const HUD_TYPE = { value: 32, secondary: 16, label: 12 } as const;

/** Match bitmap text density to the static layout scale, not animated transforms. */
export function setHudTextResolution(node: Container, resolution: number): void {
  if (node instanceof Text) {
    if (node.resolution !== resolution) node.resolution = resolution;
    return;
  }
  for (const child of node.children) setHudTextResolution(child, resolution);
}
