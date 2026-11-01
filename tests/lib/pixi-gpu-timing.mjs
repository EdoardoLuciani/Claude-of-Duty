// Browser-only diagnostic, serialized by the cost harness. No runtime hooks.
// Queries are scoped to Pixi-created passes and resolved once AFTER the replay.
export async function measurePixiGpu(engine, createProfile, lane, frames = 900) {
  const p = engine.ctx.get('ui').pixiHud,
    device = p.renderer.gpu.device;
  if (!device.features.has('timestamp-query')) return { supported: false };
  engine.ctx.get('weapons').resetForNewGame();
  const fixture = createProfile(engine, lane);
  for (let i = 0; i < 90; i++) {
    fixture.before(-1);
    await window.__PUMP__(1);
  }
  const capacity = 4096;
  const query = device.createQuerySet({ type: 'timestamp', count: capacity });
  const resolve = device.createBuffer({
    size: capacity * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const read = device.createBuffer({
    size: capacity * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const render = p.renderer.render,
    encoder = device.createCommandEncoder;
  const queue = device.queue,
    writeBuffer = queue.writeBuffer,
    writeTexture = queue.writeTexture,
    copyExternal = queue.copyExternalImageToTexture;
  const records = [],
    uploadFrames = [];
  let current = null,
    inside = false,
    used = 0;
  const summary = (values) => {
    if (!values.length) return { mean: 0, median: 0, p95: 0 };
    values.sort((a, b) => a - b);
    return {
      mean: values.reduce((s, v) => s + v, 0) / values.length,
      median: values[Math.floor(values.length / 2)],
      p95: values[Math.floor(values.length * 0.95)],
    };
  };
  try {
    try {
      p.renderer.render = function (...args) {
        inside = true;
        try {
          return render.apply(this, args);
        } finally {
          inside = false;
        }
      };
      device.createCommandEncoder = function (...args) {
        const command = encoder.apply(this, args);
        if (!inside || !current?.sampled) return command;
        const begin = command.beginRenderPass;
        command.beginRenderPass = function (descriptor) {
          if (descriptor.timestampWrites) throw Error('another Pixi timestamp owner exists');
          if (used + 2 > capacity) throw Error('Pixi query capacity exceeded');
          const first = used;
          used += 2;
          const pass = begin.call(this, {
            ...descriptor,
            timestampWrites: {
              querySet: query,
              beginningOfPassWriteIndex: first,
              endOfPassWriteIndex: first + 1,
            },
          });
          current.passes.push(first);
          for (const name of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) {
            const draw = pass[name];
            pass[name] = function (...args) {
              current.draws++;
              return draw.apply(this, args);
            };
          }
          return pass;
        };
        return command;
      };
      queue.writeBuffer = function (...args) {
        if (inside && current) current.writeBuffers++;
        return writeBuffer.apply(this, args);
      };
      queue.writeTexture = function (...args) {
        if (inside && current) current.writeTextures++;
        return writeTexture.apply(this, args);
      };
      queue.copyExternalImageToTexture = function (...args) {
        if (inside && current) current.copyExternal++;
        return copyExternal.apply(this, args);
      };
      for (let i = 0; i < frames; i++) {
        // 150 samples span a complete combat cycle, not just an idle screenshot.
        current = {
          frame: i,
          sampled: i % 6 === 0,
          passes: [],
          draws: 0,
          writeBuffers: 0,
          writeTextures: 0,
          copyExternal: 0,
        };
        fixture.before(i);
        await window.__PUMP__(1);
        fixture.after();
        uploadFrames.push(current);
        if (current.sampled) records.push(current);
      }
    } finally {
      p.renderer.render = render;
      device.createCommandEncoder = encoder;
      queue.writeBuffer = writeBuffer;
      queue.writeTexture = writeTexture;
      queue.copyExternalImageToTexture = copyExternal;
      fixture.dispose();
    }
    if (!used || records.some((r) => !r.passes.length))
      throw Error('missing Pixi render timestamp samples');
    const command = encoder.call(device);
    command.resolveQuerySet(query, 0, used, resolve, 0);
    command.copyBufferToBuffer(resolve, 0, read, 0, used * 8);
    device.queue.submit([command.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const ticks = new BigUint64Array(read.getMappedRange());
    for (const record of records) {
      record.gpuMs = record.passes.reduce(
        (sum, first) => sum + Number(ticks[first + 1] - ticks[first]) / 1e6,
        0
      );
      if (!Number.isFinite(record.gpuMs) || record.gpuMs < 0)
        throw Error('invalid Pixi timestamps');
    }
    read.unmap();
    return {
      supported: true,
      samples: records.length,
      queryCount: used,
      gpuPassMs: summary(records.map((r) => r.gpuMs)),
      passesPerFrame: summary(records.map((r) => r.passes.length)),
      drawCalls: summary(records.map((r) => r.draws)),
      writeBuffers: summary(records.map((r) => r.writeBuffers)),
      sampledTextureUploads: records.reduce((sum, r) => sum + r.writeTextures + r.copyExternal, 0),
      sampledFramesWithUploads: records.filter((r) => r.writeTextures + r.copyExternal > 0).length,
      totalTextureUploads: uploadFrames.reduce(
        (sum, r) => sum + r.writeTextures + r.copyExternal,
        0
      ),
      framesWithTextureUploads: uploadFrames.filter((r) => r.writeTextures + r.copyExternal > 0)
        .length,
      totalWriteBufferCalls: uploadFrames.reduce((sum, r) => sum + r.writeBuffers, 0),
      records,
      report: fixture.report,
      method:
        'Pixi-only render pass timestamp sum; sampled every six frames in a full replay; one final readback; excludes uploads, CPU preparation and browser composition',
    };
  } finally {
    query.destroy();
    resolve.destroy();
    read.destroy();
  }
}
