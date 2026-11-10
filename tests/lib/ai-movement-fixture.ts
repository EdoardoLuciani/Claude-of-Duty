import { parseClientMessage, type ClientMessage } from '../../src/ai/attachment-types.ts';
import type { LadderDescriptor } from '../../src/ai/ladder.ts';

/** Browser-compatible transport with explicit lifecycle and malformed-delivery controls. */
export class MovementWorker extends EventTarget implements Worker {
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  onerror: Worker['onerror'] = null;
  messages: ClientMessage[] = [];
  terminated = false;
  readonly silent: boolean;
  readonly throws: string | undefined;

  constructor({ silent = false, throws }: { silent?: boolean; throws?: string } = {}) {
    super();
    this.silent = silent;
    this.throws = throws;
  }

  postMessage(message: unknown): void {
    const parsed = parseClientMessage(message);
    if (parsed.type === this.throws) throw new Error(`send ${parsed.type}`);
    this.messages.push(structuredClone(parsed));
    if (parsed.type === 'init' && !this.silent)
      queueMicrotask((): void => this.deliver({ type: 'ready' }));
  }

  deliver(data: unknown): void {
    this.onmessage?.call(this, new MessageEvent<unknown>('message', { data }));
  }

  terminate(): void {
    this.terminated = true;
  }
}

export interface MutableLadderDescriptor {
  id: number;
  volumeIndex: number;
  normal: { x: number; y: number; z: number };
  radius: number;
  points: [
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
  ];
}

/** Owned, mutable geometry for deliberately corrupting serialized ladder inputs. */
export function mutableLadder(descriptor: LadderDescriptor): MutableLadderDescriptor {
  return {
    ...descriptor,
    normal: { ...descriptor.normal },
    points: [
      { ...descriptor.points[0] },
      { ...descriptor.points[1] },
      { ...descriptor.points[2] },
      { ...descriptor.points[3] },
    ],
  };
}
