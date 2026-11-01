/** Required recorded firearm banks. */
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
  | 'ak-distant'
  | 'rifle-distant'
  | 'pistol-distant'
  | 'lmg-distant'
  | 'sniper-distant'
  | 'shotgun-distant';

export interface WeaponProfile {
  sample: SampleKind;
  /** Authored distant perspective; MCX/MPX retain their suppressed close recordings. */
  distantSample?: SampleKind;
  suppressed?: boolean;
}

export interface SampleOptions {
  when?: number | undefined;
  distance?: number | undefined;
  firstPerson?: boolean | undefined;
}

export interface AudioVoice {
  node: GainNode;
  end: number;
  send: number;
}
