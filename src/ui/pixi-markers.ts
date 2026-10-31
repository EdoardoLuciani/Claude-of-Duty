import { Container, Graphics, Text } from 'pixi.js';

import type { WorldMarkers } from './markers.ts';

function label(size: number, fill: number): Text {
  const t = new Text({
    text: '',
    style: {
      fontFamily: 'Arial',
      fontSize: size,
      fontWeight: '600',
      fill,
      stroke: { color: 0x080c10, width: 1, join: 'round' },
    },
  });
  t.anchor.set(0.5);
  return t;
}

interface ObjectiveView {
  root: Container;
  diamond: Graphics;
  arrow: Graphics;
  letter: Text;
  distance: Text;
  name: Text;
}
interface GrenadeView {
  root: Container;
  ring: Graphics;
  text: Text;
}

/** Read-only projection/lifetime presentation; fixed pools match native limits. */
export class PixiWorldMarkers {
  readonly stage = new Container();
  readonly objectives = Array.from({ length: 6 }, (): ObjectiveView => {
    const root = new Container(),
      diamond = new Graphics()
        .rect(-4.8, -4.8, 9.6, 9.6)
        .fill(0x79d2ff)
        .stroke({ color: 0x06141c, width: 1 });
    diamond.rotation = Math.PI / 4;
    diamond.y = -4;
    const arrow = new Graphics()
      .poly([0, -6.5, 6.4, 5, -6.4, 5])
      .fill(0x79d2ff)
      .stroke({ color: 0x06141c, width: 1 });
    arrow.y = -4;
    const letter = label(9.5, 0x08161c),
      distance = label(10, 0xe7f2ef),
      name = label(9, 0xa9bac5);
    letter.style.stroke = { color: 0x08161c, width: 0 };
    letter.style.fontWeight = '700';
    letter.y = -4;
    distance.y = 12.4;
    name.anchor.set(0.5, 0);
    name.y = 18.4;
    name.style.wordWrap = true;
    name.style.wordWrapWidth = 40;
    name.style.lineHeight = 10.8;
    name.style.align = 'center';
    name.style.fill = 0xd6e3ea;
    name.alpha = 0.6;
    distance.style.letterSpacing = 1.2;
    name.style.letterSpacing = 1.62;
    root.addChild(diamond, arrow, letter, distance, name);
    root.visible = false;
    return { root, diamond, arrow, letter, distance, name };
  });
  readonly grenades = Array.from({ length: 4 }, (): GrenadeView => {
    const root = new Container(),
      ring = new Graphics().circle(0, 0, 15).stroke({ color: 0xff3f31, width: 1.5 });
    const core = new Graphics()
      .circle(0, 0, 5.06)
      .fill(0xff3f31)
      .stroke({ color: 0x080c10, width: 1 })
      .rect(-0.75, -6.75, 1.5, 3)
      .fill(0xff3f31);
    const text = label(9, 0xff3f31);
    text.y = 18.4;
    text.style.letterSpacing = 2.16;
    root.addChild(ring, core, text);
    root.visible = false;
    return { root, ring, text };
  });

  constructor() {
    this.stage.eventMode = 'none';
    for (const o of this.objectives) this.stage.addChild(o.root);
    for (const g of this.grenades) this.stage.addChild(g.root);
  }

  update(model: WorldMarkers, k: number): boolean {
    let changed = false;
    for (let i = 0; i < this.objectives.length; i++) {
      const view = this.objectives[i],
        s = model.objectives[i];
      const x = Math.round(s.x * 10) / (10 * k),
        y = Math.round(s.y * 10) / (10 * k),
        alpha = Math.round(s.alpha * 1000) / 1000;
      if (view.root.visible !== s.visible) changed = true;
      view.root.visible = s.visible;
      if (!s.visible) continue;
      const angle = (Math.round(s.angle * 10) * Math.PI) / 1800;
      if (
        view.root.x !== x ||
        view.root.y !== y ||
        view.root.alpha !== alpha ||
        view.arrow.visible !== s.edge ||
        view.arrow.rotation !== angle
      )
        changed = true;
      view.root.position.set(x, y);
      view.root.alpha = alpha;
      view.arrow.visible = s.edge;
      view.diamond.visible = view.letter.visible = !s.edge;
      view.arrow.rotation = angle;
      if (view.letter.text !== s.label) {
        view.letter.text = s.label;
        changed = true;
      }
      if (view.distance.text !== s.distance) {
        view.distance.text = s.distance;
        changed = true;
      }
      if (view.name.text !== s.name) {
        view.name.text = s.name;
        changed = true;
      }
    }
    for (let i = 0; i < this.grenades.length; i++) {
      const view = this.grenades[i],
        s = model.grenades[i];
      if (view.root.visible !== s.visible) changed = true;
      view.root.visible = s.visible;
      if (!s.visible) continue;
      const x = Math.round(s.x * 10) / (10 * k),
        y = Math.round(s.y * 10) / (10 * k),
        alpha = Math.round(s.alpha * 1000) / 1000;
      const scale = Math.round(s.ringScale * 1000) / 1000,
        ringAlpha = Math.round(s.ringAlpha * 1000) / 1000;
      if (
        view.root.x !== x ||
        view.root.y !== y ||
        view.root.alpha !== alpha ||
        view.ring.scale.x !== scale ||
        view.ring.alpha !== ringAlpha
      )
        changed = true;
      view.root.position.set(x, y);
      view.root.alpha = alpha;
      view.ring.scale.set(scale);
      view.ring.alpha = ringAlpha;
      if (view.text.text !== s.label) {
        view.text.text = s.label;
        changed = true;
      }
    }
    return changed;
  }
}
