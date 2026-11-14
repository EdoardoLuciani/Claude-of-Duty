import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as THREE from 'three';

import { Rng } from '../../src/core/rng.ts';
import { Ambience } from '../../src/fx/ambience.ts';
import { explode } from '../../src/fx/explosions.ts';
import { IMPACTS, spawnImpact, spawnExit, spawnIntelSparks } from '../../src/fx/impacts.ts';
import { FxSystem } from '../../src/fx/index.ts';
import { LightPool } from '../../src/fx/lights.ts';
import { MUZZLE_PROFILES, muzzleFlash } from '../../src/fx/muzzle.ts';
import { ParticleLayer, resetSpawn, STRIDE, disposeQuadSource } from '../../src/fx/particles.ts';
import { spawnTracer } from '../../src/fx/tracers.ts';
import { PhysicsSystem, type PhysicsHit } from '../../src/physics/index.ts';
import { fixtureKeys } from '../lib/audio-fixture.ts';
import { createTestContext } from '../lib/context.ts';

type RecordedCall = [string, unknown[]];
function recorder(
  seed: number,
  pScale: number,
  bounce = false
): { fx: FxSystem; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record =
    (kind: string): ((...args: unknown[]) => number) =>
    (...args: unknown[]): number =>
      calls.push([kind, structuredClone(args)]);
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.set(0.1, -0.2, 0.3);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const fx = new FxSystem();
  fx.rng = new Rng(seed);
  fx.pScale = pScale;
  fx.ctx = createTestContext({ camera, viewCamera: camera, scene, rng: fx.rng });
  fx.lights = new LightPool(scene);
  fx.lights.flash = (...args): null => {
    record('light')(...args);
    return null;
  };
  fx._fromView = (position): THREE.Vector3 => new THREE.Vector3(position.x, position.y, position.z);
  fx.sunWorld = (): THREE.Vector3Like => ({ x: 0.2, y: 0.8, z: -0.3 });
  fx.emitAdd = record('emitAdd');
  fx.emitLit = record('emitLit');
  fx.emitViewAdd = record('emitViewAdd');
  fx.emitViewLit = record('emitViewLit');
  fx.emitMote = record('emitMote');
  fx.addDecal = (...args): boolean => {
    record('addDecal')(...args);
    return true;
  };
  fx.haze = record('haze');
  fx.hazeRing = record('hazeRing');
  fx.viewFlash = record('viewFlash');
  fx.addSmokeColumn = record('addSmokeColumn');
  fx.scorch = record('scorch');
  fx.bloodSpatterBehind = record('bloodSpatterBehind');
  fx._physics = null;
  if (bounce) {
    const physics = new PhysicsSystem();
    // Keep the characterization's synthetic mask, independent of runtime masks.
    physics.MASK = { ...physics.MASK, WORLD: 7 };
    physics.raycast = (...args): PhysicsHit => {
      record('raycast')(...args);
      const hit = physics._nextHit();
      hit.hit = true;
      hit.distance = 0.23;
      hit.point.set(2, 1, -3);
      hit.normal.set(0, 1, 0);
      return hit;
    };
    physics.groundHeight = (): number => 0.7;
    fx._physics = physics;
  }
  return { fx, calls };
}

const point = new THREE.Vector3(2, 3, -5);
const normal = new THREE.Vector3(0.2, 0.9, 0.3).normalize();
const incident = new THREE.Vector3(-0.8, -0.1, 0.4).normalize();
const results: Record<string, string> = {};
function check(
  name: string,
  seed: number,
  scale: number,
  run: (fx: FxSystem) => void,
  bounce = false
): void {
  const { fx, calls } = recorder(seed, scale, bounce);
  run(fx);
  // Include the next draws, not just visible output: even discarded draws are a contract.
  const next = Array.from({ length: 8 }, (): number => fx.rng.u32());
  const payload = JSON.stringify({ calls, next });
  if (process.env.DUMP_CHARACTERIZATION) console.log(name, payload);
  results[name] = createHash('sha256').update(payload).digest('hex');
}

