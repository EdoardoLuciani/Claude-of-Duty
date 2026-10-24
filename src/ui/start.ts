import type { Engine } from '../core/engine.ts';

/** Normal-play handoff only; capture pumps deliberately do not install this gate. */
export class StartGate {
  private panel = document.createElement('dialog');
  private status = document.createElement('p');
  private button = document.createElement('button');
  private waiting = true;
  private intent = false;
  private ended = false;
  private generation = 0;
  private frame = 0;
  private hiddenView = false;
  private viewVisible = true;
  private offError: () => void;

  private engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
    this.panel.id = 'run-start';
    this.panel.setAttribute('aria-labelledby', 'run-start-title');
    this.panel.style.cssText =
      'margin:auto;width:min(28rem,calc(100vw - 3rem));padding:2.5rem;text-align:center;color:#dce4e7;background:#080d10f2;border:1px solid #42645e;font:16px/1.6 Inter,Arial,sans-serif';
    const title = document.createElement('h1');
    title.id = 'run-start-title';
    title.textContent = 'Claude of Duty';
    title.style.cssText = 'font-size:1.5rem;font-weight:600;letter-spacing:.12em';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.style.cssText = 'margin:1.25rem 0;color:#aabdc3';
    this.button.type = 'button';
    this.button.style.cssText =
      'padding:.8rem 2.5rem;border:1px solid #65b9ab;background:#13231f;color:#e2eee9;font:inherit;letter-spacing:.12em;cursor:pointer';
    this.button.onclick = () => this.requestControl();
    this.panel.oncancel = (event) => event.preventDefault();
    this.panel.onkeydown = (event) => {
      event.stopPropagation();
      // A held New Game key must not activate the newly focused Start button.
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    };
    this.panel.onkeyup = (event) => event.stopPropagation();
    this.panel.append(title, this.status, this.button);
    document.body.append(this.panel);
    document.addEventListener('pointerlockchange', this.lockChanged);
    document.addEventListener('pointerlockerror', this.lockDenied);
    this.offError = engine.events.on('engine:error', () => this.end());
    this.suspend();
  }

  private suspend(): void {
    this.generation++;
    cancelAnimationFrame(this.frame);
    this.waiting = true;
    this.intent = false;
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
    this.status.textContent = 'Ready when you are.';
    this.button.textContent = 'START';
    if (!this.panel.open) this.panel.showModal();
    this.button.focus();
  }

  restart(): void {
    if (this.ended || this.engine.error || this.waiting) return;
    // Reset consumers remain synchronous. None may run a new gameplay frame
    // before all reset listeners and the actual control handoff have completed.
    this.suspend();
    this.engine.events.emit('game:restart', { source: 'game-over' });
    if (this.ended || this.engine.error) return;
    // A reset prepares a run, but does not authorize entering it. Keep the
    // same explicit Start handoff as initial boot, even with a retained lock.
    this.ready();
  }

  private requestControl(): void {
    if (this.ended || this.engine.error || !this.waiting) return;
    this.intent = true;
    const generation = ++this.generation;
    this.status.textContent = 'Waiting for mouse capture. Retry if needed.';
    this.button.textContent = 'RETRY START';
    if (document.pointerLockElement === this.engine.canvas) {
      this.queueActivation(); // New Game can begin with the lock already held.
      return;
    }
    try {
      const request = this.engine.canvas.requestPointerLock();
      request?.catch(() => {
        if (generation === this.generation) this.lockDenied();
      });
    } catch {
      this.lockDenied();
    }
  }

  private lockDenied = (): void => {
    if (this.ended || this.engine.error || !this.waiting) return;
    this.status.textContent = 'Mouse capture unavailable. Select Retry Start to try again.';
  };

  private lockChanged = (): void => {
    if (document.pointerLockElement === this.engine.canvas) this.queueActivation();
  };

  private queueActivation(): void {
    const generation = this.generation;
    cancelAnimationFrame(this.frame);
    // Never resume inside retained UI dispatch: earlier pose hooks must run on
    // the first active frame, before revealing the separate first-person scene.
    this.frame = requestAnimationFrame(() => {
      if (
        this.ended ||
        this.engine.error ||
        !this.engine._running ||
        !this.waiting ||
        !this.intent ||
        generation !== this.generation ||
        document.pointerLockElement !== this.engine.canvas
      )
        return;
      this.engine.setGameplaySuspended(false); // Flush all queued/held input.
      this.engine.input.enabled = true;
      this.engine.ctx.get('player').setControlEnabled(true);
      this.waiting = false;
      this.panel.close();
    });
  }

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
    this.generation++;
    cancelAnimationFrame(this.frame);
    this.panel.close();
  }

  dispose(): void {
    this.end();
    this.offError();
    document.removeEventListener('pointerlockchange', this.lockChanged);
    document.removeEventListener('pointerlockerror', this.lockDenied);
    this.panel.remove();
    if (this.hiddenView) this.engine.viewScene.visible = this.viewVisible;
  }
}
