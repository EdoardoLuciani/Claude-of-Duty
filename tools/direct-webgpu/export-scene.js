// Offline diagnostic extraction only. Neither measured renderer runs the game.
export function makeSceneExport(engine, frameCount = 120) {
  const roots = [engine.ctx.scene, engine.ctx.viewScene];
  const meshes = [],
    nodes = [],
    geometries = [],
    skeletons = [],
    materials = [];
  const nodeIds = new Map(),
    geoIds = new Map(),
    skeletonIds = new Map(),
    materialIds = new Map();
  const chunks = [];
  let byteLength = 0;
  const array = (value) => Array.from(value);
  function add(data) {
    const copy = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    const span = { offset: byteLength, bytes: copy.length };
    chunks.push(copy);
    byteLength += copy.length;
    const padding = (4 - (byteLength % 4)) % 4;
    if (padding) {
      chunks.push(new Uint8Array(padding));
      byteLength += padding;
    }
    return span;
  }
  function node(object) {
    if (nodeIds.has(object)) return nodeIds.get(object);
    const parent = object.parent ? node(object.parent) : -1;
    const id = nodes.length;
    nodeIds.set(object, id);
    nodes.push({
      object,
      name: object.name || object.type,
      parent,
      bone: !!object.isBone,
      matrix: array(object.matrix.elements),
      visible: object.visible,
    });
    return id;
  }
  function material(m) {
    if (materialIds.has(m)) return materialIds.get(m);
    const id = materials.length;
    materialIds.set(m, id);
    // A deliberately simple, shared albedo policy; original PBR/textures are not reproduced.
    const name = m.name || `material-${id}`;
    const tint = m.color ? m.color.toArray() : [0.65, 0.6, 0.5];
    if (Math.min(...tint) > 0.95) {
      const palette = [
        [0.58, 0.49, 0.35],
        [0.65, 0.58, 0.47],
        [0.32, 0.36, 0.28],
        [0.4, 0.36, 0.3],
        [0.22, 0.25, 0.24],
      ];
      tint.splice(0, 3, ...palette[id % palette.length]);
    }
    materials.push({ name, color: tint, side: m.side });
    return id;
  }
  function geometry(g) {
    if (geoIds.has(g)) return geoIds.get(g);
    const id = geometries.length,
      p = g.attributes.position,
      n = g.attributes.normal;
    if (!p || !n) throw Error('opaque geometry needs position and normal');
    const vertices = new ArrayBuffer(p.count * 56),
      floats = new Float32Array(vertices),
      words = new Uint32Array(vertices);
    const joints = g.attributes.skinIndex,
      weights = g.attributes.skinWeight;
    for (let i = 0; i < p.count; i++) {
      for (let j = 0; j < 3; j++) {
        floats[i * 14 + j] = p.getComponent(i, j);
        floats[i * 14 + 3 + j] = n.getComponent(i, j);
      }
      for (let j = 0; j < 4; j++) {
        words[i * 14 + 6 + j] = joints ? joints.getComponent(i, j) : 0;
        floats[i * 14 + 10 + j] = weights ? weights.getComponent(i, j) : Number(j === 0);
      }
    }
    const indices = new Uint32Array(g.index ? g.index.count : p.count);
    for (let i = 0; i < indices.length; i++) indices[i] = g.index ? g.index.getX(i) : i;
    geoIds.set(g, id);
    geometries.push({
      vertex: add(new Uint8Array(vertices)),
      index: add(indices),
      vertices: p.count,
      indices: indices.length,
    });
    return id;
  }
  function skeleton(s) {
    if (skeletonIds.has(s)) return skeletonIds.get(s);
    const id = skeletons.length;
    skeletonIds.set(s, id);
    skeletons.push({
      bones: s.bones.map(node),
      inverses: s.boneInverses.map((m) => array(m.elements)),
    });
    return id;
  }
  roots.forEach((root, scene) =>
    root.traverse((object) => {
      if (
        !object.isMesh ||
        object.isBatchedMesh ||
        !object.geometry.attributes.normal ||
        object.name.startsWith('sky-') ||
        object.name.startsWith('fx-')
      )
        return;
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      if (mats.some((m) => m.transparent || m.alphaTest > 0 || !m.visible)) return;
      if (!object.layers.test((scene ? engine.ctx.viewCamera : engine.ctx.camera).layers)) return;
      if (object.geometry.isInstancedBufferGeometry && !object.isInstancedMesh) return;
      const g = geometry(object.geometry),
        total = geometries[g].indices;
      const start = object.geometry.drawRange.start;
      const end = Math.min(total, start + object.geometry.drawRange.count);
      const groups = Array.isArray(object.material)
        ? object.geometry.groups
        : [{ start: 0, count: total, materialIndex: 0 }];
      const ranges = groups.flatMap((r) => {
        const first = Math.max(start, r.start),
          last = Math.min(end, r.start + r.count);
        return last > first
          ? [{ start: first, count: last - first, material: material(mats[r.materialIndex ?? 0]) }]
          : [];
      });
      if (!ranges.length) return;
      object.computeBoundingSphere?.();
      object.geometry.computeBoundingSphere();
      const sphere = object.boundingSphere || object.geometry.boundingSphere;
      meshes.push({
        node: node(object),
        geometry: g,
        scene,
        ranges,
        castShadow: object.castShadow,
        skinned: !!object.isSkinnedMesh,
        skeleton: object.skeleton ? skeleton(object.skeleton) : -1,
        bind: object.bindMatrix ? array(object.bindMatrix.elements) : null,
        detached: object.bindMode === 'detached',
        bindInverse: object.bindMatrixInverse ? array(object.bindMatrixInverse.elements) : null,
        storageInstances: !!object.instanceMatrix?.isStorageInstancedBufferAttribute,
        instances: object.isInstancedMesh
          ? add(object.instanceMatrix.array.slice(0, object.count * 16))
          : null,
        count: object.isInstancedMesh ? object.count : 1,
        sphere: [...sphere.center.toArray(), sphere.radius],
        cull: object.frustumCulled,
        name: object.name || object.type,
      });
    })
  );
  const frames = new Float32Array(frameCount * nodes.length * 16);
  const visibility = new Uint8Array(frameCount * nodes.length);
  const cameras = new Float32Array(frameCount * 64);
  let captured = 0;
  return {
    take(frame) {
      if (frame < 0 || frame >= frameCount) return;
      for (let i = 0; i < nodes.length; i++) {
        const o = nodes[i].object;
        if (o.parent && nodeIds.get(o.parent) !== nodes[i].parent)
          throw Error(`unsupported reparent: ${nodes[i].name}`);
        frames.set(o.matrix.elements, (frame * nodes.length + i) * 16);
        visibility[frame * nodes.length + i] = Number(o.visible);
      }
      for (let scene = 0; scene < 2; scene++) {
        const c = scene ? engine.ctx.viewCamera : engine.ctx.camera;
        cameras.set(c.matrixWorld.elements, frame * 64 + scene * 32);
        cameras.set(c.projectionMatrix.elements, frame * 64 + scene * 32 + 16);
      }
      captured++;
    },
    finish() {
      if (captured !== frameCount) throw Error(`captured ${captured}/${frameCount}`);
      const dynamic = [];
      for (let n = 0; n < nodes.length; n++)
        for (let f = 1; f < frameCount; f++) {
          let changed = visibility[f * nodes.length + n] !== visibility[n];
          for (let j = 0; j < 16; j++)
            if (frames[(f * nodes.length + n) * 16 + j] !== frames[n * 16 + j]) changed = true;
          if (changed) {
            dynamic.push(n);
            break;
          }
        }
      const packed = new Float32Array(frameCount * dynamic.length * 16),
        visible = new Uint32Array(frameCount * dynamic.length);
      for (let f = 0; f < frameCount; f++)
        for (let i = 0; i < dynamic.length; i++) {
          const n = dynamic[i];
          packed.set(
            frames.subarray((f * nodes.length + n) * 16, (f * nodes.length + n + 1) * 16),
            (f * dynamic.length + i) * 16
          );
          visible[f * dynamic.length + i] = visibility[f * nodes.length + n];
        }
      const meta = {
        version: 1,
        frameCount,
        nodes: nodes.map((n, i) => ({
          name: n.name,
          parent: n.parent,
          bone: n.bone,
          matrix: array(frames.subarray(i * 16, i * 16 + 16)),
          visible: !!visibility[i],
        })),
        meshes,
        geometries,
        skeletons,
        materials,
        dynamic,
        frames: add(packed),
        visibility: add(visible),
        cameras: add(cameras),
      };
      const bytes = new Uint8Array(byteLength);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      return { meta, base64: bytes.toBase64() };
    },
  };
}
