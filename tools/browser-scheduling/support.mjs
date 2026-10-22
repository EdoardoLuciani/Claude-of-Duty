// Separate diagnostics only: no performance results and no primary-run flag.
// System access is scoped to this fresh profile/process solely to read the
// browser's built-in about:support page; timed runs never enable it.
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { launchFirefox } from './firefox.mjs';
import { sha } from './source.mjs';
const { values: args } = parseArgs({
  options: { executable: { type: 'string' }, out: { type: 'string' } },
});
assert(args.executable && args.out);
const env = { ...process.env, MESA_VK_DEVICE_SELECT: '1002:7550!' };
delete env.WAYLAND_DISPLAY;
delete env.WAYLAND_SOCKET;
const f = await launchFirefox(args.executable, args.out + '.profile', 'uncapped', env, {
  systemAccess: true,
  url: 'about:support',
  log: (text) => process.stderr.write(text),
});
try {
  const page = (await f.browser.pages()).find((p) => p.url() === 'about:support');
  assert(page);
  await new Promise((r) => setTimeout(r, 3000));
  const text = await page.evaluate(() => document.body.innerText);
  const start = text.indexOf('WebGPU Default Adapter\t'),
    end = text.indexOf('WebGPU Fallback Adapter\t');
  assert(start >= 0 && end > start);
  const adapters = JSON.parse(text.slice(start + 'WebGPU Default Adapter\t'.length, end).trim());
  const info = adapters['navigator.gpu.requestAdapter({})'].info;
  assert.equal(info.wgpuBackend, 'Vulkan');
  assert.equal(info.wgpuVendor, 4098);
  assert.equal(info.wgpuDevice, 30032);
  assert.equal(info.isFallbackAdapter, false);
  assert.match(text, /Compositing\s+WebRender/);
  assert.match(text, /Window Protocol\s+x11/);
  await writeFile(args.out + '.txt', text);
  await writeFile(
    args.out,
    JSON.stringify(
      {
        version: await f.browser.version(),
        binarySha256: sha(await readFile(args.executable)),
        adapterInfo: info,
        args: f.args,
        preferences: f.preferences,
        diagnosticOnly: true,
        systemAccess: true,
      },
      null,
      2
    ) + '\n'
  );
  console.log(JSON.stringify(info));
} finally {
  await f.close();
}
