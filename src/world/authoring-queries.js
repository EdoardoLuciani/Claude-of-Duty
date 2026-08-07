import { STREET, ALLEYS, BUILDINGS } from './layout.js';
import {
  groundY as queryGroundY,
  inBuilding as queryInBuilding,
  isOpen as queryIsOpen,
} from './queries.js';

// Offline builders use the canonical authored layout. Runtime supplies the same
// shape from level.json, keeping one query implementation without importing the
// procedural layout into browser bundles.
const DATA = { street: STREET, alleys: ALLEYS, buildings: BUILDINGS };

export function inBuilding(x, z, margin = 0.3) {
  return queryInBuilding(DATA, x, z, margin);
}

export function isOpen(x, z, margin = 0.3) {
  return queryIsOpen(DATA, x, z, margin);
}

export function groundY(x, z) {
  return queryGroundY(DATA, x, z);
}
