import { Graphics } from 'pixi.js';

export type AccessoryIconStyle = 'text' | 'original' | 'simple';

/** Retained vectors, authored in the original 16x20 icon space. */
export function accessoryIcon(index: number, style: Exclude<AccessoryIconStyle, 'text'>): Graphics {
  const g = new Graphics();
  if (style === 'simple') {
    if (index === 0) {
      // Diagonal bandage with a central pad; no engraving or tiny rounded parts.
      g.poly([1, 11, 10, 2, 15, 7, 6, 16])
        .fill(0xffffff)
        .poly([5, 9, 8, 6, 11, 9, 8, 12])
        .fill({ color: 0, alpha: 0.4 });
    } else {
      g.ellipse(8, 12, 5.5, 7)
        .rect(6, 2, 4, 5)
        .fill(0xffffff)
        .moveTo(10, 3)
        .lineTo(13, 5)
        .lineTo(13, 8)
        .stroke({ color: 0xffffff, width: 1.5 });
    }
  } else if (index === 0) {
    // Original roll/tail/inner shading from the pre-simplification Pixi HUD.
    g.roundRect(2.2, 5.2, 11.6, 7.4, 1.6)
      .fill(0xffffff)
      .roundRect(3.6, 6.6, 8.8, 4.6, 0.8)
      .fill({ color: 0, alpha: 0.4 })
      .poly([6.4, 12.6, 8.4, 12.6, 9.6, 18, 7.2, 18])
      .fill(0xffffff);
  } else {
    g.poly([6.4, 0, 9.6, 0, 9.6, 2.1, 11.1, 2.1, 12.2, 4.1, 3.8, 4.1, 4.9, 2.1, 6.4, 2.1])
      .fill(0xffffff)
      .moveTo(8, 4.6)
      .bezierCurveTo(11.1, 4.6, 13.6, 7.5, 13.6, 11.7)
      .bezierCurveTo(13.6, 15.9, 11.1, 20, 8, 20)
      .bezierCurveTo(4.9, 20, 2.4, 15.9, 2.4, 11.7)
      .bezierCurveTo(2.4, 7.5, 4.9, 4.6, 8, 4.6)
      .fill(0xffffff);
    for (const y of [9.5, 13, 16.2])
      g.moveTo(3, y).lineTo(13, y).stroke({ color: 0, alpha: 0.5, width: 0.9 });
    g.moveTo(8, 5).lineTo(8, 19.6).stroke({ color: 0, alpha: 0.5, width: 0.9 });
  }
  g.scale.set(13 / 16, 16.5 / 20);
  return g;
}
