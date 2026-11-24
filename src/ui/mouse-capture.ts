import type { Engine } from '../core/engine.ts';

/** Both modal handoffs wait for real capture, not just request settlement. */
export class MouseCapture {
  private attempt = 0;
  private pending = false;
  private disposed = false;

  constructor(
    private readonly engine: Engine,
    private readonly captured: () => void,
    private readonly denied: () => void
  ) {
    document.addEventListener('pointerlockchange', this.onChange);
    document.addEventListener('pointerlockerror', this.onError);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.engine.canvas;
  }

  request(): void {
    const { engine } = this;
    this.pending = true;
    const attempt = ++this.attempt;
    if (this.locked) this.onChange();
    else
      engine.input.requestPointerLock((requested): void => {
        if (!requested && attempt === this.attempt) this.onError();
        // A browser request can finish after the session has failed or torn down.
        if (requested && (this.disposed || engine.error || !engine.running) && this.locked)
          document.exitPointerLock();
      });
    engine.input.requestFullscreen();
  }

  cancel(): void {
    this.pending = false;
    this.attempt++;
  }

  private onError = (): void => {
    if (this.pending && !this.engine.error) this.denied();
  };

  private onChange = (): void => {
    if (!this.pending || !this.locked || !this.engine.running || this.engine.error) return;
    this.cancel();
    this.captured();
  };

  dispose(): void {
    this.disposed = true;
    if (this.pending && this.locked) document.exitPointerLock();
    this.cancel();
    document.removeEventListener('pointerlockchange', this.onChange);
    document.removeEventListener('pointerlockerror', this.onError);
  }
}
