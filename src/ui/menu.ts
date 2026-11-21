import type { VolumeKey } from '../audio/settings.ts';
import { bindingLabel, DEFAULT_BINDINGS } from '../core/bindings.ts';
import type { EngineContext } from '../core/context.ts';
import { hasOwn } from '../core/guards.ts';
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

/** Every audio category with the sounds it actually controls, in menu order. */
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

const TABS = ['Gameplay', 'Audio', 'Controls'] as const;
type MenuTab = (typeof TABS)[number];
const TAB_STEP: Partial<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/** Tabbed pause menu: a rail (title, tabs, Resume) and one page at a time.
 * Settings write shared config directly; quality reloads with ?q= because passes
 * are chosen at init. FOV also updates the live camera. Emits ui:pause {paused}.
 */
export class PauseMenu {
  ctx: MenuContext;
  root: HTMLDialogElement;
  sens: SliderApi;
  fov: SliderApi;
  shake: SliderApi;
  resumeBtn: HTMLButtonElement;
  _prevScale?: number;
  // ---- quality preset --------------------------------------------------
  qBtns: HTMLButtonElement[] = [];
  invBtns: InvertButton[] = [];
  volumes = new Map<VolumeKey, SliderApi>();
  /** Tab buttons and their pages, in TABS order. */
  tabs: HTMLButtonElement[] = [];
  pages: HTMLElement[] = [];
  open: boolean = false;
  shown: number = 0;

