import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter reads Blobs back with FileReader, which Node does not provide.
// The exporter assigns onloadend immediately after readAsArrayBuffer returns,
// so dispatch from a microtask after Blob.arrayBuffer() resolves.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        queueMicrotask(() => this.onloadend?.());
      });
    }
  };
}

/** Write through a process-local temporary file and atomically replace output. */
export function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export function writeJsonAtomic(file, value) {
  writeAtomic(file, JSON.stringify(value, null, 2));
}

/** Encode one scene as a binary glTF buffer. */
export async function encodeGLB(scene, options = {}) {
  const exporter = new GLTFExporter();
  return exporter.parseAsync(scene, { binary: true, ...options });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means alive but inaccessible. Only ESRCH proves a stale owner.
    return err.code === 'EPERM';
  }
}

/**
 * Serialize one deterministic asset pipeline across concurrent Vite/tool runs.
 * mkdir is the atomic claim; owner tokens prevent an old process from deleting
 * a replacement owner's lock during delayed cleanup.
 */
export async function withAssetLock(root, name, fn, opts = {}) {
  const label = opts.label ?? name;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const graceMs = opts.graceMs ?? 10_000;
  const lockDir = join(root, 'node_modules', '.cache', `claude-of-duty-${name}.lock`);
  const ownerFile = join(lockDir, 'owner.json');
  const token = `${process.pid}-${randomUUID()}`;
  const started = Date.now();

  mkdirSync(dirname(lockDir), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let owner = null;
      try {
        owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
      } catch {
        // The winner may be between mkdir and writing owner.json. The grace
        // period distinguishes that window from a process that died there.
      }
      const waited = Date.now() - started;
      const stale = !owner || !Number.isFinite(owner.pid)
        ? waited > graceMs
        : !pidAlive(owner.pid);
      if (stale) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (waited > timeoutMs) {
        throw new Error(
          `[${label}] exporter lock held for >${timeoutMs / 1000}s by pid ${owner?.pid} — remove ${lockDir}`
        );
      }
      await sleep(200);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
      if (owner.token === token) rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Already released or replaced by a new owner.
    }
  }
}
