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
    this.port.onmessage = ({ data }): void => {
      if (data === 'stop') this.running = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.running) return false;
    // The node is created with outputChannelCount [2]; anything else is a wiring bug.
    const outL = outputs.at(0)?.at(0);
    const outR = outputs.at(0)?.at(1);
    if (!outL || !outR) throw new Error('[audio] energy mix needs one stereo output');
    this.normalizer.process(inputs[0]?.[0], inputs[0]?.[1], outL, outR);
    return true;
  }
}

registerProcessor('cod-energy-mix', EnergyMixProcessor);
