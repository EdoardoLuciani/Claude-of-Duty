import { BitmapFontManager, BitmapText, type WebGPURenderer } from 'pixi.js';

// Small labels get their own atlas: shrinking the value atlas blurs them and thins the outline.
const HUD_FONTS = {
  large: { size: 32, stroke: 2.25 },
  small: { size: 12, stroke: 1 },
} as const;
const SMALL_TEXT = 20;

/** The single gameplay HUD owns the atlases; its labels only borrow glyphs. */
export function prepareHudGlyphs(renderer: WebGPURenderer): () => void {
  const fonts: ReturnType<typeof BitmapFontManager.install>[] = [];
  const dispose = (): void => {
    for (const font of fonts) font.destroy();
  };
  try {
    for (const [name, { size, stroke }] of Object.entries(HUD_FONTS)) {
      // Cover the game's English copy plus its display punctuation before gameplay.
      const font = BitmapFontManager.install({
        name: `ow-hud-${name}`,
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
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      console.warn('[ui] HUD glyph cleanup failed', cleanupError);
    }
    throw error;
  }
  return dispose;
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
    style: {
      fontFamily: size < SMALL_TEXT ? 'ow-hud-small' : 'ow-hud-large',
      fontSize: size,
      fill,
    },
  });
  node.position.set(x, y);
  return node;
}
