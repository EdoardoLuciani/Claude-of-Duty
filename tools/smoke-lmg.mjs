import assert from 'node:assert/strict';
import { ACTIONS } from '../src/core/input.js';
import { setCaseScale } from '../src/fx/shells.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Rng } from '../src/core/rng.js';

assert.deepEqual(WEAPON_IDS, ['rifle', 'smg', 'pistol', 'lmg']);
assert(WEAPON_IDS.every((id) => WEAPON_DEFS[id]));
assert(ACTIONS.swapWeapon.includes('Digit3') && ACTIONS.swapWeapon.includes('Digit4'));

const lmg = WEAPON_DEFS.lmg;
assert.equal(lmg.magSize, 50);
assert.equal(lmg.reserve, 75);
const recoil = buildRecoilPattern(lmg, Rng);
assert.equal(recoil.length, lmg.recoil.patternLength * 2);
assert(recoil.every(Number.isFinite));
assert(recoil.every((n, i) => i % 2 || n > 0));

const scale = setCaseScale({}, 0.051, 0.01195 / 2);
assert(Math.abs(scale.lengthScale - 0.051 / 0.045) < 1e-9);
assert(Math.abs(scale.radiusScale - (0.01195 / 2) / 0.00495) < 1e-9);
assert.notEqual(scale.lengthScale, scale.radiusScale);

console.log('LMG smoke checks passed');