for (const surface of [...fixtureKeys(IMPACTS), 'unknown' as const]) {
  for (const scale of [0.4, 1.25]) {
    for (const [name, spawn] of [
      ['impact', spawnImpact],
      ['exit', spawnExit],
    ] as const) {
      check(
        `${name}:${surface}:${scale}`,
        0x5eed,
        scale,
        (fx): void => {
          if (surface === 'unknown') {
            // Deliberate untyped-input compatibility scenario; do not widen production contracts.
            Reflect.apply(spawn, undefined, [fx, point, normal, incident, surface, 1.3]);
          } else spawn(fx, point, normal, incident, surface, 1.3);
        },
        true
      );
    }
  }
}
for (const weapon of [...fixtureKeys(MUZZLE_PROFILES), 'unknown' as const]) {
  for (const view of [false, true]) {
    check(`muzzle:${weapon}:${view}`, 0xabcd, 0.8, (fx): void => {
      muzzleFlash(fx, { position: point, direction: incident, weapon, view, intensity: 0.6 });
    });
  }
}
// A mounted can changes the very next flash without changing the base weapon definition.
for (const suppressed of [false, true, false]) {
  const { fx } = recorder(0xabcd, 0.8);
  assert.equal(
    muzzleFlash(fx, {
      position: point,
      direction: incident,
      weapon: { class: 'carbine', attachments: { muzzle: suppressed ? 'suppressor' : null } },
    }),
    suppressed ? MUZZLE_PROFILES.suppressed : MUZZLE_PROFILES.carbine
  );
}
for (const [name, options] of Object.entries({
  default: {},
  staged: { flightTime: 0.3, warm: 0.7 },
  invalid: { flightTime: -1 },
})) {
  check(`tracer:${name}`, 0x1234, 1, (fx): void => spawnTracer(fx, point, normal, 600, options));
}
check('tracer:short', 0x1234, 1, (fx): void => spawnTracer(fx, point, point, 0));
check('intel', 0xabcd, 1, (fx): void => spawnIntelSparks(fx, point));
for (const radius of [0.1, 5, 12]) {
  check(`explosion:${radius}`, 0xabcd, 0.4, (fx): boolean =>
    explode(fx, { position: point, radius })
  );
}
check(
  'ambience',
  0x5eed,
  1,
  (fx): void => {
    const ambience = new Ambience(fx, { motes: 4, shimmer: true });
    ambience.addColumn(1, 2, 3, { rate: 20, duration: 0.4, ember: 1, haze: 1 });
    for (const dt of [0.1, 0.15, 0.2, 0.1]) ambience.update(dt, 1, fx.ctx.camera);
  },
  true
);

