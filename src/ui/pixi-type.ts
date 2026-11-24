import { BitmapFontManager, BitmapText, Text } from 'pixi.js';
import type { BitmapFont, Container, WebGPURenderer } from 'pixi.js';

/** Bottom-HUD hierarchy: primary counts, secondary counts, supporting labels. */
export const HUD_TYPE = { value: 32, secondary: 16, label: 12 } as const;

// Shrinking the value atlas blurs small text, so smaller sizes share the label atlas.
const HUD_FONTS = [
  { size: HUD_TYPE.value, stroke: 2.25 },
  { size: HUD_TYPE.label, stroke: 1 },
] as const;

/** Rasterize and upload the HUD glyph atlases once; the caller destroys `fonts`, even on failure. */
export function prepareHudGlyphs(renderer: WebGPURenderer, fonts: BitmapFont[]): void {
  for (const { size, stroke } of HUD_FONTS) {
    // Cover the game's English copy plus its display punctuation before gameplay.
    const font = BitmapFontManager.install({
      name: `ow-hud-${size}`,
      chars: [...BitmapFontManager.ASCII, '·—…×'],
      resolution: 2,
      dynamicFill: true,
      skipKerning: true,
      style: {
        fontFamily: 'Arial',
        fontSize: size,
        fontWeight: '600',
        stroke: { color: 0x080c10, width: stroke, join: 'round' },
      },
    });
    fonts.push(font);
    for (const { texture } of font.pages) {
      // Keep the startup upload resident even after a long hidden/paused HUD.
      texture.source.autoGarbageCollect = false;
      renderer.texture.initSource(texture.source);
    }
  }
}

export function hudText(
  value: string,
  x: number,
  y: number,
  size: number,
  fill = 0xe7f2ef
): BitmapText {
  const atlas = size < HUD_TYPE.value ? HUD_TYPE.label : HUD_TYPE.value;
  const node = new BitmapText({
    text: value,
    style: { fontFamily: `ow-hud-${atlas}`, fontSize: size, fill },
  });
  node.position.set(x, y);
  return node;
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
