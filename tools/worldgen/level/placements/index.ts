import type { PlacementRow } from '../../placement.ts';
import { eastSide } from './east-side.ts';
import { interiors } from './interiors.ts';
import { market } from './market.ts';
import { midStreet } from './mid-street.ts';
import { northStreet } from './north-street.ts';
import { southStreet } from './south-street.ts';
import { westSide } from './west-side.ts';

// Keep authored order: generation and support diagnostics consume this sequence.
export const PLACEMENT_ROWS: PlacementRow[] = [
  ...eastSide,
  ...interiors,
  ...market,
  ...midStreet,
  ...northStreet,
  ...southStreet,
  ...westSide,
];
