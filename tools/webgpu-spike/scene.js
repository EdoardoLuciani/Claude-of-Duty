/**
 * SPIKE — the scene the prepass is measured and diffed on.
 *
 * Built twice, once per three namespace (`three` for the GLSL arm, `three/webgpu`
 * for the TSL arm) because the two builds hold separate class identities and
 * objects cannot be shared between them. Everything that decides geometry,
 * transform or animation phase is derived from a fixed-seed LCG and the frame
 * index, so the two builds are the same scene to the float, and a pixel diff
 * between them measures the PREPASS, not the scene.
 *
 * Content is chosen to hit every branch the production prepass special-cases:
 *   static opaque geometry   - the ordinary path
 *   InstancedMesh            - `#ifdef USE_INSTANCING`
 *   skinned + morphed        - `#ifdef USE_SKINNING`, and the coverage flag
 *   a moving rigid rig       - per-object velocity, the reason `velocity` exists
 *   a double-sided wall      - `if ( !gl_FrontFacing ) n = -n;`
 */

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A 4-bone chain driven from the frame index. Same maths in both builds.
 */
function buildSoldier(T, frame, phase) {
  const geometry = new T.BoxGeometry(0.5, 1.8, 0.4, 1, 6, 1);
  const pos = geometry.attributes.position;
  const n = pos.count;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);

  for (let i = 0; i < n; i++) {
    const y = pos.getY(i) + 0.9; // 0..1.8
    const t = Math.min(3, Math.max(0, Math.floor(y / 0.45)));
    const f = y / 0.45 - t;
    skinIndex[i * 4] = t;
    skinIndex[i * 4 + 1] = Math.min(3, t + 1);
    skinWeight[i * 4] = 1 - f;
    skinWeight[i * 4 + 1] = f;
  }
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(skinWeight, 4));

  const bones = [];
  for (let i = 0; i < 4; i++) {
    const bone = new T.Bone();
    bone.position.y = i === 0 ? 0 : 0.45;
    if (i > 0) bones[i - 1].add(bone);
    bones.push(bone);
  }
  const skeleton = new T.Skeleton(bones);

  const material = new T.MeshStandardMaterial({ color: 0x8a8f7a, roughness: 0.7, metalness: 0 });
  const mesh = new T.SkinnedMesh(geometry, material);
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.position.set(-3.5 + phase * 1.4, 0, -2 + (phase % 2) * 3.2);
  mesh.userData.owMatId = 0.35;

  // Deterministic deform: enough to move vertices independently of the transform,
  // which is exactly the case a matrix-difference velocity cannot describe.
  const spin = Math.sin(frame * 0.11 + phase) * 0.55;
  bones[1].rotation.z = spin * 0.5;
  bones[2].rotation.z = -spin;
  bones[3].rotation.y = spin * 0.8;
  skeleton.update();

  return mesh;
}

