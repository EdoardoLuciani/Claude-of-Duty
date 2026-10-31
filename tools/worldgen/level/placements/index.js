import { eastSide } from './east-side.js';
import { interiors } from './interiors.js';
import { market } from './market.js';
import { midStreet } from './mid-street.js';
import { northStreet } from './north-street.js';
import { southStreet } from './south-street.js';
import { westSide } from './west-side.js';

// Keep authored order: generation and support diagnostics consume this sequence.
export const PLACEMENTS = [
  ...eastSide,
  ...interiors,
  ...market,
  ...midStreet,
  ...northStreet,
  ...southStreet,
  ...westSide,
];
