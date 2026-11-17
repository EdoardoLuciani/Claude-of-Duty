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
  | 'shotgun-distant'
  | 'mcx-distant'
  | 'mpx-distant'
  | `${'rifle' | 'mcx' | 'mpx' | 'lmg' | 'sniper' | 'pistol' | 'shotgun'}-suppressed${'' | '-distant'}`;

export interface WeaponProfile {
  sample: SampleKind;
  /** Authored distant perspective of the same recorded donor as the close bank. */
  distantSample?: SampleKind;
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
