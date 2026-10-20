// Port of #476 (11ebdca): caller owns device/output; rendering algorithm unchanged.
import { inverseAffine, multiply, planes, intersects } from './math.mjs';
import { vertexCode, colorCode, depthCode } from './shaders.mjs';
export async function createRaw(
  target,
  data,
  { shadowSize = 1024, freezePose = false, unbatched = false } = {}
) {
  const { device, format } = target;
  const queue = device.queue;
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  const buffer = (bytes, usage) => {
    const b = device.createBuffer({
      size: Math.max(16, (bytes.byteLength + 3) & ~3),
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(b.getMappedRange()).set(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    );
    b.unmap();
    return b;
  };
  const meta = data.meta,
    locals = meta.nodes.map((n) => new Float64Array(n.matrix)),
    world = meta.nodes.map(() => new Float64Array(16));
  const visible = new Uint8Array(meta.nodes.length),
    active = new Uint8Array(meta.nodes.length),
    dirty = new Uint8Array(meta.nodes.length);
  for (const n of meta.dynamic) dirty[n] = 1;
  for (let i = 0; i < meta.nodes.length; i++) {
    visible[i] = Number(meta.nodes[i].visible);
    if (meta.nodes[i].parent >= 0) dirty[i] |= dirty[meta.nodes[i].parent];
  }
  const updateWorld = (all) => {
    for (let i = 0; i < world.length; i++) {
      const p = meta.nodes[i].parent;
      if (all || dirty[i]) {
        if (p < 0) world[i].set(locals[i]);
        else multiply(world[i], world[p], locals[i]);
      }
      active[i] = visible[i] && (p < 0 || active[p]);
    }
  };
  updateWorld(true);
  const skeletonOffsets = [];
  let boneCount = 0;
  const inverseBinds = meta.skeletons.map((s) => s.inverses.map((a) => new Float64Array(a)));
  for (const s of meta.skeletons) {
    skeletonOffsets.push(boneCount);
    boneCount += s.bones.length;
  }
  const boneData = new Float32Array(boneCount * 16),
    scratch = new Float64Array(16),
    inverse = new Float64Array(16),
    combined = new Float64Array(16);
  const gpuBones = buffer(boneData, GPUBufferUsage.STORAGE);
  const gpuGeometry = data.geometry.map((g) => ({
    vertex: buffer(g.vertices, GPUBufferUsage.VERTEX),
    index: buffer(g.indices, GPUBufferUsage.INDEX),
  }));
  const modelCount = meta.meshes.reduce((s, m) => s + m.count, 0),
    models = new Float32Array(modelCount * 64),
    meshBases = [];
  let base = 0;
  for (const m of meta.meshes) {
    meshBases.push(base);
    base += m.count;
  }
  function publishModels(index) {
    const m = meta.meshes[index];
    for (let instance = 0; instance < m.count; instance++) {
      let w = world[m.node];
      if (data.instances[index]) {
        multiply(combined, w, data.instances[index].subarray(instance * 16, instance * 16 + 16));
        w = combined;
      }
      inverseAffine(inverse, w);
      const at = (meshBases[index] + instance) * 64;
      models.set(w, at);
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) models[at + 16 + c * 4 + r] = inverse[r * 4 + c];
      models.set(m.bind || data.identity, at + 32);
      models.set(m.detached ? m.bindInverse : inverse, at + 48);
    }
  }
  meta.meshes.forEach((_, i) => publishModels(i));
  const gpuModels = buffer(models, GPUBufferUsage.STORAGE),
    dirtySpans = [];
  for (let i = 0; i < meta.meshes.length; i++)
    if (dirty[meta.meshes[i].node]) {
      const start = meshBases[i] * 64,
        end = start + meta.meshes[i].count * 64,
        last = dirtySpans.at(-1);
      if (last && last.end === start) last.end = end;
      else dirtySpans.push({ start, end });
    }
  const records = [],
    draws = [];
  for (let i = 0; i < meta.meshes.length; i++)
    for (const range of meta.meshes[i].ranges) {
      const m = meta.meshes[i],
        first = records.length / 4;
      for (let instance = 0; instance < m.count; instance++)
        records.push(
          meshBases[i] + instance,
          range.material,
          m.skinned ? skeletonOffsets[m.skeleton] : 0xffffffff,
          0
        );
      draws.push({ mesh: i, first, range, side: meta.materials[range.material].side });
    }
  const gpuInstances = buffer(new Uint32Array(records), GPUBufferUsage.VERTEX);
  const colors = new Float32Array(meta.materials.length * 4);
  meta.materials.forEach((m, i) => colors.set([...m.color, 1], i * 4));
  const gpuColors = buffer(colors, GPUBufferUsage.STORAGE);
  const texture = (size, format, usage) => device.createTexture({ size, format, usage });
  const shadowDepth = data.shadows.map(() =>
    texture(
      [shadowSize, shadowSize],
      'depth32float',
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    )
  );
  const shadowColor = data.shadows.map(() =>
    texture([shadowSize, shadowSize], 'rgba8unorm', GPUTextureUsage.RENDER_ATTACHMENT)
  );
  const depth = texture(
    [target.width, target.height],
    'depth32float',
    GPUTextureUsage.RENDER_ATTACHMENT
  );
  const frameLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  });
  const objectLayout = device.createBindGroupLayout({
    entries: [0, 1].map((binding) => ({
      binding,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'read-only-storage' },
    })),
  });
  const colorLayout = device.createBindGroupLayout({
    entries: [
      ...[0, 1, 2].map((binding) => ({
        binding,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth' },
      })),
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const objects = device.createBindGroup({
    layout: objectLayout,
    entries: [
      { binding: 0, resource: { buffer: gpuModels } },
      { binding: 1, resource: { buffer: gpuBones } },
    ],
  });
  const colorGroup = device.createBindGroup({
    layout: colorLayout,
    entries: [
      ...shadowDepth.map((t, binding) => ({ binding, resource: t.createView() })),
      { binding: 3, resource: { buffer: gpuColors } },
    ],
  });
  const frames = Array.from({ length: 5 }, () => {
    const values = new Float32Array(68),
      gpu = buffer(values, GPUBufferUsage.UNIFORM);
    return {
      values,
      gpu,
      group: device.createBindGroup({
        layout: frameLayout,
        entries: [{ binding: 0, resource: { buffer: gpu } }],
      }),
      frustum: new Float64Array(24),
    };
  });
  for (let p = 0; p < 5; p++) {
    const f = frames[p];
    for (let c = 0; c < 3; c++) f.values.set(data.shadows[c].vp, 16 + c * 16);
    f.values.set(data.light, 64);
    if (p < 3) {
      f.values.set(data.shadows[p].vp);
      planes(data.shadows[p].vp, f.frustum);
    }
    queue.writeBuffer(f.gpu, 0, f.values);
  }
  const pipelines = new Map();
  for (const isShadow of [true, false])
    for (const side of [0, 1, 2]) {
      const module = device.createShaderModule({
        code: vertexCode + (isShadow ? depthCode : colorCode),
      });
      const messages = (await module.getCompilationInfo()).messages.filter(
        (m) => m.type === 'error'
      );
      if (messages.length) throw Error(JSON.stringify(messages));
      const pipeline = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({
          bindGroupLayouts: isShadow
            ? [frameLayout, objectLayout]
            : [frameLayout, objectLayout, colorLayout],
        }),
        vertex: {
          module,
          entryPoint: 'vs',
          buffers: [
            {
              arrayStride: 56,
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' },
                { shaderLocation: 1, offset: 12, format: 'float32x3' },
                { shaderLocation: 2, offset: 24, format: 'uint32x4' },
                { shaderLocation: 3, offset: 40, format: 'float32x4' },
              ],
            },
            {
              arrayStride: 16,
              stepMode: 'instance',
              attributes: [{ shaderLocation: 4, offset: 0, format: 'uint32x4' }],
            },
          ],
        },
        fragment: {
          module,
          entryPoint: 'fs',
          targets: [{ format: isShadow ? 'rgba8unorm' : format }],
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: side === 2 ? 'none' : side === 1 ? 'front' : 'back',
        },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      });
      pipelines.set(`${Number(isShadow)}:${side}`, pipeline);
    }
  for (const draw of draws) {
    draw.shadowPipeline = pipelines.get(`1:${draw.side}`);
    draw.colorPipeline = pipelines.get(`0:${draw.side}`);
  }
  const cameraWorld = [new Float64Array(16), new Float64Array(16)],
    cameraVP = [new Float64Array(16), new Float64Array(16)];
  const descriptors = frames.map((_, p) => ({
    colorAttachments: [
      {
        view: null,
        clearValue: p < 3 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 0.38, g: 0.5, b: 0.65, a: 1 },
        loadOp: p === 4 ? 'load' : 'clear',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: {
      view: p < 3 ? shadowDepth[p].createView() : depth.createView(),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  }));
  for (let p = 0; p < 3; p++) descriptors[p].colorAttachments[0].view = shadowColor[p].createView();
  const counts = Array(5).fill(0),
    triangles = Array(5).fill(0),
    lastStats = { draws: counts, triangles };
  return {
    device,
    errors,
    render(frameIndex) {
      const frame = frameIndex % meta.frameCount;
      for (let i = 0; i < meta.dynamic.length; i++) {
        const n = meta.dynamic[i],
          start = (frame * meta.dynamic.length + i) * 16;
        if (!freezePose || !meta.nodes[n].bone)
          for (let j = 0; j < 16; j++) locals[n][j] = data.frames[start + j];
        visible[n] = data.visibility[frame * meta.dynamic.length + i];
      }
      updateWorld(false);
      for (let i = 0; i < meta.skeletons.length; i++)
        for (let b = 0; b < meta.skeletons[i].bones.length; b++) {
          multiply(scratch, world[meta.skeletons[i].bones[b]], inverseBinds[i][b]);
          boneData.set(scratch, (skeletonOffsets[i] + b) * 16);
        }
      if (!unbatched) queue.writeBuffer(gpuBones, 0, boneData);
      for (let i = 0; i < meta.meshes.length; i++) if (dirty[meta.meshes[i].node]) publishModels(i);
      if (!unbatched)
        for (const span of dirtySpans)
          queue.writeBuffer(gpuModels, span.start * 4, models, span.start, span.end - span.start);
      for (let scene = 0; scene < 2; scene++) {
        for (let j = 0; j < 16; j++)
          cameraWorld[scene][j] = data.cameras[frame * 64 + scene * 32 + j];
        inverseAffine(inverse, cameraWorld[scene]);
        multiply(
          cameraVP[scene],
          data.cameras.subarray(frame * 64 + scene * 32 + 16, frame * 64 + scene * 32 + 32),
          inverse
        );
      }
      for (let p = 3; p < 5; p++) {
        const vp = cameraVP[p - 3],
          f = frames[p];
        f.values.set(vp);
        planes(vp, f.frustum);
        queue.writeBuffer(f.gpu, 0, f.values);
      }
      const view = target.view();
      descriptors[3].colorAttachments[0].view = view;
      descriptors[4].colorAttachments[0].view = view;
      let encoder = device.createCommandEncoder();
      counts.fill(0);
      triangles.fill(0);
      for (let p = 0; p < 5; p++) {
        const pass = encoder.beginRenderPass(descriptors[p]);
        pass.setBindGroup(0, frames[p].group);
        pass.setBindGroup(1, objects);
        if (p >= 3) pass.setBindGroup(2, colorGroup);
        pass.setVertexBuffer(1, gpuInstances);
        let lastGeometry = -1,
          lastPipeline = null;
        for (const draw of draws) {
          const m = meta.meshes[draw.mesh];
          if (
            m.scene !== Number(p === 4) ||
            !active[m.node] ||
            (p < 3 && !m.castShadow) ||
            (m.cull && !intersects(m.sphere, world[m.node], frames[p].frustum))
          )
            continue;
          if (unbatched) {
            queue.writeBuffer(
              gpuModels,
              meshBases[draw.mesh] * 256,
              models,
              meshBases[draw.mesh] * 64,
              64
            );
            if (m.skinned) {
              const start = skeletonOffsets[m.skeleton] * 16;
              queue.writeBuffer(
                gpuBones,
                start * 4,
                boneData,
                start,
                meta.skeletons[m.skeleton].bones.length * 16
              );
            }
          }
          const pipeline = p < 3 ? draw.shadowPipeline : draw.colorPipeline;
          if (pipeline !== lastPipeline) {
            pass.setPipeline(pipeline);
            lastPipeline = pipeline;
          }
          if (lastGeometry !== m.geometry) {
            const g = gpuGeometry[m.geometry];
            pass.setVertexBuffer(0, g.vertex);
            pass.setIndexBuffer(g.index, 'uint32');
            lastGeometry = m.geometry;
          }
          pass.drawIndexed(draw.range.count, m.count, draw.range.start, 0, draw.first);
          counts[p]++;
          triangles[p] += (draw.range.count / 3) * m.count;
        }
        pass.end();
        if (unbatched) {
          queue.submit([encoder.finish()]);
          if (p < 4) encoder = device.createCommandEncoder();
        }
      }
      if (!unbatched) queue.submit([encoder.finish()]);
    },
    stats: () => lastStats,
  };
}
