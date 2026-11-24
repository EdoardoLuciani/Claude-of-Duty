import { BitmapFontManager, BitmapText, type WebGPURenderer } from 'pixi.js';

const HUD_FONT = 'ow-hud';

/** The single gameplay HUD owns the atlas; its labels only borrow glyphs. */
export function prepareHudGlyphs(renderer: WebGPURenderer): () => void {
  // Cover the game's English copy plus its display punctuation before gameplay.
  const font = BitmapFontManager.install({
    name: HUD_FONT,
    chars: [...BitmapFontManager.ASCII, '·—…×'],
    resolution: 2,
    dynamicFill: true,
    skipKerning: true,
    style: {
      fontFamily: 'Arial',
      fontSize: 32,
      fontWeight: '600',
      stroke: { color: 0x080c10, width: 2.25, join: 'round' },
    },
  });
  try {
    for (const { texture } of font.pages) {
      // Keep the startup upload resident even after a long hidden/paused HUD.
      texture.source.autoGarbageCollect = false;
      renderer.texture.initSource(texture.source);
    }
  } catch (error) {
    try {
      font.destroy();
    } catch (cleanupError) {
      console.warn('[ui] HUD glyph cleanup failed', cleanupError);
    }
    throw error;
  }
  return (): void => font.destroy();
}

export function hudText(
  value: string,
  x: number,
  y: number,
  size: number,
  fill = 0xe7f2ef
): BitmapText {
  const node = new BitmapText({
    text: value,
    style: { fontFamily: HUD_FONT, fontSize: size, fill },
  });
  node.position.set(x, y);
  return node;
}