export function buildScene(T, opts = {}) {
  const staticCount = opts.staticCount ?? 260;
  const instancedGroups = opts.instancedGroups ?? 3;
  const instancesPerGroup = opts.instancesPerGroup ?? 120;

  const scene = new T.Scene();

  const camera = new T.PerspectiveCamera(72, 16 / 9, 0.05, 400);
  camera.position.set(0, 2.4, 9);
  camera.lookAt(0, 1.6, -6);

  const mat = new T.MeshStandardMaterial({ color: 0x7c7f86, roughness: 0.85, metalness: 0.05 });
  const matGloss = new T.MeshStandardMaterial({ color: 0x4a5a68, roughness: 0.25, metalness: 0.8 });
  const matDouble = new T.MeshStandardMaterial({
    color: 0x9a8f6a,
    roughness: 0.6,
    metalness: 0,
    side: T.DoubleSide,
  });

  const box = new T.BoxGeometry(1, 1, 1);
  const ground = new T.Mesh(new T.PlaneGeometry(160, 160), matGloss);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // --- static building-like blocks -----------------------------------------
  const rnd = lcg(12345);
  const staticGroup = new T.Group();
  for (let i = 0; i < staticCount; i++) {
    const gx = (i % 20) - 10;
    const gz = Math.floor(i / 20) - 6;
    if (Math.abs(gx) < 3 && gz > -3) continue; // keep a street to look down
    const h = 2 + rnd() * 9;
    const m = new T.Mesh(box, i % 7 === 0 ? matGloss : mat);
    m.position.set(gx * 3.5, h / 2, gz * 3.5);
    m.scale.set(2.6, h, 2.6);
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    m.userData.owMatId = (i % 4) * 0.2;
    staticGroup.add(m);
  }
  scene.add(staticGroup);

  // --- instanced props ------------------------------------------------------
  const instanced = [];
  for (let g = 0; g < instancedGroups; g++) {
    const im = new T.InstancedMesh(box, g % 2 === 0 ? mat : matGloss, instancesPerGroup);
    const m4 = new T.Matrix4();
    const q = new T.Quaternion();
    const s = new T.Vector3();
    const p = new T.Vector3();
    for (let i = 0; i < instancesPerGroup; i++) {
      const r = lcg(900 + g * 1000 + i);
      p.set((r() - 0.5) * 30, 0.25 + r() * 1.5, (r() - 0.5) * 30);
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * Math.PI * 2);
      s.set(0.3 + r() * 0.5, 0.3 + r() * 1.4, 0.3 + r() * 0.5);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
    im.userData.owMatId = 0.5;
    scene.add(im);
    instanced.push(im);
  }

  // --- double-sided wall (back-face normal flip) ----------------------------
  const wall = new T.Mesh(new T.PlaneGeometry(8, 4), matDouble);
  wall.position.set(0, 2, -12);
  wall.rotation.y = Math.PI;
  scene.add(wall);

  // --- moving rigid rig (per-object velocity) -------------------------------
  const rig = new T.Group();
  const rigParts = [];
  for (let i = 0; i < 12; i++) {
    const m = new T.Mesh(box, i % 3 === 0 ? matGloss : mat);
    m.scale.setScalar(0.4 + i * 0.05);
    m.position.set((i % 4) * 0.9 - 1.4, 1 + Math.floor(i / 4) * 0.9, 0);
    m.userData.owMatId = 0.75;
    rig.add(m);
    rigParts.push(m);
  }
  rig.position.set(0, 0, 2.5);
  scene.add(rig);

  // --- skinned soldiers ----------------------------------------------------
  const soldiers = [];
  for (let i = 0; i < 6; i++) {
    const s = buildSoldier(T, 0, i);
    scene.add(s);
    soldiers.push(s);
  }

  const sphere = new T.SphereGeometry(1, 24, 16);

  return {
    scene,
    camera,
    /** Deterministic scene state for a frame index. Identical in both builds. */
    step(frame) {
      const freezeObjects = opts.freezeObjects === true;
      const freezeCamera = opts.freezeCamera === true;
      const t = frame * 0.05;
      const tf = freezeObjects ? 0 : t;
      const tc = freezeCamera ? 0 : t;
      camera.position.set(Math.sin(tc * 0.7) * 2.2, 2.4 + Math.sin(tc * 0.5) * 0.2, 9);
      camera.lookAt(Math.sin(tc * 0.3) * 1.5, 1.6, -6);
      camera.updateMatrixWorld(true);

      rig.position.set(Math.sin(tf) * 2.5, 0, 2.5 + Math.cos(tf * 0.6));
      rig.rotation.y = tf * 0.8;
      rig.updateMatrixWorld(true);

      for (let i = 0; i < soldiers.length; i++) {
        const s = soldiers[i];
        // A fresh skeleton pose per frame: vertex-level deform, transform static.
        const bones = s.skeleton.bones;
        const spin = Math.sin((freezeObjects ? 0 : frame) * 0.11 + i) * 0.55;
        bones[1].rotation.z = spin * 0.5;
        bones[2].rotation.z = -spin;
        bones[3].rotation.y = spin * 0.8;
        s.skeleton.update();
        s.updateMatrixWorld(true);
      }

      for (let g = 0; g < instanced.length; g++) {
        instanced[g].rotation.y = Math.sin(tf * 0.4 + g) * 0.1;
        instanced[g].updateMatrixWorld(true);
      }
    },
    /** Objects the production frame walk would record for the velocity buffer. */
    dynamic: [rig, ...instanced, ...soldiers],
    stats: {
      staticCount,
      instancedGroups,
      instancesPerGroup,
      soldiers: soldiers.length,
      triangles: staticCount * 12 + instancedGroups * instancesPerGroup * 12 + 6 * 6 * 12,
    },
    sphere,
  };
}
