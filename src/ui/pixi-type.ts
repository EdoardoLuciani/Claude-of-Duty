import type { BitmapText, Container } from 'pixi.js';
import { Graphics, Text } from 'pixi.js';

/** Bottom-HUD hierarchy: primary counts, secondary counts, supporting labels. */
export const HUD_TYPE = { value: 32, secondary: 16, label: 12 } as const;

export function hudPanel(width: number, height: number): Graphics {
  return new Graphics().roundRect(0, 0, width, height, 4).fill({ color: 0x080c10, alpha: 0.68 });
}

/** Match canvas-rasterized static labels to the layout scale. */
export function setHudTextResolution(node: Container, resolution: number): void {
  if (node instanceof Text) {
    if (node.resolution !== resolution) node.resolution = resolution;
    return;
  }
  for (const child of node.children) setHudTextResolution(child, resolution);
}

export function fitHudText(node: BitmapText, width: number): void {
  node.scale.set(1);
  node.scale.set(Math.min(1, Math.max(1, width) / Math.max(1, node.width)));
}
export function writeHudText(node: BitmapText, value: string, width = 0): boolean {
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
