import { VOLUME_KEYS, type VolumeKey } from '../audio/settings.ts';
import { bindingLabel } from '../core/bindings.ts';
import type { EngineContext } from '../core/context.ts';
import { clamp, damp } from '../core/math.ts';
import { CONTROL_SECTIONS } from './controls.ts';
import { el, setText, setStyle, ease } from './util.ts';

const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
type QualityPreset = (typeof PRESETS)[number];
type MenuContext = Pick<EngineContext, 'config' | 'events' | 'camera' | 'time' | 'input' | 'peek'>;
interface SliderApi {
  set(value: number): void;
}
type InvertButton = [HTMLButtonElement, boolean];

/** Every audio category with the sounds it actually controls; order follows VOLUME_KEYS. */
const VOLUME_ROWS: Record<VolumeKey, [label: string, detail: string]> = {
  master: ['Master Volume', 'All sound, after the safety limiter'],
  weapons: ['Gunfire', 'Shots, dry fire, distant firefights'],
  explosions: ['Explosions', 'Grenades, air strikes, ear ringing'],
  foley: ['Footsteps & Impacts', 'Movement, reloads, casings, impacts, near misses'],
  voice: ['Voices', 'Enemy callouts and reactions'],
  ambience: ['Ambience', 'Environment and strike aircraft'],
  ui: ['Interface & Alerts', 'Hits, damage, heartbeat, radio, intel'],
  music: ['Music', 'Supply tent radio'],
};

/** Settings write shared config directly; quality reloads with ?q= because passes
 * are chosen at init. FOV also updates the live camera. Emits ui:pause {paused}.
 */
export class PauseMenu {
  ctx: MenuContext;
  root: HTMLDialogElement;
  rows: HTMLElement;
  sens: SliderApi;
  fov: SliderApi;
  shake: SliderApi;
  resumeBtn: HTMLButtonElement;
  _prevScale?: number;
  // ---- quality preset --------------------------------------------------
  qBtns: HTMLButtonElement[] = [];
  invBtns: InvertButton[] = [];
  volumes = new Map<VolumeKey, SliderApi>();
  open: boolean = false;
  shown: number = 0;

  constructor(parent: HTMLElement, ctx: MenuContext) {
    this.ctx = ctx;
    this.root = el('dialog', 'ow-menu ow-dialog', parent);
    this.root.setAttribute('aria-labelledby', 'ow-menu-title');
    // Esc stays owned by the pause binding, which toggles this menu itself.
    this.root.setAttribute('closedby', 'none');
    this.root.oncancel = (event): void => event.preventDefault();
    const layout = el('div', 'ow-menu-layout', this.root);
    const inner = el('div', 'ow-menu-inner', layout);

    const h = el('h1', null, inner, 'Paused');
    h.id = 'ow-menu-title';
    h.textContent = 'PAUSED';
    el('div', 'sub', inner, 'Claude of Duty — TACTICAL OPERATIONS');
    el('div', 'rule', inner);

    this.rows = el('div', null, inner);

    const qRow = this._row('Graphics Preset');
    const seg = el('div', 'ow-seg', qRow);
    for (const p of PRESETS) {
      const b = el('button', null, seg, p);
      b.type = 'button';
      b.addEventListener('click', (): void => this.setQuality(p));
      this.qBtns.push(b);
    }
    el('div', 'hint', this.rows, 'PRESET CHANGE RESTARTS THE RUN');

    // ---- sensitivity -----------------------------------------------------
    this.sens = this._slider('Mouse Sensitivity', 0.2, 3.0, 0.01, (v): string => {
      this.ctx.config.sensitivity = 0.0022 * v;
      return v.toFixed(2);
    });

    // ---- field of view ---------------------------------------------------
    this.fov = this._slider('Field Of View', 65, 120, 1, (v): string => {
      this.ctx.config.fov = v;
      this.ctx.camera.fov = v;
      this.ctx.camera.updateProjectionMatrix();
      return String(v | 0);
    });

    // ---- firing camera shake ---------------------------------------------
    this.shake = this._slider('Firing Camera Shake', 0, 1, 0.05, (v): string => {
      this.ctx.config.firingShake = v;
      return v <= 1e-6 ? 'OFF' : `${Math.round(v * 100)}%`;
    });

    // ---- invert look -----------------------------------------------------
    const invRow = this._row('Invert Look');
    const invSeg = el('div', 'ow-seg', invRow);
    const invertOptions: [string, boolean][] = [
      ['off', false],
      ['on', true],
    ];
    for (const [label, val] of invertOptions) {
      const b = el('button', null, invSeg, label);
      b.type = 'button';
      b.addEventListener('click', (): void => {
        this.ctx.config.invertY = val;
        this.syncFromConfig();
      });
      this.invBtns.push([b, val]);
    }

    // ---- audio -----------------------------------------------------------
    const audioHead = el('div', 'ow-menu-section', this.rows);
    el('h2', null, audioHead, 'AUDIO');
    const resetAudio = el('button', 'ow-btn small', audioHead, 'Reset Audio');
    resetAudio.type = 'button';
    resetAudio.addEventListener('click', (): void => this.resetAudio());
    el(
      'div',
      'hint',
      this.rows,
      '100% is the designed mix. 50% sounds about half as loud. 0% is muted.'
    );
    for (const key of VOLUME_KEYS) {
      const [label, detail] = VOLUME_ROWS[key];
      const slider = this._slider(
        label,
        0,
        100,
        1,
        (v): string => {
          this.ctx.peek('audio')?.setVolume(key, v);
          return v <= 0 ? 'MUTED' : `${v}%`;
        },
        detail
      );
      this.volumes.set(key, slider);
    }

    // ---- buttons ---------------------------------------------------------
    const btns = el('div', 'ow-btns', inner);
    this.resumeBtn = el('button', 'ow-btn primary', btns, 'Resume');
    this.resumeBtn.type = 'button';
    this.resumeBtn.autofocus = true;
    this.resumeBtn.addEventListener('click', (): void => this.close());
    const reset = el('button', 'ow-btn', btns, 'Defaults');
    reset.type = 'button';
    reset.addEventListener('click', (): void => {
      this.sens.set(1);
      this.fov.set(80);
      this.shake.set(1);
      this.ctx.config.invertY = false;
      this.resetAudio();
      this.setQuality('high');
    });
    el('div', 'hint', inner, `${bindingLabel('pause').toUpperCase()} RESUME`);

    const reference = el('section', 'ow-controls', layout);
    reference.setAttribute('aria-label', 'Gameplay controls');
    reference.tabIndex = 0; // Keyboard users can scroll the reference without leaving the game.
    el('h2', null, reference, 'CONTROLS');
    el('p', 'ow-controls-note', reference, 'Keyboard & mouse · Quick reference.');
    const groups = el('div', 'ow-controls-groups', reference);
    for (const section of CONTROL_SECTIONS) {
      const group = el('section', 'ow-controls-group', groups);
      el('h3', null, group, section.title);
      const list = el('dl', null, group);
      for (const control of section.controls) {
        const row = el('div', 'ow-control', list);
        el('dt', null, row, control.keys.join(' / '));
        el('dd', null, row, control.description);
      }
    }

    setStyle(this.root, 'display', 'none');
    setStyle(this.root, 'cursor', 'default');
    this.syncFromConfig();
  }

