import { Worker } from 'node:worker_threads';

/** Node transport for the production browser worker, with optional protocol recording. */
export class NativeWorker {
  messages = [];
  results = [];
  constructor({ record = false } = {}) {
    this.record = record;
    this.thread = new Worker(
      `const { parentPort } = require('node:worker_threads');
      globalThis.self = { postMessage: m => parentPort.postMessage(m) };
      import(${JSON.stringify(new URL('../../src/ai/attachment-worker.ts', import.meta.url).href)}).then(() => {
        parentPort.on('message', data => {
          for (const message of data.__batch ?? [data]) self.onmessage({ data: message });
        });
      });`,
      { eval: true, execArgv: [] }
    );
    this.thread.on('message', (data) => {
      if (record && data.type === 'result') this.results.push(data);
      this.onmessage?.({ data });
    });
    this.thread.on('error', (error) => this.onerror?.({ message: error.message }));
  }
  postMessage(message, transfer) {
    if (this.record) this.messages.push(structuredClone(message));
    this.thread.postMessage(message, transfer);
  }
  batch(messages) {
    this.thread.postMessage({ __batch: messages });
  }
  terminate() {
    void this.thread.terminate();
  }
}
