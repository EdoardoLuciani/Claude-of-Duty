import { Worker as NodeWorker } from 'node:worker_threads';
import type { Transferable as NodeTransferable } from 'node:worker_threads';

import { parseWorkerMessage } from '../../src/ai/attachment-types.ts';
import type { ClientMessage, WorkerMessage } from '../../src/ai/attachment-types.ts';

class WorkerErrorEvent extends Event implements ErrorEvent {
  readonly message: string;
  readonly filename = '';
  readonly lineno = 0;
  readonly colno = 0;
  readonly error: Error;
  constructor(error: Error) {
    super('error');
    this.message = error.message;
    this.error = error;
  }
}

/** Node transport for the production browser worker, with optional protocol recording. */
export class NativeWorker extends EventTarget implements Worker {
  readonly messages: ClientMessage[] = [];
  readonly results: Extract<WorkerMessage, { type: 'result' }>[] = [];
  readonly thread: NodeWorker;
  readonly record: boolean;
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  onerror: Worker['onerror'] = null;
  constructor({ record = false } = {}) {
    super();
    this.record = record;
    this.thread = new NodeWorker(
      `const { parentPort } = require('node:worker_threads');
      globalThis.self = { postMessage: m => parentPort.postMessage(m) };
      import(${JSON.stringify(new URL('../../src/ai/attachment-worker.ts', import.meta.url).href)}).then(() => {
        parentPort.on('message', data => {
          for (const message of data.__batch ?? [data]) self.onmessage({ data: message });
        });
      });`,
      { eval: true, execArgv: [] }
    );
    this.thread.on('message', (value: unknown): void => {
      const data = parseWorkerMessage(value);
      if (record && data.type === 'result') this.results.push(data);
      const event = new MessageEvent<WorkerMessage>('message', { data });
      this.onmessage?.call(this, event);
      this.dispatchEvent(event);
    });
    this.thread.on('messageerror', (error: Error): void => {
      const event = new MessageEvent<unknown>('messageerror', { data: error });
      this.onmessageerror?.call(this, event);
      this.dispatchEvent(event);
    });
    this.thread.on('error', (error: Error): void => {
      const event = new WorkerErrorEvent(error);
      this.onerror?.call(this, event);
      this.dispatchEvent(event);
    });
  }
  postMessage(
    message: ClientMessage,
    transfer?: Transferable[] | StructuredSerializeOptions
  ): void {
    const list = Array.isArray(transfer) ? transfer : transfer?.transfer;
    const native: NodeTransferable[] = [];
    for (const item of list ?? []) {
      if (!(item instanceof ArrayBuffer)) throw new Error('fixture only transfers ArrayBuffers');
      native.push(item);
    }
    if (this.record) this.messages.push(structuredClone(message));
    this.thread.postMessage(message, native);
  }
  batch(messages: ClientMessage[]): void {
    this.thread.postMessage({ __batch: messages });
  }
  terminate(): void {
    void this.thread.terminate();
  }
}
