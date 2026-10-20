export interface RoundRobinVariant {
  body: number;
  crack: number;
  crackQ: number;
  tail: number;
  drive: number;
  mid: number;
  level: number;
  mech: number;
  tilt: number;
}

/** Shared sound-tuning data for a weapon's synthesized/recorded audio. */
export type SampleKind =
  | 'mcx'
  | 'mpx'
  | 'rifle'
  | 'ak'
  | 'lmg'
  | 'smg'
  | 'pistol'
  | 'shotgun'
  | 'sniper'
  | 'suppressed'
  | 'rifle-distant'
  | 'pistol-distant'
  | 'lmg-distant'
  | 'sniper-distant'
  | 'shotgun-distant';

export interface WeaponProfile {
  sample?: SampleKind | null;
  /** Authored distant report; absent for the suppressed MCX close-source fallback. */
  distantSample?: SampleKind;
  sampleGain?: number;
  sampleSend?: number;
  sampleLowpass?: number;
  sampleAction?: boolean;
  samplePunch?: boolean;
  firstPersonGain?: number;
  punchTail?: number;
  suppressed?: boolean;
  pellets?: number;
  level: number;
  bodyF: number;
  bodyF2: number;
  bodyDecay: number;
  subF: number;
  subDecay: number;
  crackF: number;
  crackQ: number;
  crackDecay: number;
  drive: number;
  asym: number;
  midF: number;
  midDecay: number;
  tailDecay: number;
  tailF: number;
  tailEndF: number;
  mechDelay: number;
  mechLevel: number;
  mechPartials: number[];
  send: number;
  _rr?: RoundRobinVariant[];
  _rrIndex?: number;
}

export interface SampleOptions {
  when?: number;
  distance?: number;
  firstPerson?: boolean;
}

export interface WeaponSoundOptions extends SampleOptions {
  echoBoost?: number;
  miss?: number;
  gain?: number;
}

export interface AudioVoice {
  node: GainNode;
  end: number;
  send: number;
}
