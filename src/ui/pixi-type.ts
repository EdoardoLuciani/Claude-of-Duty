import type { Container } from 'pixi.js';
import { Text } from 'pixi.js';

/** Bottom-HUD hierarchy: primary counts, secondary counts, supporting labels. */
export const HUD_TYPE = { value: 32, secondary: 16, label: 12 } as const;

export function hudText(value: string, x: number, y: number, size: number, fill = 0xe7f2ef): Text {
  const node = new Text({
    text: value,
    style: {
      fontFamily: 'Arial',
      fontSize: size,
      fontWeight: '600',
      fill,
      stroke: { color: 0x080c10, width: size >= 20 ? 2 : 1, join: 'round' },
    },
  });
  node.position.set(x, y);
  return node;
}

/** Match bitmap text density to the static layout scale, not animated transforms. */
export function setHudTextResolution(node: Container, resolution: number): void {
  if (node instanceof Text) {
    if (node.resolution !== resolution) node.resolution = resolution;
    return;
  }
  for (const child of node.children) setHudTextResolution(child, resolution);
}

export function fitHudText(node: Text, width: number): void {
  node.scale.set(1);
  node.scale.set(Math.min(1, Math.max(1, width) / Math.max(1, node.width)));
}
export function writeHudText(node: Text, value: string, width = 0): boolean {
  if (node.text === value) return false;
  node.text = value;
  if (width) fitHudText(node, width);
  return true;
}
export function poseHudNode(
  node: Container,
  visible: boolean,
  alpha: number,
  x: number,
  y: number,
  scale = 1,
  rotation = node.rotation
): boolean {
  const changed =
    node.visible !== visible ||
    (visible &&
      (node.alpha !== alpha ||
        node.x !== x ||
        node.y !== y ||
        node.scale.x !== scale ||
        node.rotation !== rotation));
  node.visible = visible;
  if (visible) {
    node.alpha = alpha;
    node.position.set(x, y);
    node.scale.set(scale);
    node.rotation = rotation;
  }
  return changed;
}
