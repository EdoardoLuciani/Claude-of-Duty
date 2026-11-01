import { Graphics } from 'pixi.js';

/** Chosen simple bandage/grenade silhouettes, retained in 16x20 icon space. */
export function accessoryIcon(index: number): Graphics {
  const g = new Graphics();
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
  return g;
}
