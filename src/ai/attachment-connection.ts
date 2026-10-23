import { parseWorkerMessage } from './attachment-types.ts';
import type { ClientMessage, InitMessage, WorkerMessage } from './attachment-types.ts';

export const ATTACHMENT_DEADLINE_MS = 10000;
type ResultMessage = Extract<WorkerMessage, { type: 'result' }>;

// Transport only: no world revisions, actor scopes, proof caches or retry policy.
export class AttachmentConnection {
  worker: Worker | null;
  readonly initialized: Promise<void>;
  private onFailure: (error: Error) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancelInit: (() => void) | null = null;
  private rejectInit: ((error: Error) => void) | null = null;

  constructor(
    worker: Worker,
    init: InitMessage,
    transfer: ArrayBuffer[],
    onResult: (message: ResultMessage) => void,
    onFailure: (error: Error) => void
  ) {
    this.worker = worker;
    this.onFailure = onFailure;
    this.initialized = new Promise<void>((resolve, reject) => {
      this.cancelInit = resolve;
      this.rejectInit = reject;
      this.timer = setTimeout(
        () => this.fail(new Error('[ai worker] initialization deadline exceeded')),
        ATTACHMENT_DEADLINE_MS
      );
      worker.onerror = (event) => this.fail(new Error(`[ai worker] ${event.message}`));
      worker.onmessageerror = () => this.fail(new Error('[ai worker] invalid message'));
      worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!this.worker) return;
        try {
          const message = parseWorkerMessage(data);
          if (message.type === 'error') throw new Error(message.message);
          if (message.type === 'ready') {
            if (!this.cancelInit) throw new Error('[ai worker] duplicate readiness');
            clearTimeout(this.timer);
            this.cancelInit = this.rejectInit = null;
            resolve();
          } else {
            if (this.cancelInit) throw new Error('[ai worker] result before readiness');
            onResult(message);
          }
        } catch (error) {
          this.fail(error);
        }
      };
      // Do not throw out of construction and lose the rejected init promise.
      try {
        worker.postMessage(init, transfer);
      } catch (error) {
        this.fail(error);
      }
    });
  }

  send(message: ClientMessage) {
    if (!this.worker) throw new Error('[ai worker] connection closed');
    try {
      this.worker.postMessage(message);
    } catch (error) {
      throw this.fail(error);
    }
  }

  private fail(error: unknown): Error {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (this.worker) {
      this.rejectInit?.(failure);
      this.close();
      this.onFailure(failure);
    }
    return failure;
  }

  close() {
    const worker = this.worker;
    this.worker = null;
    clearTimeout(this.timer);
    if (worker) {
      worker.onmessage = worker.onmessageerror = worker.onerror = null;
      worker.terminate();
    }
    this.cancelInit?.(); // Restart/disposal is benign, not a physical failure.
    this.cancelInit = this.rejectInit = null;
  }
}
