import { Mixer } from '../../src/audio/mixer.ts';
import { Rng } from '../../src/core/rng.ts';
import { fixture } from './fixture.ts';

export class FixtureAudioParam implements AudioParam {
  value: number;
  automationRate: AutomationRate = 'a-rate';
  defaultValue = 0;
  minValue = -Infinity;
  maxValue = Infinity;
  events: Array<Array<string | number>> = [];
  constructor(value = 0) {
    this.value = value;
  }
  cancelScheduledValues(time: number): AudioParam {
    this.events.push(['cancel', time]);
    this.value = -1;
    return this;
  }
  cancelAndHoldAtTime(): AudioParam {
    throw new Error('Current-time hearing automation must not depend on native hold');
  }
  setValueAtTime(value: number, time: number): AudioParam {
    this.events.push(['set', value, time]);
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): AudioParam {
    this.events.push(['ramp', value, time]);
    return this;
  }
  exponentialRampToValueAtTime(): AudioParam {
    return this;
  }
  setTargetAtTime(value: number, time: number, constant: number): AudioParam {
    this.events.push(['target', value, time, constant]);
    return this;
  }
  setValueCurveAtTime(): AudioParam {
    return this;
  }
}

export class FixtureAudioBuffer implements AudioBuffer {
  readonly sampleRate = 48000;
  readonly numberOfChannels = 2;
  readonly length: number;
  readonly duration: number;
  key: string;
  index: number;
  name: string;
  kind: string;
  private readonly channels: Float32Array<ArrayBuffer>[];
  constructor({
    duration = 0.2,
    key = '',
    index = 0,
    name = '',
    kind = '',
  }: { duration?: number; key?: string; index?: number; name?: string; kind?: string } = {}) {
    this.duration = duration;
    this.key = key;
    this.index = index;
    this.name = name;
    this.kind = kind;
    this.length = Math.ceil(duration * this.sampleRate);
    this.channels = [];
  }
  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    return this.channels[channel] ?? (this.channels[channel] = new Float32Array(this.length));
  }
  copyFromChannel(destination: Float32Array<ArrayBuffer>, channel: number, start = 0): void {
    destination.set(this.getChannelData(channel).subarray(start, start + destination.length));
  }
  copyToChannel(source: Float32Array<ArrayBuffer>, channel: number, start = 0): void {
    this.getChannelData(channel).set(source, start);
  }
}

export class FixtureAudioNode extends EventTarget implements AudioNode {
  channelCount = 2;
  channelCountMode: ChannelCountMode = 'max';
  channelInterpretation: ChannelInterpretation = 'speakers';
  numberOfInputs = 1;
  numberOfOutputs = 1;
  readonly context: BaseAudioContext;
  output: AudioNode | AudioParam | undefined;
  connections: Array<AudioNode | AudioParam> = [];
  disconnected: boolean | undefined;
  constructor(context: BaseAudioContext) {
    super();
    this.context = context;
  }
  connect(destinationNode: AudioNode, output?: number, input?: number): AudioNode;
  connect(destinationParam: AudioParam, output?: number): void;
  connect(destination: AudioNode | AudioParam): AudioNode | void {
    this.output = destination;
    this.connections.push(destination);
    if ('connect' in destination) return destination;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}
export class FixtureGainNode extends FixtureAudioNode implements GainNode {
  gain = new FixtureAudioParam();
}
export class FixtureBufferSource extends FixtureAudioNode implements AudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  playbackRate = new FixtureAudioParam(1);
  detune = new FixtureAudioParam();
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null = null;
  when = 0;
  starts: number[][] = [];
  stopped: boolean | undefined;
  start(when = 0): void {
    this.when = when;
    this.starts.push([when]);
  }
  stop(): void {
    this.stopped = true;
  }
}
export class FixtureOscillator extends FixtureAudioNode implements OscillatorNode {
  frequency = new FixtureAudioParam();
  detune = new FixtureAudioParam();
  type: OscillatorType = 'sine';
  when = 0;
  onended: ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null = null;
  start(when = 0): void {
    this.when = when;
  }
  stop(): void {}
  setPeriodicWave(): void {}
}
export class FixtureBiquad extends FixtureAudioNode implements BiquadFilterNode {
  frequency = new FixtureAudioParam();
  detune = new FixtureAudioParam();
  Q = new FixtureAudioParam();
  gain = new FixtureAudioParam();
  type: BiquadFilterType = 'lowpass';
  getFrequencyResponse(): void {}
}
class FixtureCompressor extends FixtureAudioNode implements DynamicsCompressorNode {
  threshold = new FixtureAudioParam();
  knee = new FixtureAudioParam();
  ratio = new FixtureAudioParam();
  attack = new FixtureAudioParam();
  release = new FixtureAudioParam();
  reduction = 0;
}
class FixtureAudioWorkletNode extends FixtureAudioNode implements AudioWorkletNode {
  onprocessorerror: ((this: AudioWorkletNode, ev: Event) => unknown) | null = null;
  parameters = new Map<string, AudioParam>();
  port = new MessageChannel().port1;
}

