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

interface RecordingProfile {
  sample: SampleKind;
  /** Authored distant report; absent for the suppressed MCX close-source fallback. */
  distantSample?: SampleKind;
  sampleSend?: number;
  suppressed?: boolean;
}

export type WeaponProfile = RecordingProfile &
  ({ samplePunch: false; sampleAction: false } | LegacyWeaponProfile);

/** Only AK/generic-suppressed takes still need synthesized repair/reinforcement. */
export interface LegacyWeaponProfile extends RecordingProfile {
  samplePunch?: true;
  sampleAction?: boolean;
  sampleGain?: number;
  sampleLowpass?: number;
  firstPersonGain?: number;
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
