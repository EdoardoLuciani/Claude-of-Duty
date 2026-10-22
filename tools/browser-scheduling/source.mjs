import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export const sha = (...chunks) =>
  chunks.reduce((h, c) => h.update(c), createHash('sha256')).digest('hex');
export function replaceOnce(source, old, value) {
  assert.equal(source.split(old).length, 2, `pinned source changed: ${old}`);
  return source.replace(old, value);
}
export async function sources(reference, target, identity = false, format = 'rgba8unorm') {
  const root = join(reference, 'tools/direct-webgpu');
  const files = Object.fromEntries(
    await Promise.all(
      ['raw-renderer.js', 'math.js', 'scene-data.js', 'shaders.js'].map(async (f) => [
        f,
        await readFile(join(root, f), 'utf8'),
      ])
    )
  );
  const originalSha256 = sha(...Object.values(files));
  assert(['rgba8unorm', 'bgra8unorm'].includes(format));
  let raw = replaceOnce(
    files['raw-renderer.js'],
    'format = navigator.gpu.getPreferredCanvasFormat();',
    `format = '${format}';`
  );
  raw = replaceOnce(
    raw,
    '    device,\n    errors,',
    '    device,\n    errors,\n    outputFormat: format,'
  );
  if (target === 'offscreen') {
    raw = replaceOnce(
      raw,
      '  const cameraWorld = [',
      `  const outputTexture = texture([canvas.width,canvas.height],format,GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
  const outputView=outputTexture.createView();
  const cameraWorld = [`
    );
    raw = replaceOnce(raw, 'context.getCurrentTexture().createView()', 'outputView');
    raw = replaceOnce(
      raw,
      '    outputFormat: format,',
      '    outputFormat: format,\n    outputTexture,'
    );
  } else if (identity) {
    raw = replaceOnce(
      raw,
      '  const cameraWorld = [',
      '  let previousTexture=null;const textureCounts={acquisitions:0,distinctObjects:0};\n  const cameraWorld = ['
    );
    raw = replaceOnce(
      raw,
      'const view = context.getCurrentTexture().createView();',
      `const current=context.getCurrentTexture();textureCounts.acquisitions++;
      if(current!==previousTexture)textureCounts.distinctObjects++;previousTexture=current;
      const view=current.createView();`
    );
    raw = replaceOnce(
      raw,
      '    outputFormat: format,',
      '    outputFormat: format,\n    textureCounts,'
    );
  }
  files['raw-renderer.js'] = raw;
  files['shaders.js'] = replaceOnce(
    files['shaders.js'],
    'var out:VertexOut;out.clip=frame.vp*world;out.world=world.xyz;out.normal=(object.normal*vec4<f32>(normal,0.0)).xyz;out.material=instance.y;return out;',
    'return VertexOut(frame.vp*world,world.xyz,(object.normal*vec4<f32>(normal,0.0)).xyz,instance.y);'
  );
  const client = await readFile(new URL('client.js', import.meta.url), 'utf8');
  return {
    files,
    client,
    originalSha256,
    rendererSha256: sha(...Object.values(files)),
    clientSha256: sha(client),
  };
}
