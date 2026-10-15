/** World markers retain pooled objectives/danger warnings, never damage numerals. */
import assert from 'node:assert/strict';

import { PerspectiveCamera, Vector3 } from 'three';

import { UiSystem } from '../../src/ui/index.ts';
import { WorldMarkers } from '../../src/ui/markers.ts';

function node() {
  return {
    children: [],
    style: {
      setProperty(key, value) {
        this[key] = value;
      },
    },
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute() {},
    remove() {},
  };
}
const originalDocument = globalThis.document;
globalThis.document = { createElement: node, createElementNS: node };
try {
  const parent = node(),
    markers = new WorldMarkers(parent);
  assert.equal(markers.objPool.count, 6, 'objective pool retained');
  assert.equal(markers.nadePool.count, 4, 'grenade pool retained');
  assert.equal(markers.objRoot.children.length, 10, 'only objective and grenade nodes allocated');
  assert.equal('dnPool' in markers, false, 'no damage-number pool');
  assert.equal('spawnDamage' in markers, false, 'no popup spawning path');
  assert.equal('damageNumber' in UiSystem.prototype, false, 'no public popup API');

  const camera = new PerspectiveCamera(80, 16 / 9, 0.1, 100);
  camera.updateMatrixWorld(true);
  markers.updateObjectives(
    [{ position: new Vector3(0, 0, -12), label: 'A', name: 'HOLD' }],
    camera,
    1920,
    1080,
    1
  );
  const objective = markers.objPool.items[0];
  assert.equal(objective.alive, true);
  assert.equal(objective.node._letter.textContent, 'A');
  assert.equal(objective.node._dist.textContent, '12M');
  assert.equal(objective.node._chev.style.display, 'none', 'on-screen objective uses diamond');
  markers.updateObjectives(
    [{ position: new Vector3(40, 0, -12), label: 'A' }],
    camera,
    1920,
    1080,
    1
  );
  assert.equal(objective.node._chev.style.display, '', 'off-screen projection retains chevron');
  markers.updateObjectives([], camera, 1920, 1080, 1);
  assert.equal(objective.alive, false, 'unused objectives hidden');

  const position = new Vector3(0, 0, -2);
  const grenade = markers.spawnGrenade(position, 2.4);
  position.z = -100;
  markers.updateGrenades(1 / 60, camera, 1920, 1080, 1);
  assert.equal(grenade.alive, true);
  assert.equal(grenade.node._pos.z, -2, 'pooled marker owns its position copy');
  assert.equal(grenade.node._label.textContent, 'DANGER CLOSE');
  assert.match(
    grenade.node.style.transform,
    /translate\(960\.0px,540\.0px\)/,
    'world projection retained'
  );
  markers.updateGrenades(2.4, camera, 1920, 1080, 1);
  assert.equal(grenade.alive, false, 'fuse expiry releases marker');
  markers.spawnGrenade(new Vector3(0, 0, -12));
  markers.clear();
  assert.equal(
    markers.nadePool.items.some((it) => it.alive),
    false,
    'restart clears danger warnings'
  );
  markers.dispose();
  console.log('smoke-ui-markers: ok');
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