// Bun 1.4.4 exact baseline. Paired Node dumps retain call order and RNG draws;
// only floating-point results differ (maximum absolute delta 7.2e-15).
const expected = {
  'impact:concrete:0.4': '537b677ce85628c4ed90d9e9e93903d856c9e36ec6e3cce59edf62d038ccbc17',
  'exit:concrete:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:concrete:1.25': 'aa6d852647c6c720e32e4b9159417c2b8745773cf5a62f00fde8f322852e7eaf',
  'exit:concrete:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:plaster:0.4': '58fde50bfeac86fb37b12167d9720e9580e5120eaa5d80cca4924167a2df921e',
  'exit:plaster:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:plaster:1.25': '568ad7b283c3675ecfb174330b9fe9bab58cd9a014137f9dca781b0fb6ca8f4b',
  'exit:plaster:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:metal:0.4': 'ced94f4332456355ad5541ab568ac594cf1704f52688841de63a647535bf393a',
  'exit:metal:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:metal:1.25': '7284b8bd980313db04d4aba3f3c357a3b7e793223aa3473f028caf9e26a42b04',
  'exit:metal:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:wood:0.4': '74062072a7568b49de0def45915c963fb1e62a51ed2b5f1d61931f6dce5b710e',
  'exit:wood:0.4': '171b17173d553b2f05f7e8bc81976efbd640c0a0b6dce4adf4a214a10d84d024',
  'impact:wood:1.25': '8aaa6796f01ff8a8251549ef31d7f1a6940e8ecce15222d117a7acc10f927691',
  'exit:wood:1.25': 'aaef04947f87bc21dd18f83978cb73023aaebb06bc84c64f54b294745ba13bbe',
  'impact:dirt:0.4': 'c49585f2d02aeac3415c21acc387fcc1a8b620ea6cdada04f2169344202b9b65',
  'exit:dirt:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:dirt:1.25': 'ec9c50ff132e3417e24b6b2f31c38bc8cdf28f37080124979687d4308d528d20',
  'exit:dirt:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:sand:0.4': '35e37947d5b15cebfb8e4a4ccd9dc77449ade6454080e1f88441ec971a783a4d',
  'exit:sand:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:sand:1.25': 'f4c758e2e53b57b5ee9612f06d48ced2c5924534f528c4183e7e23fc3e51b119',
  'exit:sand:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:glass:0.4': 'ff233cef52da665511acd817ba323b0166fadc6fcddd3ffcb1af1db1704b93c2',
  'exit:glass:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:glass:1.25': '586095ad4c2e088fd0666c5d234be171d3abf7436706a063fc2f0318289b7d1c',
  'exit:glass:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:water:0.4': '7b2004ee79dd867ee41690672b0332bdc57e8b43320d1ec6d3e94fce7c85c845',
  'exit:water:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:water:1.25': 'd996ed6d582ce3ff903c860a650a94fa5f655a13d6d42861b22a01e014dc2236',
  'exit:water:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:flesh:0.4': 'f44ab8c947d08a0a114fad456ae27bdec7192762fc1d52ce062ee78e4ed60841',
  'exit:flesh:0.4': 'f44ab8c947d08a0a114fad456ae27bdec7192762fc1d52ce062ee78e4ed60841',
  'impact:flesh:1.25': '50f45a2a55b531f32c23cb22369f3be947446f17bf3b731cd927bebc1f02289b',
  'exit:flesh:1.25': '50f45a2a55b531f32c23cb22369f3be947446f17bf3b731cd927bebc1f02289b',
  'impact:foliage:0.4': 'b6d6f1dde856959d95b903f1de7a7725b4b4b8bab5368d71dd65636f94dcdb8b',
  'exit:foliage:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:foliage:1.25': 'e2c11841326dcd44e218f9d128804d2b7cdf0d57e95f58196ca8242cf02f9506',
  'exit:foliage:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:fabric:0.4': 'b558c5046d7492096450cb160677dd04c35707bd344cc9ab72179f0bfbfa4c23',
  'exit:fabric:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:fabric:1.25': '7e1ecd5c66e8dafdae7ca2d790a5e218def46e88c166df1e32d29c06e7fd7ef4',
  'exit:fabric:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:rubber:0.4': '8a66f231a8a6ef08d22eb45568189f528c4bedae75a9d36b8352969588ee0de7',
  'exit:rubber:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:rubber:1.25': 'f6fd1540412937dfda1778ba44a9f8a3d0b0f5fd8bdd29ae4b3efe5e32ee3354',
  'exit:rubber:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:unknown:0.4': '537b677ce85628c4ed90d9e9e93903d856c9e36ec6e3cce59edf62d038ccbc17',
  'exit:unknown:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:unknown:1.25': 'aa6d852647c6c720e32e4b9159417c2b8745773cf5a62f00fde8f322852e7eaf',
  'exit:unknown:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'muzzle:rifle:false': '04fb434b0870c7a72a99080c67f0e7ebc8a80b394bbf4cfd261599007f8d5c89',
  'muzzle:rifle:true': '4b152a31657d2ba34fa9cbe8b29485e313127f08cbda0ffd12572949c1bca5f8',
  'muzzle:carbine:false': '84d55ff6c41fa677a8911f370bd2d78a2b211a99aba6188e50c0eba2a6b83624',
  'muzzle:carbine:true': '0632d68d22177b14b9035b4cd79e812437448f6c0556365ed3372a70b227969a',
  'muzzle:smg:false': '4c07537258b0dca1e9733e9a7c0ca407314aac37dad5de2d2486aac39124f4e1',
  'muzzle:smg:true': '63af4a6fe96d65ed903e9c6bdcb74a217c1d8c4c8573986fb25603034a359476',
  'muzzle:pistol:false': 'e701e0a0dc2e01a0c15a41faced020cdec472f7e553d7c9d4c55468ed8ac3bfb',
  'muzzle:pistol:true': '55472ce863a83000b44d8ec413f47dec7a61a6032e509188e1a10d59c4cc199e',
  'muzzle:shotgun:false': '0bbe9d4dc32902525601d729a19db96716fdaa83330aa8c257a4ba6bbc377544',
  'muzzle:shotgun:true': '538f8728de3eb3f3c863fb89f63004f24ef081caf3fcb68193bd2fc3a9165a81',
  'muzzle:sniper:false': 'cc21039525d660660df107bccd4f5118852d937c627b48515cc9d5e73b065994',
  'muzzle:sniper:true': 'ad65c401d8c94b202bd39bfcc578a7d1a72fb3469f661d33276e728ed1ac8c05',
  'muzzle:lmg:false': 'f1812d4f939b97900cda33b58cb2f03046e4641c891dd507f9afdc72dc6c59dd',
  'muzzle:lmg:true': 'e78099ddcf32c71b818537a2005ae4cfca5c00b20ccd6928809d8e368e43f569',
  'muzzle:suppressed:false': 'c6cca6a969194c2226dfaf9d62d1c0e704b7f059a292b88637461132dc60e7d9',
  'muzzle:suppressed:true': '8daba4fec8014ec7927346966ba72c56daded91437375e08840c6e8860e9c5a5',
  'muzzle:unknown:false': '04fb434b0870c7a72a99080c67f0e7ebc8a80b394bbf4cfd261599007f8d5c89',
  'muzzle:unknown:true': '4b152a31657d2ba34fa9cbe8b29485e313127f08cbda0ffd12572949c1bca5f8',
  'tracer:default': 'dbedb7e9cea801c1d53c23ba10988fdd22f19795f4e826cdda919457090d2d35',
  'tracer:staged': '6dd06caa5837e69793151c518f7724ddafaa01e85e3ff06b92f84205aa3de4cc',
  'tracer:invalid': 'dbedb7e9cea801c1d53c23ba10988fdd22f19795f4e826cdda919457090d2d35',
  'tracer:short': 'ddbdd6b5aa4de7cbcb7ef9b8d97acb40cfee52bdafce524b239b7ae01ab95763',
  intel: '5d4ba72c21e51c652bad95a83ac18fe8875bfe2fc4c9d15dc64ab818452a4677',
  'explosion:0.1': '94bc4069c88dfe39ab147dec660c4a34ac9e1c7433f53c0358aefe592232f260',
  'explosion:5': '693e9f7145bdd044ab6fc9253578974426c6d9b1d8ee3b7134f391017b25cb1c',
  'explosion:12': '6d1c3cfcc0d356cbd626317827e8607408b88bd62e78be45f4db00ddbc6e706e',
  ambience: 'b97120b81c1f012fd2cfcc54139cb38b62f6576720866205909424552d91365b',
};
assert.deepEqual(
  results,
  expected,
  'FX characterization changed; inspect ordered payloads/RNG with DUMP_CHARACTERIZATION=1'
);

