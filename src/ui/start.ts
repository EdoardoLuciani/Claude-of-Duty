import type { Engine } from '../core/engine.ts';
import { PLAYABLE_MAPS } from '../core/playable-maps.ts';
import type { PlayableMap } from '../core/playable-maps.ts';
import { CLOCK } from '../sky/tuning.ts';
import { MouseCapture } from './mouse-capture.ts';

function startDialog(id: string, heading: string): HTMLDialogElement {
  const panel = document.createElement('dialog');
  panel.id = id;
  panel.style.cssText =
    'margin:auto;width:min(28rem,calc(100vw - 3rem));padding:2.5rem;text-align:center;color:#dce4e7;background:#080d10f2;border:1px solid #42645e;font:16px/1.6 Inter,Arial,sans-serif';
  const title = document.createElement('h1');
  title.id = `${id}-title`;
  title.textContent = heading;
  title.style.cssText = 'font-size:1.5rem;font-weight:600;letter-spacing:.12em';
  panel.setAttribute('aria-labelledby', title.id);
  panel.oncancel = (event): void => event.preventDefault();
  panel.onkeydown = (event): void => {
    event.stopPropagation();
    // A held selection/restart key must not activate a newly focused button.
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  };
  panel.onkeyup = (event): void => event.stopPropagation();
  panel.append(title);
  document.body.append(panel);
  return panel;
}

function startButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText =
    'display:block;width:100%;margin-top:.75rem;padding:.8rem;border:1px solid #65b9ab;background:#13231f;color:#e2eee9;font:inherit;letter-spacing:.12em;cursor:pointer';
  button.onclick = action;
  return button;
}

/** Map selection lives outside the game session so it needs no world or GPU device. */
export class StartMenu {
  private panel = startDialog('start-menu', 'Claude of Duty');
  private firstChoice: HTMLButtonElement;

  constructor(select: (map: PlayableMap) => void) {
    const [firstChoice, ...otherChoices] = PLAYABLE_MAPS.map((map): HTMLButtonElement =>
      startButton(map.label, (): void => select(map))
    );
    this.firstChoice = firstChoice;
    this.panel.append(firstChoice, ...otherChoices);
  }

  show(): void {
    this.panel.showModal();
    this.firstChoice.focus();
  }

  hide(): void {
    this.panel.close();
  }

  dispose(): void {
    this.panel.remove();
  }
}

/** Normal-play handoff only; capture pumps deliberately do not install this gate. */
export class StartGate {
  private panel: HTMLDialogElement;
  private status = document.createElement('p');
  private button = startButton('Start', (): void => this.requestControl());
  private waiting = true;
  private ended = false;
  private capture: MouseCapture;
  private frame = 0;
  private hiddenView = false;
  private viewVisible = true;
  private offError: () => void;

  private engine: Engine;

  constructor(
    engine: Engine,
    private readonly map: PlayableMap
  ) {
    this.engine = engine;
    this.panel = startDialog('run-start', map.label);
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.style.cssText = 'margin:1.25rem 0;color:#aabdc3';
    this.panel.append(this.status);
    if (map.nightHour !== undefined) this.addTimeChoice(map.nightHour);
    this.panel.append(this.button);
    this.capture = new MouseCapture(engine, this.queueActivation, this.lockDenied);
    this.offError = engine.events.on('engine:error', (): void => this.end());
    this.suspend();
  }

  private addTimeChoice(nightHour: number): void {
    const group = document.createElement('fieldset');
    group.className = 'range-time';
    const legend = document.createElement('legend');
    legend.textContent = 'Time of day';
    group.append(legend);
    for (const [label, hour] of [
      ['Day', CLOCK.startHour],
      ['Night', nightHour],
    ] as const) {
      const choice = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'range-time';
      radio.checked = label === 'Day';
      radio.onchange = (): void => {
        if (!radio.checked || this.ended) return;
        const sky = this.engine.ctx.get('sky').setTimeOfDay(hour);
        // The briefing renders, but gameplay (including world.update) is suspended.
        this.engine.ctx.get('world').updatePracticalLights(sky.sunAltitude);
      };
      choice.append(radio, label);
      group.append(choice);
    }
    this.panel.append(group);
  }

  private suspend(): void {
    this.capture.cancel();
    cancelAnimationFrame(this.frame);
    this.waiting = true;
    this.engine.setGameplaySuspended(true);
    this.engine.input.enabled = false;
    this.engine.ctx.get('player').setControlEnabled(false);
    if (!this.hiddenView) {
      this.viewVisible = this.engine.viewScene.visible;
      this.hiddenView = true;
      this.engine.viewScene.visible = false;
    }
  }

  ready(): void {
    if (this.ended || this.engine.error) return;
    this.status.textContent = this.map.startIntro ?? 'Ready when you are.';
    this.button.textContent = 'Start';
    if (!this.panel.open) this.panel.showModal();
    this.button.focus();
  }

  restart(): void {
    if (this.ended || this.engine.error || this.waiting) return;
    // Reset consumers remain synchronous. None may run a new gameplay frame
    // before all reset listeners and the actual control handoff have completed.
    this.suspend();
    this.engine.events.emit('game:restart', { source: 'game-over' });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- restart listeners may end the run or fail
    if (this.ended || this.engine.error) return;
    // A reset prepares a run, but does not authorize entering it. Keep the
    // same explicit Start handoff as initial boot, even with a retained lock.
    this.ready();
  }

  private requestControl(): void {
    if (this.ended || this.engine.error || !this.waiting) return;
    cancelAnimationFrame(this.frame);
    this.status.textContent = 'Waiting for mouse capture. Retry if needed.';
    this.button.textContent = 'Retry Start';
    this.capture.request();
  }

  private lockDenied = (): void => {
    this.status.textContent = 'Mouse capture unavailable. Select Retry Start to try again.';
  };

  private queueActivation = (): void => {
    // Never resume inside retained UI dispatch: earlier pose hooks must run on
    // the first active frame, before revealing the separate first-person scene.
    this.frame = requestAnimationFrame((): void => {
      if (
        this.ended ||
        this.engine.error ||
        !this.engine.running ||
        !this.waiting ||
        !this.capture.locked
      )
        return;
      this.engine.setGameplaySuspended(false); // Flush all queued/held input.
      this.engine.input.enabled = true;
      this.engine.ctx.get('player').setControlEnabled(true);
      this.waiting = false;
      this.panel.close();
    });
  };

  /** UI depends on market → weapons: normal weapon pose hooks have now run. */
  afterPose(): boolean {
    if (this.waiting || this.ended) return false;
    if (this.hiddenView) {
      this.engine.viewScene.visible = this.viewVisible;
      this.hiddenView = false;
    }
    return true;
  }

  private end(): void {
    this.ended = true;
    this.capture.dispose();
    cancelAnimationFrame(this.frame);
    this.panel.close();
  }

  dispose(): void {
    this.end();
    this.offError();
    this.panel.remove();
    if (this.hiddenView) this.engine.viewScene.visible = this.viewVisible;
  }
}
