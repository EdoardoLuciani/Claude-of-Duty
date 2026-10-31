import { FancyButton, Slider } from '@pixi/ui';
import { Container, DOMAdapter, Graphics, Text, WebGPURenderer } from 'pixi.js';
import type { Renderer } from 'three/webgpu';

const WIDTH = 480;
const HEIGHT = 360;

/** Opt-in library evaluation: DOM hosts one canvas, Pixi renders the contents.
 * No Application/ticker, WebGL fallback, world textures, or gameplay settings.
 * Pixi owns its renderer/resources, but borrows Three's GPUDevice. */
export class PixiUiExperiment {
  readonly root = document.createElement('section');
  readonly canvas = document.createElement('canvas');
  readonly renderer = new WebGPURenderer();
  readonly stage = new Container();
  readonly slider: Slider;
  private strength: Text;
  private status: Text;
  private reticle = new Graphics();
  private abort = new AbortController();
  private adapter = DOMAdapter.get();
  private dirty = true;
  private visible = false;
  private disposed = false;
  private pulse = 0;
  hits = 0;
  draws = 0;

  static async create(parent: HTMLElement, game: Renderer): Promise<PixiUiExperiment> {
    const backend = game.backend;
    if (!('device' in backend) || !(backend.device instanceof GPUDevice))
      throw new Error('The Pixi experiment requires the initialized WebGPU device');
    // Three does not retain its adapter. Pixi only uses adapter metadata when a
    // device is supplied; this query does NOT request another logical device.
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter || adapter.info.vendor !== backend.device.adapterInfo.vendor)
      throw new Error('Could not query matching adapter metadata for Pixi');
    const panel = new PixiUiExperiment();
    try {
      await panel.renderer.init({
        canvas: panel.canvas,
        gpu: { adapter, device: backend.device },
        width: WIDTH,
        height: HEIGHT,
        resolution: Math.min(devicePixelRatio || 1, 2),
        autoDensity: true,
        antialias: true,
        backgroundAlpha: 0,
      });
      parent.append(panel.root);
      return panel;
    } catch (error) {
      panel.dispose();
      throw error;
    }
  }

  private constructor() {
    // Pixi's backend-independent shaders also construct GLSL programs and probe
    // precision. Restrict only Pixi-created canvases through its supported adapter;
    // do not create diagnostic WebGL contexts or patch browser/shader internals.
    const adapter = this.adapter;
    DOMAdapter.set({
      ...adapter,
      createCanvas: (...size): ReturnType<typeof adapter.createCanvas> => {
        const canvas = adapter.createCanvas(...size);
        canvas.getContext = new Proxy(canvas.getContext.bind(canvas), {
          apply(target, context, args): unknown {
            if (typeof args[0] === 'string' && /^(experimental-)?webgl/.test(args[0])) return null;
            return Reflect.apply(target, context, args);
          },
        });
        return canvas;
      },
    });
    this.root.className = 'ow-pixi-experiment';
    this.root.setAttribute('aria-label', 'Experimental PixiJS panel');
    this.root.style.cssText =
      'width:100%;max-width:480px;min-width:0;align-self:center;justify-self:center';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      'aria-label',
      'Pixi demo. Left/right adjusts strength, Enter tests feedback, R resets. Escape resumes.'
    );
    this.root.append(this.canvas);
    this.stage.addChild(
      new Graphics()
        .roundRect(0, 0, WIDTH, HEIGHT, 12)
        .fill(0x10191e)
        .stroke({ color: 0x46655f, width: 1 })
    );
    this.label('PIXIJS / WEBGPU', 24, 22, 12, 0x85cbbb);
    this.label('Library UI experiment', 24, 48, 24);
    this.label('Same GPU device · separate canvas', 24, 82, 14, 0x9aabb5);
    this.label('FEEDBACK PREVIEW', 24, 124, 12, 0x9aabb5);
    this.status = this.label('0 TEST HITS', 24, 148, 20);
    this.reticle
      .rect(-1, -17, 2, 10)
      .rect(-1, 7, 2, 10)
      .rect(-17, -1, 10, 2)
      .rect(7, -1, 10, 2)
      .circle(0, 0, 1.5)
      .fill(0xe7f2ef);
    this.reticle.position.set(410, 147);
    this.stage.addChild(this.reticle);
    this.strength = this.label('PREVIEW STRENGTH 50%', 24, 195, 14);
    this.slider = new Slider({
      bg: new Graphics().roundRect(0, 0, 432, 10, 5).fill(0x31434c),
      fill: new Graphics().roundRect(0, 0, 432, 10, 5).fill(0x7fc9b6),
      slider: new Graphics().circle(0, 0, 10).fill(0xebf7f3),
      min: 0,
      max: 100,
      step: 1,
      value: 50,
    });
    this.slider.position.set(24, 235);
    this.slider.onUpdate.connect((value): void => {
      this.strength.text = `PREVIEW STRENGTH ${value}%`;
      this.dirty = true;
    });
    this.stage.addChild(this.slider);
    this.button('TEST FEEDBACK', 24, (): void => this.hit());
    this.button('RESET', 248, (): void => this.reset());
    this.label('← → Strength · Enter Test · R Reset · Esc Resume', 24, 332, 12, 0x9aabb5);
    for (const event of ['pointerover', 'pointerout', 'pointerdown', 'pointerup'] as const)
      this.stage.on(event, (): void => {
        this.dirty = true;
      });
    this.canvas.addEventListener('pointerdown', (): void => this.canvas.focus(), {
      signal: this.abort.signal,
    });
    this.canvas.addEventListener(
      'keydown',
      (event): void => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
          this.slider.value = Math.max(
            0,
            Math.min(100, this.slider.value + (event.key === 'ArrowRight' ? 1 : -1))
          );
        else if (event.key === 'Enter') this.hit();
        else if (event.code === 'KeyR') this.reset();
        else return;
        this.strength.text = `PREVIEW STRENGTH ${this.slider.value}%`;
        this.dirty = true;
        event.preventDefault();
        event.stopPropagation();
      },
      { signal: this.abort.signal }
    );
  }

  private label(text: string, x: number, y: number, fontSize: number, fill = 0xe7f2ef): Text {
    const label = new Text({ text, style: { fontFamily: 'Arial', fontSize, fill } });
    label.position.set(x, y);
    this.stage.addChild(label);
    return label;
  }

  private button(text: string, x: number, action: () => void): void {
    const skin = (color: number): Graphics =>
      new Graphics().roundRect(0, 0, 208, 40, 6).fill(color);
    const button = new FancyButton({
      defaultView: skin(0x28473f),
      hoverView: skin(0x3a675a),
      pressedView: skin(0x192f29),
      text: new Text({ text, style: { fontFamily: 'Arial', fontSize: 14, fill: 0xe7f2ef } }),
    });
    button.position.set(x, 275);
    button.onPress.connect(action);
    this.stage.addChild(button);
  }

  private hit(): void {
    this.status.text = `${++this.hits} TEST HITS`;
    this.pulse = 1;
    this.dirty = true;
  }

  private reset(): void {
    this.hits = 0;
    this.pulse = 0;
    this.slider.value = 50;
    this.status.text = '0 TEST HITS';
    this.strength.text = 'PREVIEW STRENGTH 50%';
    this.dirty = true;
  }

  resize(): void {
    const width = Math.max(1, Math.min(WIDTH, this.root.clientWidth || WIDTH));
    this.renderer.resize(width, (width * HEIGHT) / WIDTH, Math.min(devicePixelRatio || 1, 2));
    this.stage.scale.set(width / WIDTH);
    this.dirty = true;
  }

  update(visible: boolean, rawDt: number): void {
    if (this.disposed) return;
    if (visible && !this.visible) this.resize();
    this.visible = visible;
    if (!visible) return;
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - rawDt * 4);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.reticle.scale.set(0.5 + this.slider.value / 100 + this.pulse * 0.35);
    this.renderer.render(this.stage);
    this.draws++;
    this.dirty = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    try {
      this.stage.destroy({ children: true, texture: true, textureSource: true });
    } finally {
      try {
        this.renderer.destroy(); // Pixi preserves explicitly supplied devices.
      } finally {
        DOMAdapter.set(this.adapter);
        this.root.remove();
      }
    }
  }
}
