import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PNG } from 'pngjs';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { Rng } from '../../src/core/rng.ts';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../../src/weapons/defs.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { makeM4Model } from '../../src/weapons/m4.ts';
import { Viewmodel } from '../../src/weapons/viewmodel.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';
import { checkM4Sights, createM4SurfaceProbe } from '../../tools/lib/m4-sight-checks.js';

const dir = new URL('../../assets/weapons/m4a1-block-ii/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
const hands = JSON.parse(readFileSync(new URL('hand-reference.json', dir)));
const blend = readFileSync(new URL('m4a1-block-ii.blend', dir));
assert(
  blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528,
  'editable packed Blender source'
);
const bytes = readFileSync(new URL('m4a1-block-ii.glb', dir));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const primitives = json.nodes
  .filter((n) => n.mesh !== undefined)
  .flatMap((n) => json.meshes[n.mesh].primitives);
const triangles = primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
assert.equal(
  triangles,
  manifest.stats.triangles,
  'count both spare/primary instances, not just unique buffers'
);
assert.equal(primitives.length, manifest.stats.primitives);
assert(
  triangles <= 91000 &&
    primitives.length === 6 &&
    json.materials.length === 1 &&
    bytes.length <= 13000000
);
assert.equal(json.images.length, 4, 'unchanged full-resolution source maps, no finish atlas');
const imageFor = (texture) => json.textures[texture.index].source;
const unified = json.materials[0];
assert.equal(unified.name, 'M4 | unified opaque finishes');
assert.equal(unified.alphaMode ?? 'OPAQUE', 'OPAQUE');
assert.notEqual(
  imageFor(unified.pbrMetallicRoughness.baseColorTexture),
  imageFor(unified.emissiveTexture),
  'receiver-only source albedo is carried independently, selected by the local graph'
);
assert(
  json.buffers.every((b) => !b.uri) && json.images.every((i) => i.bufferView !== undefined),
  'local self-contained GLB'
);
assert.equal(json.skins.length, 1, 'weapon mechanical skin only, no duplicate arms');
assert.equal(json.skins[0].joints.length, 13);
const binaryStart = 28 + bytes.readUInt32LE(12);
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView];
  const offset = binaryStart + (view.byteOffset ?? 0);
  assert.equal(bytes.readUInt32BE(offset + 16), 1024);
  assert.equal(bytes.readUInt32BE(offset + 20), 1024);
}
assert.equal(json.animations.length, 8);
const albedoStats = (name) => {
  const image = json.images.find((image) => image.name === name);
  const view = json.bufferViews[image.bufferView];
  const start = binaryStart + (view.byteOffset ?? 0);
  const pixels = PNG.sync.read(bytes.subarray(start, start + view.byteLength)).data;
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += pixels[i];
    squares += pixels[i] ** 2;
  }
  const mean = sum / (pixels.length / 4);
  return { mean, sd: Math.sqrt(squares / (pixels.length / 4) - mean ** 2) };
};
const receiverAlbedo = albedoStats('m4_receiver_surface');
const sharedAlbedo = albedoStats('m4_surface');
assert(
  Math.abs(receiverAlbedo.mean - sharedAlbedo.mean) < 1,
  'preserve mean albedo within PNG quantization'
);
assert(
  Math.abs(receiverAlbedo.sd / sharedAlbedo.sd - 0.25) < 0.02,
  'selected 25% receiver albedo variation'
);
for (const clip of json.animations) {
  const names = clip.channels.map((c) => json.nodes[c.target.node].name);
  for (const name of [
    'M4_RIG',
    'bolt',
    'bolt_head',
    'charging_handle',
    'hand_L',
    'hand_R',
    'L_thumb_base',
    'R_finger_0_0',
  ])
    assert(names.includes(name), `${clip.name}: authored ${name}`);
  const end = Math.max(...clip.samplers.map((s) => json.accessors[s.input].max[0]));
  assert(
    Math.abs(end - manifest.clips[clip.name].duration) < 1e-6,
    `${clip.name}: exact duration, including fractional draw endpoint`
  );
  for (const channel of clip.channels)
    if (channel.target.path === 'scale')
      assert.equal(clip.samplers[channel.sampler].interpolation, 'STEP');
}
async function checkModel(bytes, format) {
  const model = makeM4Model(await parseGLB(bytes));
  let maxMagazineDrift = 0,
    maxChargingWristDrift = 0,
    maxLatchDrift = 0;
  assert.equal(model.id, 'rifle');
  assert.equal(model.label, 'M4A1');
  assert.equal(model.nodes.opticGlass, undefined);
  assert(
    !json.nodes.some((n) => /optic|red.dot|reticle|glass/i.test(n.name)),
    'bare iron-only rifle'
  );
  const close = (a, b, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
  const point = (name) => model.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  close(point('SOCKET_barrel_crown').distanceTo(point('SOCKET_bolt_face')), 0.3683);
  close(model.nodes.sight[1], 0.1395);
  close(model.nodes.muzzle[2], -0.52634);
  const front = point('SOCKET_front_post');
  close(front.x, model.nodes.sight[0]);
  close(front.y, model.nodes.sight[1]);
  const sights = checkM4Sights(model.root);
  assert.equal(sights.apertureSamples, 161);
  assert.equal(sights.apertureObstructed, 0);
  // Reject bad rendered transforms/width and a coincident cap, not just bad sockets.
  for (const [name, move, error] of [
    [
      'Front_sight_post',
      (part) => {
        part.position.x += 0.001;
      },
      /front post moved/,
    ],
    [
      'Front_sight_post',
      (part) => {
        part.scale.x *= 1.1;
      },
      /!= 0\.0026$/,
    ],
    [
      'Front_sight_tip',
      (part) => {
        part.position.y -= 0.000001;
      },
      /paint cap must clear/,
    ],
  ]) {
    const faulty = clone(model.root);
    move(faulty.getObjectByName(name));
    assert.throws(() => checkM4Sights(faulty), error);
  }
  function firstHit(name, origin, direction) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(...origin),
      new THREE.Vector3(...direction),
      0,
      1
    );
    const node = model.root.getObjectByName(name);
    const probe = node.isBone ? createM4SurfaceProbe(model.root, name) : null;
    try {
      const hits = ray.intersectObject(probe ?? node, true);
      assert(hits.length, `${name}: expected rendered indexed surface`);
      return hits[0].point;
    } finally {
      probe?.geometry.dispose();
    }
  }
  close(firstHit('bolt_head', [0.002, 0.075, -0.108], [0, 0, 1]).z, -0.105, 0.00001);
  close(firstHit('receiver_mesh', [0.004, 0.075, -0.4738], [0, 0, 1]).z, -0.4733, 0.00001);
  // Open rear cup: first rendered surface is the front post/paint, not its
  // axis/socket. Allow 30 µm for the polygon chord and 10 µm paint clearance.
  close(firstHit('M4_RIG', [0, 0.1394, 0.06], [0, 0, -1]).z, -0.3027, 0.00003);
  // Fixed assemblies now share one indexed receiver mesh, with one primitive per
  // compatible finish. Inspect actual rendered vertices, not empty helper bounds.
  function fixedBounds(include) {
    const bounds = new THREE.Box3();
    const vertex = new THREE.Vector3();
    const inverse = model.root.matrixWorld.clone().invert();
    model.root.getObjectByName('receiver_mesh').traverse((mesh) => {
      if (!mesh.isMesh) return;
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        mesh.getVertexPosition(i, vertex).applyMatrix4(transform);
        const colors = mesh.geometry.attributes.color;
        const color = colors ? [colors.getX(i), colors.getY(i), colors.getZ(i)] : null;
        if (include(vertex, mesh.material.name, color)) bounds.expandByPoint(vertex);
      }
    });
    assert(!bounds.isEmpty(), 'fixed assembly has real indexed geometry');
    return bounds;
  }
  for (const helper of ['handguard', 'stock'])
    assert(model.root.getObjectByName(helper), `${helper}: retain named authoring seat`);
  const guard = fixedBounds(
    (_vertex, _material, color) =>
      color && color.every((value, axis) => Math.abs(value - [0.235, 0.15, 0.084][axis]) < 0.00002)
  );
  close(guard.max.z - guard.min.z, 0.31115, 0.001);
  close(guard.max.x - guard.min.x, 0.056642, 0.001);
  close(guard.max.y - guard.min.y, 0.05715, 0.001);
  // True side-view regressions: old cutter left receiver walls across the hole,
  // the SOPMOD pad was raked, and the magazine hung too far below the well.
  const receiver = model.root.getObjectByName('receiver_mesh');
  // Original 2.2 mm aperture: clear at 1.05 mm in all four directions, with
  // real steel at 1.15 mm. Include the support, not only the ring's own mesh.
  const apertureRay = new THREE.Raycaster(
    new THREE.Vector3(),
    new THREE.Vector3(0, 0, -1),
    0,
    0.045
  );
  for (const [x, y] of [
    [0.00105, 0.1395],
    [-0.00105, 0.1395],
    [0, 0.14055],
    [0, 0.13845],
  ]) {
    apertureRay.ray.origin.set(x, y, 0.059);
    assert.equal(
      apertureRay.intersectObject(model.root, true).length,
      0,
      'rear aperture is clear, including its lower third'
    );
  }
  apertureRay.ray.origin.set(0.00115, 0.1395, 0.059);
  assert(
    apertureRay.intersectObject(model.root, true).length,
    'rear aperture retains its steel rim'
  );
  const sideRay = new THREE.Raycaster(
    new THREE.Vector3(-0.05, 0.018, -0.022),
    new THREE.Vector3(1, 0, 0),
    0,
    0.1
  );
  assert.equal(
    sideRay.intersectObject(receiver, true).length,
    0,
    'trigger opening must pass through the receiver sides'
  );
  sideRay.ray.origin.set(-0.05, 0.005, -0.022);
  assert(
    sideRay.intersectObject(receiver, true).length,
    'indexed GI guard strip below the visible opening'
  );
  // Probe halfway between the 4.5 mm traction ribs, not their raised crowns.
  const padZ = [-0.02325, 0.00375, 0.03075, 0.05775, 0.07575].map(
    (y) => firstHit('receiver_mesh', [0, y, 0.35], [0, 0, -1]).z
  );
  assert(
    Math.max(...padZ) - Math.min(...padZ) < 0.0001,
    'SOPMOD pad square to buffer axis in exported triangles'
  );
  const magazineBounds = new THREE.Box3().setFromObject(
    model.root.getObjectByName('magazine_mesh')
  );
  const magazineHeight = magazineBounds.max.y - magazineBounds.min.y;
  assert(
    magazineHeight > 0.157 && magazineHeight < 0.163,
    'side-reference magazine body envelope; not the old 186 mm shell'
  );

  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.004, 60);
  const messages = [];
  const ctx = {
    scene: new THREE.Scene(),
    viewScene: new THREE.Scene(),
    camera,
    viewCamera: camera,
    rng: new Rng(0x4a1),
    time: { elapsed: 0, scale: 1 },
    peek: () => null,
    events: { emit: (name, data) => messages.push({ name, ...data }) },
  };
  const vm = new Viewmodel(ctx, {
    get: () => new THREE.MeshStandardMaterial(),
    reticle: () => new THREE.MeshBasicMaterial(),
    reticleOutline: () => new THREE.MeshBasicMaterial(),
  });
  const entry = vm.addWeapon(model, { ...WEAPON_DEFS.rifle, cycleTime: 60 / 800 });
  const anim = entry.animation;
  assert.equal(
    entry.parts.magazine,
    anim.magazineBody,
    'existing physical magazine-drop interface retained'
  );
  // Fixed gameplay contract, independent of the asset manifest or animation builder.
  const actionContract = [
    [
      'reloadTac',
      2.1,
      [
        [0.02, 'start'],
        [0.2, 'magout'],
        [0.34, 'magdrop'],
        [0.81, 'magin'],
        [0.88, 'slap'],
        [0.995, 'end'],
      ],
    ],
    [
      'reloadEmpty',
      2.9,
      [
        [0.02, 'start'],
        [0.16, 'magout'],
        [0.3, 'magdrop'],
        [0.71, 'magin'],
        [0.9, 'charge'],
        [0.917, 'boltrelease'],
        [0.995, 'end'],
      ],
    ],
    ['inspect', 3.2, [[0.995, 'end']]],
    ['draw', 0.62, [[0.995, 'end']]],
    ['holster', 0.4, [[0.995, 'end']]],
  ];
  for (const [name, duration, beats] of actionContract) {
    assert.equal(entry.clips[name].duration, duration);
    assert.deepEqual(
      entry.clips[name].events,
      beats.map(([fraction, event]) => ({ t: fraction * duration, name: event })),
      `${name}: original gameplay milestones`
    );
  }
  anim._sample('Last_Shot', 0.075);
  close(anim.bolt.position.z - anim.boltRest.z, 0.062);
  assert(
    anim.boltHead.quaternion.angleTo(new THREE.Quaternion()) > 0.38,
    'authored unlocked bolt-head endpoint'
  );
  anim.reset();
  for (const [name, out, drop, insert] of [
    ['Reload_Tactical', 0.2, 0.34, 0.81],
    ['Reload_Empty', 0.16, 0.3, 0.71],
  ]) {
    const d = manifest.clips[name].duration;
    for (let frame = 0; frame <= d * 240; frame++) {
      const t = frame / 240;
      anim._sample(name, t);
      anim.root.updateMatrixWorld(true);
      assert(
        [anim.magazine.scale.x, anim.spare.scale.x].every(
          (s) => Math.min(Math.abs(s), Math.abs(s - 1)) < 1e-5
        ),
        'no shrinking magazines between keys'
      );
      if (anim.spare.visible) {
        let meshes = 0;
        anim.spare.traverse((o) => {
          if (!o.isMesh) return;
          meshes++;
          close(Math.abs(o.matrixWorld.determinant()), 1, 0.00001);
          assert(
            o.scale.toArray().every((s) => Math.abs(s - 1) < 0.00001),
            `${name}/${t.toFixed(4)}: ${o.name} permanently collapsed under visible spare`
          );
        });
        assert.equal(meshes, 2, 'independent indexed spare body/follower and loaded cartridges');
        const bounds = new THREE.Box3().setFromObject(anim.spare);
        assert(
          bounds.max.y - bounds.min.y > 0.14,
          `${name}: visible spare has a real magazine envelope`
        );
      }
      const held =
        t >= (out - 0.035) * d && t <= (drop - 0.025) * d
          ? anim.magazine
          : t >= (drop + 0.05) * d && t <= (insert + 0.025) * d
            ? anim.spare
            : null;
      if (held) {
        anim.root.updateMatrixWorld(true);
        const target = held.localToWorld(new THREE.Vector3().fromArray(hands.magazine.pos));
        const wrist = anim.hands.left.wrist.getWorldPosition(new THREE.Vector3());
        maxMagazineDrift = Math.max(maxMagazineDrift, wrist.distanceTo(target));
        assert(
          wrist.distanceTo(target) < 0.002,
          `${name}/${t.toFixed(4)}: wrist drifts off held magazine`
        );
      }
    }
  }
  anim.reset();
  // Verify the exported motion on the real runtime skins and IK too. A whole-stock
  // envelope is conservative: no deformed triangle may enter even its empty space.
  const stockEnvelope = fixedBounds(
    (vertex, material) => vertex.z >= 0.09 && material === 'M4 | unified opaque finishes'
  );
  const armBytes = readFileSync(new URL('../../public/models/player/arms.glb', import.meta.url));
  const armGltf = await parseGLB(armBytes);
  armGltf.scene.updateMatrixWorld(true);
  const armMeshes = [];
  armGltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) armMeshes.push(o);
  });
  assert.equal(armMeshes.length, 5);
  vm.armL.attachAsset({ meshes: armMeshes });
  const skins = vm.armL.skins.map((mesh) => ({
    mesh,
    vertices: Array.from(
      { length: mesh.geometry.attributes.position.count },
      () => new THREE.Vector3()
    ),
  }));
  const inverseRoot = new THREE.Matrix4(),
    triangle = new THREE.Triangle();
  const chargingHandle = anim.root.getObjectByName('charging_handle');
  vm.rig.position.fromArray(WEAPON_DEFS.rifle.hipPos);
  vm.rig.quaternion.setFromEuler(new THREE.Euler(...WEAPON_DEFS.rifle.hipRot));
  let skinPoses = 0;
  for (let frame = Math.floor(0.75 * 2.9 * 240); frame <= Math.ceil(2.9 * 240); frame++) {
    const t = Math.min(frame / 240, 2.9);
    anim._sample('Reload_Empty', t);
    vm._solveHands(entry, { active: false });
    vm.rig.updateMatrixWorld(true);
    inverseRoot.copy(anim.root.matrixWorld).invert();
    skinPoses++;
    for (const { mesh, vertices } of skins) {
      mesh.skeleton.update();
      for (let i = 0; i < vertices.length; i++)
        mesh
          .getVertexPosition(i, vertices[i])
          .applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(inverseRoot);
      const index = mesh.geometry.index;
      for (let i = 0; i < index.count; i += 3) {
        const a = vertices[index.getX(i)],
          b = vertices[index.getX(i + 1)],
          c = vertices[index.getX(i + 2)];
        if (
          Math.max(a.x, b.x, c.x) < stockEnvelope.min.x ||
          Math.min(a.x, b.x, c.x) > stockEnvelope.max.x ||
          Math.max(a.y, b.y, c.y) < stockEnvelope.min.y ||
          Math.min(a.y, b.y, c.y) > stockEnvelope.max.y ||
          Math.max(a.z, b.z, c.z) < stockEnvelope.min.z ||
          Math.min(a.z, b.z, c.z) > stockEnvelope.max.z
        )
          continue;
        triangle.set(a, b, c);
        assert(
          !stockEnvelope.intersectsTriangle(triangle),
          `Reload_Empty/${t.toFixed(4)}: ${mesh.name} deformed triangle enters stock envelope`
        );
      }
    }
    if (t >= 0.86 * 2.9 && t <= 0.9 * 2.9) {
      const wrist = anim.hands.left.wrist.position.clone().sub(chargingHandle.position);
      maxChargingWristDrift = Math.max(
        maxChargingWristDrift,
        wrist.distanceTo(new THREE.Vector3().fromArray(hands.charging.pos))
      );
      assert(
        wrist.distanceTo(new THREE.Vector3().fromArray(hands.charging.pos)) < 0.001,
        'charging hand follows actual handle stroke'
      );
      for (const [joint, pad, target] of [
        [vm.armL.fingers[0].joints[2], [0, -0.006, -0.013], [-0.027, 0.104, 0.062]],
        [vm.armL.thumb.joints[1], [0, 0, -0.026], [-0.035, 0.105, 0.079]],
      ]) {
        const contact = new THREE.Vector3(...pad)
          .multiplyScalar(vm.armL.scale)
          .applyMatrix4(joint.matrixWorld)
          .applyMatrix4(inverseRoot);
        const expected = new THREE.Vector3(...target).add(chargingHandle.position);
        maxLatchDrift = Math.max(maxLatchDrift, contact.distanceTo(expected));
        assert(
          contact.distanceTo(expected) < 0.003,
          `Reload_Empty/${t.toFixed(4)}: charging finger/thumb loses latch contact`
        );
      }
    }
  }
  assert.equal(skinPoses, 175);
  vm.rig.position.set(0, 0, 0);
  vm.rig.quaternion.identity();
  anim.reset();
  const wp = new WeaponSystem();
  wp.ctx = ctx;
  wp.rng = ctx.rng;
  wp.viewmodel = vm;
  wp.sim = { spawn() {}, clear() {} };
  wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
  for (const id of WEAPON_IDS) {
    const d = { ...WEAPON_DEFS[id], cycleTime: 60 / WEAPON_DEFS[id].rpm };
    wp.states.set(id, {
      def: d,
      pattern: buildRecoilPattern(d, Rng),
      mag: d.magSize,
      chambered: true,
      reserve: d.reserve,
      mode: d.modes[0],
      modeIndex: 0,
    });
  }
  vm.onClipEvent = (name, clip) => wp._onClipEvent(name, clip);
  function step(seconds) {
    for (let i = 0; i < Math.round(seconds * 120); i++) {
      ctx.time.elapsed += 1 / 120;
      wp._fireTimer = Math.max(0, wp._fireTimer - 1 / 120 - 1e-12);
      wp._state.empty = !wp.state.mag && !wp.state.chambered;
      wp._state.magazineLoaded = wp.state.mag > 0;
      wp.lateUpdate(1 / 120, ctx);
      assert(
        vm.armR.hand.position.toArray().every(Number.isFinite) &&
          vm.armL.hand.position.toArray().every(Number.isFinite)
      );
    }
  }
  wp.setWeaponImmediate('rifle');
  step(0.2);
  assert(!vm.reticle.visible && !vm.scopeOverlay.visible);
  assert(wp.tryFire());
  assert(vm.recPos.c.v > 0, 'keep original reactive recoil instead of authored-model early return');
  close(anim.root.position.length(), 0, 1e-6);
  step(0.1);
  for (let i = 0; i < 5; i++) {
    assert(wp.tryFire());
    step(0.1);
  }
  assert.equal(messages.filter((m) => m.name === 'weapon:fire').length, 6);
  assert.equal(messages.filter((m) => m.name === 'weapon:shell').length, 6);
  assert.equal(wp.state.mag, 24);
  assert(!anim.reviewCase.visible, 'no duplicate viewmodel casing alongside the physical shell');
  assert(wp.reload());
  step(1.6);
  assert.equal(wp.state.mag, 24);
  step(0.2);
  assert.equal(wp.state.mag, 30);
  assert.equal(wp.state.reserve, 204);
  step(0.5);
  assert(!wp.reloading && anim.magazine.visible && !anim.spare.visible);
  assert.equal(
    wp._magPools.get('rifle').length,
    2,
    'pooled physical discarded magazines survive migration'
  );
  for (const proxy of wp._magPools.get('rifle')) {
    assert(proxy.group.position.toArray().every(Number.isFinite));
    let parts = 0;
    proxy.group.traverse((o) => {
      if (o.isMesh) parts++;
    });
    assert.equal(
      parts,
      1,
      'one consolidated discarded shell/follower, independent of loaded cartridges'
    );
  }
  wp.state.mag = 0;
  wp.state.chambered = false;
  assert(wp.reload());
  step(1.9);
  assert(anim.bolt.position.z > 0.06);
  step(0.8);
  assert.equal(wp.state.mag, 29);
  assert(wp.state.chambered);
  close(anim.bolt.position.z, anim.boltRest.z);
  step(0.4);
  assert(!wp.reloading);
  wp.state.mag = 0;
  wp.state.chambered = true;
  assert(wp.tryFire());
  step(0.2);
  assert(anim.bolt.position.z > 0.06 && !anim.magazineRound.visible);
  assert(wp.inspect());
  step(0.4);
  assert(anim.bolt.position.z > 0.06, 'inspect retains empty lockback');
  vm.stopClip();
  assert(wp.reload());
  step(0.5);
  const reserve = wp.state.reserve;
  wp._onPlayerDeath();
  step(0.1);
  assert.equal(wp.state.reserve, reserve, 'interrupt before insertion grants no ammo');
  assert(!anim.spare.visible && anim.magazine.visible);
  vm.dispose();
  assert.equal(model.materials.size, 0);
  assert.equal(model.textures.size, 0);
  console.log(
    `M4 ${format}: eight Blender clips, exact milestones, visible spare meshes, ${skinPoses} runtime skin/stock sweeps, latch contacts, iron geometry, magazine drops, ammunition, recoil, shells, lockback and cleanup passed; max magazine/wrist/latch errors ${[maxMagazineDrift, maxChargingWristDrift, maxLatchDrift].map((v) => (v * 1000).toFixed(6)).join('/')} mm`
  );
}
await checkModel(bytes, 'native');
const runtime = readFileSync(new URL('m4a1-block-ii.runtime.glb', dir));
const runtimeJSON = JSON.parse(runtime.subarray(20, 20 + runtime.readUInt32LE(12)));
assert(runtime.length < 5500000, 'bounded runtime product');
assert(runtimeJSON.extensionsRequired.includes('EXT_meshopt_compression'));
assert(runtimeJSON.extensionsRequired.includes('KHR_texture_basisu'));
assert.equal(runtimeJSON.images.length, 4);
for (const image of runtimeJSON.images) assert.equal(image.mimeType, 'image/ktx2');
await checkModel(runtime, 'decoded runtime');
