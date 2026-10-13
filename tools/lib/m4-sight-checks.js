import * as THREE from 'three';

/** Check the shipped GLB in Node smoke tests and in the actual browser scene. */
export function checkM4Sights(root) {
  const epsilon = .000002;
  const require = (condition, message) => { if (!condition) throw new Error(`[m4 sights] ${message}`); };
  const near = (actual, expected) => require(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const mesh = name => {
    const part = root.getObjectByName(name);
    require(part?.isMesh, `missing ${name}`);
    return part;
  };
  const bounds = part => {
    part.geometry.computeBoundingBox();
    return part.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, part.matrixWorld));
  };
  const point = name => root.getObjectByName(name).getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
  const topCenter = box => new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  const post = mesh('Front_sight_post'), tip = mesh('Front_sight_tip');
  const support = mesh('MaTech_aperture_stalk'), cup = mesh('MaTech_open_aperture');
  const front = point('SOCKET_front_post'), sight = point('SOCKET_sight');
  const postBounds = bounds(post), tipBounds = bounds(tip);
  const postSize = postBounds.getSize(new THREE.Vector3()), tipSize = tipBounds.getSize(new THREE.Vector3());
  near(postSize.x, .0026); near(postSize.y, .006858); near(postSize.z, .0026);
  require(topCenter(postBounds).distanceTo(front) < epsilon, 'front post moved off its aiming datum');
  near(tipSize.x, .00262); near(tipSize.y, .001401); near(tipSize.z, .00262);
  require(topCenter(tipBounds).distanceTo(front) < epsilon, 'paint tip moved off its aiming datum');
  require(tipBounds.max.y - postBounds.max.y > .0000005, 'paint cap must clear the original metal cap');
  require(tip.material.color.getHex() === 0x39ff14 && tip.material.emissive.getHex() === 0x39ff14, 'neon-green paint colour changed');
  near(tip.material.emissiveIntensity, 2); near(tip.material.metalness, 0); near(tip.material.roughness, .8);
  const supportBounds = bounds(support);
  near(supportBounds.min.y, .119); near(supportBounds.max.y, sight.y - .0028 - .0001);
  for (const part of [post, tip, support, cup]) {
    require(!part.material.transparent && part.material.opacity === 1 && part.material.alphaTest === 0,
      `${part.name} must be opaque, not a transparency/masking workaround`);
  }

  const toRoot = new THREE.Matrix4().multiplyMatrices(inverse, cup.matrixWorld);
  const positions = cup.geometry.getAttribute('position'), vertex = new THREE.Vector3();
  let inner = Infinity, outer = 0;
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(toRoot);
    const radius = Math.hypot(vertex.x - sight.x, vertex.y - sight.y);
    inner = Math.min(inner, radius); outer = Math.max(outer, radius);
  }
  near(inner * 2, .0056); near(outer * 2, .0076);
  const ray = new THREE.Raycaster();
  const forward = new THREE.Vector3(0, 0, -1).transformDirection(root.matrixWorld);
  function blocked(x, y) {
    ray.set(sight.clone().add(new THREE.Vector3(x, y, .025)).applyMatrix4(root.matrixWorld), forward);
    ray.far = .05;
    return ray.intersectObject(root, true).length > 0;
  }
  require(!blocked(inner * .98, 0) && blocked(inner * 1.02, 0), 'rear throat/rim boundary changed');
  let apertureSamples = 0, apertureObstructed = 0;
  for (let x = -7; x <= 7; x++) for (let y = -7; y <= 7; y++) {
    if (Math.hypot(x / 8, y / 8) > .9) continue;
    apertureSamples++;
    if (blocked(inner * x / 8, inner * y / 8)) apertureObstructed++;
  }
  require(apertureObstructed === 0, `${apertureObstructed}/${apertureSamples} obstructed aperture samples`);

  // Require shared solid volume, not only overlapping bounding boxes.
  const probeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const supportProbe = new THREE.Mesh(support.geometry, probeMat), cupProbe = new THREE.Mesh(cup.geometry, probeMat);
  supportProbe.matrixWorld.copy(support.matrixWorld); cupProbe.matrixWorld.copy(cup.matrixWorld);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(root.matrixWorld);
  function boundaries(probe) {
    const distances = ray.intersectObject(probe, false).map(hit => hit.distance);
    const unique = distances.filter((d, i) => !i || d - distances[i - 1] > epsilon);
    require(unique.length % 2 === 0, 'open/ambiguous junction geometry');
    return unique;
  }
  let supportContactDepth = 0, supportContactSamples = 0;
  try {
    for (const x of [-.0008, 0, .0008]) for (const z of [-.0014, -.0009, -.0004, .0001, .0006, .0011]) {
      ray.set(new THREE.Vector3(sight.x + x, .11, sight.z + z).applyMatrix4(root.matrixWorld), up);
      ray.far = .04;
      const stalk = boundaries(supportProbe), ring = boundaries(cupProbe);
      let depth = 0;
      for (let s = 0; s < stalk.length; s += 2) for (let c = 0; c < ring.length; c += 2) {
        depth = Math.max(depth, Math.min(stalk[s + 1], ring[c + 1]) - Math.max(stalk[s], ring[c]));
      }
      if (depth > epsilon) supportContactSamples++;
      supportContactDepth = Math.max(supportContactDepth, depth);
    }
    require(supportContactSamples >= 3 && supportContactDepth >= .00025, 'rear ring is not securely anchored');
  } finally {
    probeMat.dispose();
  }
  return { postSize: postSize.toArray(), postTop: topCenter(postBounds).toArray(), tipSize: tipSize.toArray(),
    apertureDiameter: inner * 2, apertureOuterDiameter: outer * 2,
    apertureSamples, apertureObstructed, supportContactDepth, supportContactSamples };
}
