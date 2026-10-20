import {
  wgslFn,
  uniform,
  texture,
  varying,
  modelNormalMatrix,
  normalLocal,
  positionWorld,
  renderGroup,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';

import { lightingCode, shadowCode } from './shaders.js';
export async function createThree(canvas, data, { shadowSize = 1024 } = {}) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw Error('WebGPU required');
  const device = renderer.backend.device;
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.sortObjects = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const skyColor = new THREE.Color(0.38, 0.5, 0.65);
  renderer.info.autoReset = false;
  renderer.setClearColor(skyColor, 1);
  const meta = data.meta,
    scenes = [new THREE.Scene(), new THREE.Scene()];
  const cameras = [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()];
  for (const c of cameras) {
    c.coordinateSystem = THREE.WebGPUCoordinateSystem;
    c.matrixAutoUpdate = false;
  }
  const shadowCameras = data.shadows.map((s) => {
    const c = new THREE.OrthographicCamera();
    c.coordinateSystem = THREE.WebGPUCoordinateSystem;
    c.matrixAutoUpdate = false;
    c.matrix.fromArray(s.world);
    c.matrixWorldNeedsUpdate = true;
    c.projectionMatrix.fromArray(s.projection);
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    c.layers.set(1);
    return c;
  });
  const targets = data.shadows.map(
    () =>
      new THREE.RenderTarget(shadowSize, shadowSize, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthTexture: new THREE.DepthTexture(shadowSize, shadowSize, THREE.FloatType),
      })
  );
  for (const t of targets) {
    t.texture.colorSpace = THREE.LinearSRGBColorSpace;
    t.depthTexture.format = THREE.DepthFormat;
  }
  const shadowFn = wgslFn(shadowCode),
    litFn = wgslFn(lightingCode, [shadowFn]);
  const sm = data.shadows.map((s) =>
    uniform(new THREE.Matrix4().fromArray(s.vp)).setGroup(renderGroup)
  );
  const light = uniform(new THREE.Vector4().fromArray(data.light)).setGroup(renderGroup);
  const materials = meta.materials.map((m) => {
    const material = new THREE.MeshBasicNodeMaterial({ side: m.side, toneMapped: false });
    material.fragmentNode = litFn({
      p: positionWorld,
      n: varying(modelNormalMatrix.mul(normalLocal)),
      tint: uniform(new THREE.Color(...m.color)),
      light,
      sm0: sm[0],
      sm1: sm[1],
      sm2: sm[2],
      map0: texture(targets[0].depthTexture).setSampler(false),
      map1: texture(targets[1].depthTexture).setSampler(false),
      map2: texture(targets[2].depthTexture).setSampler(false),
    });
    return material;
  });
  const depthMaterials = [0, 1, 2].map((side) => {
    const m = new THREE.MeshBasicNodeMaterial({ side, toneMapped: false });
    m.fragmentNode = vec4(0, 0, 0, 1);
    return m;
  });
  const geometries = data.geometry.map((g) => {
    const geo = new THREE.BufferGeometry(),
      a = new THREE.InterleavedBuffer(
        new Float32Array(g.vertices.buffer, g.vertices.byteOffset, g.vertices.byteLength / 4),
        14
      ),
      u = new THREE.InterleavedBuffer(
        new Uint32Array(g.vertices.buffer, g.vertices.byteOffset, g.vertices.byteLength / 4),
        14
      );
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(a, 3, 0));
    geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(a, 3, 3));
    geo.setAttribute('skinIndex', new THREE.InterleavedBufferAttribute(u, 4, 6));
    geo.setAttribute('skinWeight', new THREE.InterleavedBufferAttribute(a, 4, 10));
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
    return geo;
  });
  const meshByNode = new Map(meta.meshes.map((m, i) => [m.node, i])),
    configured = new Map();
  const objects = meta.nodes.map((n, id) => {
    let object;
    if (id === data.roots[0]) object = scenes[0];
    else if (id === data.roots[1]) object = scenes[1];
    else if (meshByNode.has(id)) {
      const m = meta.meshes[meshByNode.get(id)],
        key = m.geometry + ':' + m.ranges.map((r) => r.start + ',' + r.count).join(';');
      let geometry = configured.get(key);
      if (!geometry) {
        geometry = geometries[m.geometry].clone();
        configured.set(key, geometry);
        geometry.clearGroups();
        for (let i = 0; i < m.ranges.length; i++) {
          const r = m.ranges[i];
          geometry.addGroup(r.start, r.count, i);
        }
      }
      const mats = m.ranges.map((r) => materials[r.material]);
      object = m.skinned
        ? new THREE.SkinnedMesh(geometry, mats)
        : m.instances
          ? new THREE.InstancedMesh(geometry, mats, m.count)
          : new THREE.Mesh(geometry, mats);
      if (m.instances) {
        const matrices = data.instances[meshByNode.get(id)];
        // Preserve the game's existing public storage-instancing optimization.
        if (m.storageInstances)
          object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(matrices, 16);
        else object.instanceMatrix.array.set(matrices);
      }
      object.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(...m.sphere.slice(0, 3)),
        m.sphere[3]
      );
      object.frustumCulled = m.cull;
      object.castShadow = m.castShadow;
      if (m.castShadow) object.layers.enable(1);
    } else object = n.bone ? new THREE.Bone() : new THREE.Object3D();
    object.name = n.name;
    object.matrixAutoUpdate = n.parent < 0;
    object.matrix.fromArray(n.matrix);
    object.visible = n.visible;
    return object;
  });
  for (let i = 0; i < objects.length; i++)
    if (meta.nodes[i].parent >= 0) objects[meta.nodes[i].parent].add(objects[i]);
  const skeletons = meta.skeletons.map(
    (s) =>
      new THREE.Skeleton(
        s.bones.map((n) => objects[n]),
        s.inverses.map((a) => new THREE.Matrix4().fromArray(a))
      )
  );
  const renderMeshes = meta.meshes.map((m) => objects[m.node]);
  for (let i = 0; i < meta.meshes.length; i++) {
    const m = meta.meshes[i],
      o = renderMeshes[i];
    if (m.skinned) {
      o.bindMode = m.detached ? 'detached' : 'attached';
      o.bind(skeletons[m.skeleton], new THREE.Matrix4().fromArray(m.bind));
      o.bindMatrixInverse.fromArray(m.bindInverse);
    }
  }
  const beauty = renderMeshes.map((o) => o.material),
    depth = meta.meshes.map((m) =>
      m.ranges.map((r) => depthMaterials[meta.materials[r.material].side])
    );
  let builds = 0;
  renderer.debug.onNodeBuilderCreated = () => builds++;
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  const counts = [],
    triangles = [],
    stats = { draws: counts, triangles };
  return {
    device,
    errors,
    info: {
      vendor: device.adapterInfo?.vendor,
      architecture: device.adapterInfo?.architecture,
      fallback: device.adapterInfo?.isFallbackAdapter,
    },
    render(frameIndex) {
      const frame = frameIndex % meta.frameCount;
      for (let i = 0; i < meta.dynamic.length; i++) {
        const n = meta.dynamic[i],
          o = objects[n];
        o.matrix.fromArray(data.frames, (frame * meta.dynamic.length + i) * 16);
        o.matrixWorldNeedsUpdate = true;
        o.visible = !!data.visibility[frame * meta.dynamic.length + i];
      }
      for (let scene = 0; scene < 2; scene++) {
        const c = cameras[scene];
        c.matrix.fromArray(data.cameras, frame * 64 + scene * 32);
        c.matrixWorldNeedsUpdate = true;
        c.projectionMatrix.fromArray(data.cameras, frame * 64 + scene * 32 + 16);
        c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
      }
      renderer.info.reset();
      counts.length = triangles.length = 0;
      for (let i = 0; i < renderMeshes.length; i++) {
        renderMeshes[i].material = depth[i];
      }
      renderer.setClearColor(0, 1);
      for (let p = 0; p < 3; p++) {
        const before = renderer.info.render.drawCalls,
          tris = renderer.info.render.triangles;
        renderer.setRenderTarget(targets[p]);
        renderer.render(scenes[0], shadowCameras[p]);
        counts.push(renderer.info.render.drawCalls - before);
        triangles.push(renderer.info.render.triangles - tris);
      }
      for (let i = 0; i < renderMeshes.length; i++) renderMeshes[i].material = beauty[i];
      renderer.setRenderTarget(null);
      renderer.setClearColor(skyColor, 1);
      let before = renderer.info.render.drawCalls,
        tris = renderer.info.render.triangles;
      renderer.render(scenes[0], cameras[0]);
      counts.push(renderer.info.render.drawCalls - before);
      triangles.push(renderer.info.render.triangles - tris);
      renderer.autoClear = false;
      renderer.clearDepth();
      before = renderer.info.render.drawCalls;
      tris = renderer.info.render.triangles;
      renderer.render(scenes[1], cameras[1]);
      counts.push(renderer.info.render.drawCalls - before);
      triangles.push(renderer.info.render.triangles - tris);
      renderer.autoClear = true;
    },
    stats: () => stats,
    builds: () => builds,
    debug: () => ({
      shadows: shadowCameras.map((c) => ({
        world: c.matrixWorld.toArray(),
        view: c.matrixWorldInverse.toArray(),
        projection: c.projectionMatrix.toArray(),
        coords: c.coordinateSystem,
        reversed: c.reversedDepth,
      })),
      expected: data.shadows.map((s) => Array.from(s.vp)),
    }),
  };
}
