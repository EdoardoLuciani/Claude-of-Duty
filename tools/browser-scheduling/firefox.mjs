// Use Puppeteer's supported BiDi connection, but create our own minimal profile.
// Puppeteer.launch() installs unrelated prefs (including fission isolation=0).
// Never use an existing user profile or alter global/default Firefox settings.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

import puppeteer from 'puppeteer-core';
export async function launchFirefox(
  executable,
  profile,
  pace,
  env,
  { systemAccess = false, url = 'about:blank', log = () => {} } = {}
) {
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const preferences = {
    'layout.frame_rate': pace === 'uncapped' ? 0 : -1,
    'browser.shell.checkDefaultBrowser': false,
    'browser.aboutwelcome.enabled': false,
    'browser.startup.homepage_override.mstone': 'ignore',
    'app.update.disabledForTesting': true,
  };
  await writeFile(
    profile + '/user.js',
    Object.entries(preferences)
      .map(([k, v]) => `user_pref(${JSON.stringify(k)},${JSON.stringify(v)});`)
      .join('\n') + '\n'
  );
  const childEnv = { ...env, MOZ_ENABLE_WAYLAND: '0', GDK_BACKEND: 'x11' };
  if (systemAccess) childEnv.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = '1';
  else delete childEnv.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS;
  const args = ['--no-remote', '--profile', profile, '--remote-debugging-port=0', url];
  const child = spawn(executable, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(Error('Firefox startup timeout')), 30000);
      const record = (data) => {
        const text = String(data);
        log(text);
        output += text;
        const match = output.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1] + '/session');
        }
      };
      child.stdout.on('data', record);
      child.stderr.on('data', record);
      child.once('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(Error(`Firefox exited ${code}`));
      });
    });
    const browser = await puppeteer.connect({
      browserWSEndpoint: endpoint,
      protocol: 'webDriverBiDi',
      protocolTimeout: 180000,
    });
    return {
      browser,
      pid: child.pid,
      args,
      preferences,
      async close() {
        try {
          await browser.close();
        } finally {
          if (child.exitCode === null) child.kill('SIGTERM');
        }
      },
    };
  } catch (e) {
    if (child.exitCode === null) child.kill('SIGTERM');
    throw e;
  }
}