  _row(name: string, detail?: string): HTMLElement {
    const r = el('div', detail ? 'ow-row compact' : 'ow-row', this.rows);
    const label = el('div', 'name', r, name.toUpperCase());
    if (detail) el('div', 'detail', label, detail);
    return r;
  }

  _slider(
    name: string,
    min: number,
    max: number,
    step: number,
    apply: (value: number) => string,
    detail?: string
  ): SliderApi {
    const row = this._row(name, detail);
    const wrap = el('div', 'ow-slider', row);
    el('div', 'track', wrap);
    const fill = el('div', 'fill', wrap);
    const knob = el('div', 'knob', wrap);
    const input = el('input', null, wrap);
    input.type = 'range';
    input.setAttribute('aria-label', detail ? `${name}: ${detail}` : name);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const val = el('div', 'val', row, '');

    const paint = (v: number): void => {
      const t = (v - min) / (max - min);
      setStyle(fill, 'width', (t * 100).toFixed(2) + '%');
      setStyle(knob, 'left', (t * 100).toFixed(2) + '%');
      const text = apply(v);
      setText(val, text);
      input.setAttribute('aria-valuetext', text);
    };
    input.addEventListener('input', (): void => paint(parseFloat(input.value)));
    const api = {
      set: (v: number): void => {
        const c = clamp(v, min, max);
        input.value = String(c);
        paint(c);
      },
    };
    return api;
  }

  setQuality(name: QualityPreset): void {
    if (name === this.ctx.config.quality) {
      this.syncFromConfig();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('q', name);
    window.location.assign(url.href);
  }

  syncFromConfig(): void {
    const cfg = this.ctx.config;
    for (let i = 0; i < this.qBtns.length; i++)
      this.qBtns[i].classList.toggle('on', PRESETS[i] === cfg.quality);
    for (const [b, v] of this.invBtns) b.classList.toggle('on', !!cfg.invertY === v);
    this.sens.set(cfg.sensitivity / 0.0022);
    this.fov.set(cfg.fov);
    this.shake.set(cfg.firingShake);
    const audio = this.ctx.peek('audio');
    if (audio) for (const [key, slider] of this.volumes) slider.set(audio.volumes[key]);
  }

  resetAudio(): void {
    this.ctx.peek('audio')?.resetVolumes();
    this.syncFromConfig();
  }

  toggle(): void {
    if (this.open) {
      this.close();
    } else {
      this.show();
    }
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.syncFromConfig();
    setStyle(this.root, 'display', '');
    this.root.showModal();
    document.exitPointerLock();
    this._prevScale = this.ctx.time.scale;
    this.ctx.time.scale = 0;
    this.ctx.peek('player')?.setControlEnabled(false);
    this.ctx.events.emit('ui:pause', { paused: true });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.close(); // Leave the top layer before re-locking; update() still fades it out.
    this.ctx.time.scale = this._prevScale ?? 1;
    this.ctx.peek('player')?.setControlEnabled(true);
    this.ctx.input.requestPointerLock();
    this.ctx.events.emit('ui:pause', { paused: false });
  }

  /** Driven with unscaled time so the fade still runs while the game is frozen. */
  update(rawDt: number): void {
    this.shown = damp(this.shown, this.open ? 1 : 0, 14, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'pointer-events', this.open ? 'auto' : 'none');
    setStyle(this.root, 'opacity', ease.outQuad(this.shown).toFixed(3));
  }

  dispose(): void {
    this.root.remove();
  }
}