// A real particle layer verifies bounded slot reuse, exact packing and upload/expiry lifecycle.
const texture = new THREE.Texture();
const layer = new ParticleLayer({ capacity: 16, mode: 'additive', atlas: texture, cols: 4 });
const defaults = { ...resetSpawn() };
try {
  for (let i = 0; i < 18; i++) {
    const spawn = { ...defaults, x: i, life: 0, delay: 0.25, flags: 2 };
    assert.equal(layer.emit(spawn, 2), i % 16);
  }
  assert.equal(layer.spawned, 18);
  assert.equal(layer.highWater, 16);
  assert.equal(layer.cursor, 2);
  assert.equal(layer.expireAt, 2.266);
  assert.deepEqual(
    Array.from(layer.array.slice(0, STRIDE)),
    [
      16, 0, 0, 0.2, 0, 0, 0, 0.3, 2.25, 62.5, 1.4, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0.4,
      1, 1, 0, 1, 0, 2,
    ].map(Math.fround)
  );
  layer.flush(2.25);
  assert.equal(layer.geometry.instanceCount, 16);
  assert.equal(layer.mesh.visible, true);
  assert.deepEqual(layer.ibuf.updateRanges, [{ start: 0, count: 16 * STRIDE }]);
  const version = layer.ibuf.version;
  layer.flush(3);
  assert.equal(layer.mesh.visible, false);
  assert.equal(layer.ibuf.version, version, 'time-only frames do not republish slot data');
  assert.equal(layer.material.blendSrcAlpha, THREE.ZeroFactor);
  assert.equal(layer.material.blendDstAlpha, THREE.OneFactor);
} finally {
  layer.dispose();
  texture.dispose();
  disposeQuadSource();
}
console.log('[fx-recipes] seeded payload/RNG goldens and particle ring lifecycle passed');
