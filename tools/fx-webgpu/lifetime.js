import { Scene, StreamDrawUsage, Vector3 } from 'three/webgpu';
import { ParticleLayer, resetSpawn } from '../../src/fx/particles.js';
import { DecalSystem } from '../../src/fx/decals.js';

/** Diagnostic GPU readback: versioned births, quiet frames, expiry, wrap and fresh owners. */
export async function checkFxLifetime(renderer, camera, target, particleAtlas, decalAtlas) {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const render = scene => { renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera); };
  async function equalGpu(attribute) {
    const gpu = new Uint32Array(await renderer.getArrayBufferAsync(attribute));
    const cpu = new Uint32Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.length);
    check(gpu.length === cpu.length && gpu.every((v, i) => v === cpu[i]),
      'versioned FX GPU attribute disagrees with CPU data');
  }
  const result = [];
  for (let restart = 0; restart < 2; restart++) {
    const layer = new ParticleLayer({ capacity: 16, mode: 'additive', atlas: particleAtlas.texture, cols: particleAtlas.cols });
    const decals = new DecalSystem({ capacity: 8, albedo: decalAtlas.albedo, normal: decalAtlas.normal,
      orm: decalAtlas.orm, cols: decalAtlas.cols });
    const scene = new Scene(); scene.add(layer.mesh, decals.mesh);
    check(layer.ibuf.usage === StreamDrawUsage && decals.aPos.usage === StreamDrawUsage, 'FX must use versioned stream usage');
    const s = resetSpawn(); s.z = -2; s.life = 2; s.size0 = .5; s.size1 = .5; s.i0 = 10; s.i1 = 10;
    const point = new Vector3(0, 0, -2), normal = new Vector3(0, 0, 1);
    const project = now => decals.add({ point, normal, size: .3, tile: 0, life: 2, fade: .7, now, world: null });
    const attrs = [layer.ibuf, decals.aPos, decals.aNrm, decals.aUv, decals.aDec];
    let uploads = 0; const tracked = new Set(), queue = renderer.backend.device.queue, original = queue.writeBuffer;
    queue.writeBuffer = function (buffer, ...args) { if (tracked.has(buffer)) uploads++; return original.call(this, buffer, ...args); };
    try {
      layer.emit(s, 0); project(0); layer.flush(.1); decals.flush(.1); render(scene);
      for (const a of attrs) { await equalGpu(a); tracked.add(renderer.backend.get(a).buffer); }
      const initial = Array.from(await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height));
      const beforeQuiet = uploads;
      layer.flush(.1); decals.flush(.1); render(scene); render(scene);
      const quiet = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
      check(uploads === beforeQuiet, 'quiet FX frame reuploaded event data');
      check(quiet.every((v, i) => v === initial[i]), 'quiet FX image changed at fixed time');
      check(initial.some(v => v > 0), 'FX lifetime fixture rendered nothing');
      layer.flush(.5); decals.flush(.5); render(scene);
      const aged = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
      check(aged.some((v, i) => v !== initial[i]), 'shader age failed to advance without attribute uploads');
      check(uploads === beforeQuiet, 'shader age reuploaded event data');
      // GPU time advances without touching birth data, then both systems hide.
      layer.flush(3); decals.flush(3); render(scene);
      check(!layer.mesh.visible && !decals.mesh.visible, 'FX expiry did not hide meshes');
      check(uploads === beforeQuiet, 'expiry reuploaded event data');
      // Accumulate multiple flushes while the scene is hidden, including ring wrap.
      scene.visible = false;
      for (let i = 0; i < 21; i++) {
        s.x = (i % 3 - 1) * .2; s.r0 = (i + 1) / 22; s.r1 = s.r0;
        layer.emit(s, 4); project(4); layer.flush(4); decals.flush(4);
      }
      check(layer._wrapped && decals._wrapped, 'fixture did not wrap both rings');
      render(scene);
      check(uploads === beforeQuiet, 'hidden FX edits uploaded before becoming visible');
      scene.visible = true;
      render(scene);
      for (const a of attrs) await equalGpu(a);
      check(uploads > beforeQuiet, 'new births failed to publish after expiry');
      const afterWrap = uploads;
      layer.flush(4); decals.flush(4); render(scene);
      check(uploads === afterWrap, 'ring wrap restored quiet uploads');
      target.setSize(65, 33); renderer.setSize(65, 33); camera.aspect = 65 / 33; camera.updateProjectionMatrix();
      render(scene);
      check(uploads === afterWrap, 'resize reuploaded unchanged FX data');
      for (const a of attrs) await equalGpu(a);
      result.push({ restart, quietUploads: 0, expiryUploads: 0, wrapPublished: true, resized: true });
    } finally {
      queue.writeBuffer = original; layer.dispose(); decals.dispose(); renderer.setRenderTarget(null);
    }
  }
  return result;
}
