import { EnergyPeakController } from './energy.ts';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class EnergyMixProcessor extends AudioWorkletProcessor {
  private readonly normalizer = new EnergyPeakController(sampleRate);
  private running = true;

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') this.running = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.running) return false;
    const output = outputs[0];
    this.normalizer.process(inputs[0]?.[0], inputs[0]?.[1], output[0], output[1]);
    return true;
  }
}

registerProcessor('cod-energy-mix', EnergyMixProcessor);