export type FixtureAudioContext = Omit<
  AudioContext,
  'currentTime' | 'state' | 'createGain' | 'createBufferSource' | 'createOscillator'
> & {
  currentTime: number;
  state: AudioContextState;
  sources: FixtureBufferSource[];
  gains: FixtureGainNode[];
  oscillators: FixtureOscillator[];
  createGain(): FixtureGainNode;
  createBufferSource(): FixtureBufferSource;
  createOscillator(): FixtureOscillator;
};

/** Tracks only the native graph operations exercised by these audio recipes. */
export function createAudioContext(currentTime = 0): FixtureAudioContext {
  const actx: FixtureAudioContext = fixture<FixtureAudioContext>({
    currentTime,
    sampleRate: 48000,
    state: 'running',
    destination: fixture<AudioDestinationNode>({}),
    sources: [],
    gains: [],
    oscillators: [],
    createGain(): FixtureGainNode {
      const node = new FixtureGainNode(actx);
      actx.gains.push(node);
      return node;
    },
    createBufferSource(): FixtureBufferSource {
      const source = new FixtureBufferSource(actx);
      actx.sources.push(source);
      return source;
    },
    createOscillator(): FixtureOscillator {
      const source = new FixtureOscillator(actx);
      actx.oscillators.push(source);
      return source;
    },
    createBiquadFilter(): BiquadFilterNode {
      return new FixtureBiquad(actx);
    },
    createDynamicsCompressor(): DynamicsCompressorNode {
      return new FixtureCompressor(actx);
    },
    close(): Promise<void> {
      actx.state = 'closed';
      return Promise.resolve();
    },
  });
  return actx;
}

export function audioFixture(currentTime = 0): {
  actx: FixtureAudioContext;
  sources: FixtureBufferSource[];
} {
  const actx = createAudioContext(currentTime);
  return { actx, sources: actx.sources };
}
export function fixtureBuffer(buffer: AudioBuffer | null): FixtureAudioBuffer {
  if (!(buffer instanceof FixtureAudioBuffer)) throw Error('expected fixture buffer');
  return buffer;
}
export function fixtureMixer(actx: BaseAudioContext, rng = new Rng(1)): Mixer {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
  Object.defineProperty(globalThis, 'AudioWorkletNode', {
    configurable: true,
    value: FixtureAudioWorkletNode,
  });
  try {
    return new Mixer(actx, rng);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'AudioWorkletNode', previous);
    else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
  }
}

export function fixtureKeys<T extends object>(object: T): Array<keyof T & string> {
  return Object.keys(object).filter((key): key is keyof T & string => Object.hasOwn(object, key));
}
export function fixtureEntries<T extends object>(
  object: T
): Array<readonly [keyof T & string, T[keyof T & string]]> {
  return fixtureKeys(object).map((key): readonly [keyof T & string, T[keyof T & string]] => [
    key,
    object[key],
  ]);
}
export function at<T>(values: readonly T[], index: number): T {
  const value = values.at(index);
  if (value === undefined) throw new RangeError(`missing fixture entry ${index}`);
  return value;
}