  constructor(parent: HTMLElement, ctx: MenuContext) {
    this.ctx = ctx;
    this.root = el('dialog', 'ow-menu ow-dialog', parent);
    this.root.setAttribute('aria-labelledby', 'ow-menu-title');
    this.root.setAttribute('closedby', 'none');
    this.root.oncancel = (event): void => event.preventDefault();
    this.root.onkeydown = (event): void => {
      if (event.code !== DEFAULT_BINDINGS.pause[0]) return;
      event.preventDefault();
      if (!event.repeat) this.close();
    };
    const layout = el('div', 'ow-menu-layout', this.root);
    const rail = el('nav', 'ow-menu-rail', layout);
    rail.setAttribute('aria-label', 'Pause menu');
    const pages = el('div', 'ow-menu-pages', layout);

    const h = el('h1', null, rail, 'PAUSED');
    h.id = 'ow-menu-title';
    el('div', 'sub', rail, 'Claude of Duty — TACTICAL OPERATIONS');

    // ---- tabs (ARIA tablist: arrows move, one tab stop) --------------------
    const tablist = el('div', 'ow-tabs', rail);
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-orientation', 'vertical');
    for (const name of TABS) {
      const tab = el('button', 'ow-tab', tablist, name);
      tab.type = 'button';
      tab.id = `ow-tab-${name.toLowerCase()}`;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', (): void => this.selectTab(name));
      const page = el('section', 'ow-page', pages);
      page.setAttribute('role', 'tabpanel');
      page.setAttribute('aria-labelledby', tab.id);
      this.tabs.push(tab);
      this.pages.push(page);
    }
    tablist.addEventListener('keydown', (event): void => {
      const step = TAB_STEP[event.key];
      if (!step) return;
      event.preventDefault();
      const index = this.tabs.findIndex((tab): boolean => tab === event.target);
      const next = TABS[(index + step + TABS.length) % TABS.length];
      this.selectTab(next);
      this.tabs[TABS.indexOf(next)].focus();
    });

    this.resumeBtn = el('button', 'ow-btn primary', rail, 'Resume');
    this.resumeBtn.type = 'button';
    this.resumeBtn.autofocus = true;
    this.resumeBtn.addEventListener('click', (): void => this.close());
    el('div', 'hint', rail, `${bindingLabel('pause').toUpperCase()} RESUME`);

    // ---- gameplay ----------------------------------------------------------
    const game = this._page('Gameplay', (): void => {
      this.sens.set(1);
      this.fov.set(80);
      this.shake.set(1);
      this.ctx.config.invertY = false;
      this.setQuality('high');
    });
    const qRow = this._row(game, 'Graphics Preset', 'Changing the preset restarts the run');
    const seg = el('div', 'ow-seg', qRow);
    for (const p of PRESETS) {
      const b = el('button', null, seg, p);
      b.type = 'button';
      b.addEventListener('click', (): void => this.setQuality(p));
      this.qBtns.push(b);
    }
    this.sens = this._slider(game, 'Mouse Sensitivity', 0.2, 3.0, 0.01, (v): string => {
      this.ctx.config.sensitivity = 0.0022 * v;
      return v.toFixed(2);
    });
    this.fov = this._slider(game, 'Field Of View', 65, 120, 1, (v): string => {
      this.ctx.config.fov = v;
      this.ctx.camera.fov = v;
      this.ctx.camera.updateProjectionMatrix();
      return String(v | 0);
    });
    this.shake = this._slider(game, 'Firing Camera Shake', 0, 1, 0.05, (v): string => {
      this.ctx.config.firingShake = v;
      return v <= 1e-6 ? 'OFF' : `${Math.round(v * 100)}%`;
    });
    const invSeg = el('div', 'ow-seg', this._row(game, 'Invert Look'));
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

    // ---- audio -------------------------------------------------------------
    const audio = this._page('Audio', (): void => {
      this.ctx.peek('audio')?.resetVolumes();
      this.syncFromConfig();
    });
    el(
      'p',
      'ow-page-note',
      audio,
      '100% is the designed mix. 50% sounds about half as loud. 0% is muted.'
    );
    for (const key of Object.keys(VOLUME_ROWS)) {
      if (!hasOwn(VOLUME_ROWS, key)) continue;
      const [label, detail] = VOLUME_ROWS[key];
      const slider = this._slider(
        audio,
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

    // ---- controls reference -------------------------------------------------
    const reference = this._page('Controls');
    reference.tabIndex = 0; // Keyboard users can scroll the reference without leaving the game.
    el('p', 'ow-page-note', reference, 'Keyboard & mouse · Quick reference.');
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
    this.selectTab('Gameplay');
    this.syncFromConfig();
  }

  /** Page header with an optional page-scoped reset. */
  _page(name: MenuTab, reset?: () => void): HTMLElement {
    const page = this.pages[TABS.indexOf(name)];
    const head = el('div', 'ow-page-head', page);
    el('h2', null, head, name.toUpperCase());
    if (reset) {
      const b = el('button', 'ow-btn small', head, `Reset ${name}`);
      b.type = 'button';
      b.addEventListener('click', reset);
    }
    return page;
  }

  selectTab(name: MenuTab): void {
    TABS.forEach((tabName, i): void => {
      const on = tabName === name;
      const tab = this.tabs[i];
      tab.classList.toggle('on', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      this.pages[i].hidden = !on;
    });
  }

  _row(parent: HTMLElement, name: string, detail?: string): HTMLElement {
    const r = el('div', 'ow-row', parent);
    const label = el('div', 'name', r, name.toUpperCase());
    if (detail) el('div', 'detail', label, detail);
    return r;
  }

  _slider(
    parent: HTMLElement,
    name: string,
    min: number,
    max: number,
    step: number,
    apply: (value: number) => string,
    detail?: string
  ): SliderApi {
    const row = this._row(parent, name, detail);
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
    for (const [b, v] of this.invBtns) b.classList.toggle('on', cfg.invertY === v);
    this.sens.set(cfg.sensitivity / 0.0022);
    this.fov.set(cfg.fov);
    this.shake.set(cfg.firingShake);
    const audio = this.ctx.peek('audio');
    if (audio) for (const [key, slider] of this.volumes) slider.set(audio.volumes[key]);
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    // The modal owns keys and clicks until Resume, even before unlock completes.
    this.ctx.input.enabled = false;
    this.ctx.input.clear();
    document.exitPointerLock();
    this.syncFromConfig();
    setStyle(this.root, 'display', '');
    this.root.showModal();
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
    this.ctx.input.enabled = true;
    this.ctx.input.requestPointerLock();
    this.ctx.events.emit('ui:pause', { paused: false });
  }

  /** Driven with unscaled time so the fade still runs while the game is frozen. */
  update(rawDt: number): void {
    this.shown = damp(this.shown, this.open ? 1 : 0, 14, rawDt);
    const hidden = !this.open && this.shown < 0.004;
    setStyle(this.root, 'display', hidden ? 'none' : '');
    setStyle(this.root, 'pointer-events', this.open ? 'auto' : 'none');
    if (!hidden) setStyle(this.root, 'opacity', ease.outQuad(this.shown).toFixed(3));
  }

  dispose(): void {
    this.root.remove();
  }
}
