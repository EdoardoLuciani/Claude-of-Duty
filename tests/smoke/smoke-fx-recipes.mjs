import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as THREE from 'three';

import { Rng } from '../../src/core/rng.ts';
import { Ambience } from '../../src/fx/ambience.ts';
import { explode } from '../../src/fx/explosions.ts';
import { IMPACTS, spawnImpact, spawnExit, spawnIntelSparks } from '../../src/fx/impacts.ts';
import { MUZZLE_PROFILES, muzzleFlash } from '../../src/fx/muzzle.ts';
import { ParticleLayer, resetSpawn, STRIDE, disposeQuadSource } from '../../src/fx/particles.ts';
import { spawnTracer } from '../../src/fx/tracers.ts';

function recorder(seed, pScale, bounce = false) {
  const calls = [];
  const record =
    (kind) =>
    (...args) =>
      calls.push([kind, structuredClone(args)]);
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.set(0.1, -0.2, 0.3);
  camera.updateMatrixWorld();
  const fx = {
    rng: new Rng(seed),
    pScale,
    ctx: { camera, viewCamera: camera },
    lights: { flash: record('light') },
    _fromView: (position) => position,
    sunWorld: () => ({ x: 0.2, y: 0.8, z: -0.3 }),
  };
  for (const method of [
    'emitAdd',
    'emitLit',
    'emitViewAdd',
    'emitViewLit',
    'emitMote',
    'addDecal',
    'haze',
    'hazeRing',
    'viewFlash',
    'addSmokeColumn',
    'scorch',
    'bloodSpatterBehind',
  ])
    fx[method] = record(method);
  if (bounce) {
    fx.physics = {
      MASK: { WORLD: 7 },
      raycast(...args) {
        record('raycast')(...args);
        return {
          hit: true,
          distance: 0.23,
          point: { x: 2, y: 1, z: -3 },
          normal: { x: 0, y: 1, z: 0 },
        };
      },
      groundHeight: () => 0.7,
    };
  }
  return { fx, calls };
}

const point = new THREE.Vector3(2, 3, -5);
const normal = new THREE.Vector3(0.2, 0.9, 0.3).normalize();
const incident = new THREE.Vector3(-0.8, -0.1, 0.4).normalize();
const results = {};
function check(name, seed, scale, run, bounce = false) {
  const { fx, calls } = recorder(seed, scale, bounce);
  run(fx);
  // Include the next draws, not just visible output: even discarded draws are a contract.
  const next = Array.from({ length: 8 }, () => fx.rng.u32());
  results[name] = createHash('sha256').update(JSON.stringify({ calls, next })).digest('hex');
}

for (const surface of [...Object.keys(IMPACTS), 'unknown']) {
  for (const scale of [0.4, 1.25]) {
    for (const [name, spawn] of [
      ['impact', spawnImpact],
      ['exit', spawnExit],
    ]) {
      check(
        `${name}:${surface}:${scale}`,
        0x5eed,
        scale,
        (fx) => {
          spawn(fx, point, normal, incident, surface, 1.3);
        },
        true
      );
    }
  }
}
for (const weapon of [...Object.keys(MUZZLE_PROFILES), 'unknown']) {
  for (const view of [false, true]) {
    check(`muzzle:${weapon}:${view}`, 0xabcd, 0.8, (fx) => {
      muzzleFlash(fx, { position: point, direction: incident, weapon, view, intensity: 0.6 });
    });
  }
}
for (const [name, options] of Object.entries({
  default: {},
  staged: { flightTime: 0.3, warm: 0.7 },
  invalid: { flightTime: -1 },
})) {
  check(`tracer:${name}`, 0x1234, 1, (fx) => spawnTracer(fx, point, normal, 600, options));
}
check('tracer:short', 0x1234, 1, (fx) => spawnTracer(fx, point, point, 0));
check('intel', 0xabcd, 1, (fx) => spawnIntelSparks(fx, point));
for (const radius of [0.1, 5, 12]) {
  check(`explosion:${radius}`, 0xabcd, 0.4, (fx) => explode(fx, { position: point, radius }));
}
check(
  'ambience',
  0x5eed,
  1,
  (fx) => {
    const ambience = new Ambience(fx, { motes: 4, shimmer: true });
    ambience.addColumn(1, 2, 3, { rate: 20, duration: 0.4, ember: 1, haze: 1 });
    for (const dt of [0.1, 0.15, 0.2, 0.1]) ambience.update(dt, 1, fx.ctx.camera);
  },
  true
);

// Generated on base 7bb0d35, before the runtime recipe consolidation.
const expected = {
  'impact:concrete:0.4': '5f7101d9bf4f9f1cd52728b2b73ad53a198b1cae65781a18c655f437db648ec6',
  'exit:concrete:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:concrete:1.25': 'aead4d574e528623ff67827b2c364b250d8e32ea63d68aa8db1ce3d2a95b5b81',
  'exit:concrete:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:plaster:0.4': 'e9a91dc1049ba6023d8b82704759b3da77dd379b9ce500aad907970852073aa2',
  'exit:plaster:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:plaster:1.25': '48357ca4a9deb0ec72371bb3e643d91804cb174382075d25340bb11f4828e091',
  'exit:plaster:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:metal:0.4': 'e300dffbe7fa53e0c0fb14017029958cde492d86c435f7270ec50278a084902b',
  'exit:metal:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:metal:1.25': 'de70067e49e327925ed74a3ea44e8dcbf1e5fa2721e2f93847fe95dc1b727a4d',
  'exit:metal:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:wood:0.4': '74062072a7568b49de0def45915c963fb1e62a51ed2b5f1d61931f6dce5b710e',
  'exit:wood:0.4': '171b17173d553b2f05f7e8bc81976efbd640c0a0b6dce4adf4a214a10d84d024',
  'impact:wood:1.25': '8aaa6796f01ff8a8251549ef31d7f1a6940e8ecce15222d117a7acc10f927691',
  'exit:wood:1.25': 'aaef04947f87bc21dd18f83978cb73023aaebb06bc84c64f54b294745ba13bbe',
  'impact:dirt:0.4': 'cca6331461ed7e32f9e9d5beee436832f7c6a2ff6be38cce856eb7137eb06eb3',
  'exit:dirt:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:dirt:1.25': 'c62125a997e8274aef40b2c452ed4476a98db5f2e9bb9515f5ad7a78f34608c4',
  'exit:dirt:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:sand:0.4': '2020bbb77770224ee9123e226f09aeac94568f8f965e7d9b73f25da05587cc2a',
  'exit:sand:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:sand:1.25': '36c6c14a13a906ce4c3a86ee1d60c9fee9bf38415c0d54683ba2638558a59915',
  'exit:sand:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:glass:0.4': '3ca9811b46c6907b70651ef4f2aa85e27e36c8c3838c82d8e153a4da1c703a10',
  'exit:glass:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:glass:1.25': '07ada391d54a8cb61188fc8e3050642ca8c891dbb77f67c481eede8272b7208f',
  'exit:glass:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:water:0.4': '7b2004ee79dd867ee41690672b0332bdc57e8b43320d1ec6d3e94fce7c85c845',
  'exit:water:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:water:1.25': 'a4576ccff787fada25d1d199e412941d250796475b5c8f4cce797e1887577542',
  'exit:water:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:flesh:0.4': 'b23d23ae9d7ccfb77aacf892588947e0740d2e75d5627311fa5f40919cf0d757',
  'exit:flesh:0.4': 'b23d23ae9d7ccfb77aacf892588947e0740d2e75d5627311fa5f40919cf0d757',
  'impact:flesh:1.25': '7ef9def8165d26151c49888392373b9626e670b1c52b62ee54e8f67c32016e8b',
  'exit:flesh:1.25': '7ef9def8165d26151c49888392373b9626e670b1c52b62ee54e8f67c32016e8b',
  'impact:foliage:0.4': 'ed8ddbb7315fe9f1e35d57167fd67615888bad516358f0793b80a8a58645f1d6',
  'exit:foliage:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:foliage:1.25': '7ef3bd05ec318cb96591354682ea0931233022d27bfd979364c33fc8eaf87717',
  'exit:foliage:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:fabric:0.4': 'b558c5046d7492096450cb160677dd04c35707bd344cc9ab72179f0bfbfa4c23',
  'exit:fabric:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:fabric:1.25': '1eab79fa05ed05b16def189eb6d3150a853ee45c46df63671f3a29b1e55333cb',
  'exit:fabric:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:rubber:0.4': '8a66f231a8a6ef08d22eb45568189f528c4bedae75a9d36b8352969588ee0de7',
  'exit:rubber:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:rubber:1.25': '2aa5200803d87c1f3b80602d640d15db69db819cf94ca2288af2257bedcfd59a',
  'exit:rubber:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'impact:unknown:0.4': '5f7101d9bf4f9f1cd52728b2b73ad53a198b1cae65781a18c655f437db648ec6',
  'exit:unknown:0.4': '71a125011424d9ad6ffd4ab8c73965463b7c32c83d2958144da25951a5b4bde8',
  'impact:unknown:1.25': 'aead4d574e528623ff67827b2c364b250d8e32ea63d68aa8db1ce3d2a95b5b81',
  'exit:unknown:1.25': '2d648738956d15756aad20a5036403b5f9504b558ecce450c602f664d0f0036e',
  'muzzle:rifle:false': '2679beeadea419835c02c494ea008fb3d5b6ee6ba3b9de91fbfc7bebcdc8378b',
  'muzzle:rifle:true': '41f737cd7f8635d42742bd9d67cce9b574b77a48267c562c95e4e00560a6dab1',
  'muzzle:carbine:false': 'd622d0f54ea50afd5bcbf4dbfdcac60202320f926fdc364233adee408c144440',
  'muzzle:carbine:true': '0daceabad49ba55a1bb1e2f4c6780b54c3f548b7bdea5c9102b43570c7d04a22',
  'muzzle:smg:false': '62814775d83405576f57df2c76a3949bb08ed9425ad511a23b1f3120e1398de7',
  'muzzle:smg:true': 'e64b266c66d1c82fe15e3f31f36319e2fd759d522e80005e3879368e013c4deb',
  'muzzle:pistol:false': 'a825b1d203ed5e917f28548eecbe46832d7a1541337a09907089f1f075b800f4',
  'muzzle:pistol:true': '69648bf809743b866eac0709cacf777239d6d6689e1a6bdc6c5e57695d90daab',
  'muzzle:shotgun:false': '3e3cee7361c4023b84b52ad3a2217ee30f4b86e12c0640e37ab1416460dd3f52',
  'muzzle:shotgun:true': '641c67803499169eeaedd9892ae04360392659b88d382b19ed5206aea5efbfe4',
  'muzzle:sniper:false': '132107a38c9ad427dde2c7315301a7874342c0204644d7b7d19486738b7decad',
  'muzzle:sniper:true': '58c57f0152c12282dd30b452c0ee11786200f912eececaba5ac5e7e9fe742488',
  'muzzle:lmg:false': '42948fe0883c320b03e8a22a8a38645f12f16c9e90672e2435fa9db8325c85fe',
  'muzzle:lmg:true': '04cace25eb0cb32851e53d37f8d187f5e4e662233198172493958b7aeddf14bd',
  'muzzle:suppressed:false': 'c6cca6a969194c2226dfaf9d62d1c0e704b7f059a292b88637461132dc60e7d9',
  'muzzle:suppressed:true': '8daba4fec8014ec7927346966ba72c56daded91437375e08840c6e8860e9c5a5',
  'muzzle:unknown:false': '2679beeadea419835c02c494ea008fb3d5b6ee6ba3b9de91fbfc7bebcdc8378b',
  'muzzle:unknown:true': '41f737cd7f8635d42742bd9d67cce9b574b77a48267c562c95e4e00560a6dab1',
  'tracer:default': 'dbedb7e9cea801c1d53c23ba10988fdd22f19795f4e826cdda919457090d2d35',
  'tracer:staged': '6dd06caa5837e69793151c518f7724ddafaa01e85e3ff06b92f84205aa3de4cc',
  'tracer:invalid': 'dbedb7e9cea801c1d53c23ba10988fdd22f19795f4e826cdda919457090d2d35',
  'tracer:short': 'ddbdd6b5aa4de7cbcb7ef9b8d97acb40cfee52bdafce524b239b7ae01ab95763',
  intel: '5d4ba72c21e51c652bad95a83ac18fe8875bfe2fc4c9d15dc64ab818452a4677',
  'explosion:0.1': '82a7437ff445a59aa00365d00c1a3c47fa33de1fe49ab6ade4ccd80d320c240c',
  'explosion:5': '6102608faab979b66948c259d13f28ab80d89b39e7a9d8d7410e3a5eeeea53ec',
  'explosion:12': 'fcc94e5e60d62751ab8a61bfebc16f2e879dff232e5eb8439acec1376fe176ef',
  ambience: '58b5e2ea67b29b7c3ebb13fb9423e858ea0b43136b7714b09ec2fdf9605ecb15',
};
assert.deepEqual(results, expected, 'full ordered payloads and RNG state retain base recipes');

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
