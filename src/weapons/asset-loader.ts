import { LoaderUtils, type CompressedTexture } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { Renderer } from 'three/webgpu';

type FeatureRenderer = Pick<Renderer, 'hasFeature'>;
interface LoaderSession {
  decoder: KTX2Loader;
  tail: Promise<void>;
  abort: AbortController;
  disposal: Promise<void> | null;
}
const sessions = new WeakMap<FeatureRenderer, LoaderSession>();

function sessionFor(renderer: FeatureRenderer): LoaderSession {
  const existing = sessions.get(renderer);
  if (existing) return existing;
  // Basis transcoder files are served from three's libs at /basis/ (build/bun.ts).
  const decoder = new KTX2Loader().setTranscoderPath('/basis/').setWorkerLimit(2);
  // Our strict native Renderer has no isWebGPURenderer flag. Use the public
  // worker config rather than detectSupport()'s WebGL renderer branch.
  decoder.workerConfig = {
    astcSupported: renderer.hasFeature('texture-compression-astc'),
    bptcSupported: renderer.hasFeature('texture-compression-bc'),
    astcHDRSupported: false,
    etc1Supported: false,
    etc2Supported: false,
    dxtSupported: false,
    pvrtcSupported: false,
  };
  const postMessage = decoder.workerPool.postMessage.bind(decoder.workerPool);
  decoder.workerPool.postMessage = (
    message: unknown,
    transfer?: Transferable[]
  ): Promise<MessageEvent<unknown>> =>
    postMessage(message, transfer).then((event: MessageEvent<unknown>): MessageEvent<unknown> => {
      const reply = event.data;
      // The pinned loader reads success data before checking worker errors.
      if (
        typeof reply === 'object' &&
        reply !== null &&
        'type' in reply &&
        reply.type === 'error' &&
        'error' in reply
      )
        throw reply.error;
      return event;
    });
  const session = {
    decoder,
    tail: Promise.resolve(),
    abort: new AbortController(),
    disposal: null,
  };
  sessions.set(renderer, session);
  return session;
}

/** Fetch immediately; only parsing/transcoding is queued to bound peak memory.
 * One renderer-scoped Basis worker pool survives across the whole boot batch.
 */
export function loadWeaponGLTF(renderer: FeatureRenderer, url: string): Promise<GLTF> {
  const session = sessionFor(renderer);
  const download = fetch(url, { signal: session.abort.signal }).then(
    async (response): Promise<ArrayBuffer> => {
      if (!response.ok) throw new Error(`[weapons] failed to load ${url}: HTTP ${response.status}`);
      return response.arrayBuffer();
    }
  );
  // A later download can fail before its turn in the parse queue.
  void download.catch((): void => {});
  const loaded = session.tail.then(async (): Promise<GLTF> => {
    const data = await download;
    if (session.abort.signal.aborted) throw new Error('Weapon loader closed');
    return parseGLTF(session.decoder, data, LoaderUtils.extractUrlBase(url));
  });
  session.tail = loaded.then(
    (): void => {},
    (): void => {}
  );
  return loaded;
}

/** Called after boot loading, or on initialization failure/teardown. */
export function disposeWeaponLoader(renderer: FeatureRenderer): Promise<void> {
  const session = sessions.get(renderer);
  if (!session) return Promise.resolve();
  if (session.disposal) return session.disposal;
  session.abort.abort();
  session.disposal = (async (): Promise<void> => {
    await session.tail;
    // Do not decrement Three's active-loader count for PNG-only diagnostic loads.
    if (session.decoder.transcoderPending) {
      await session.decoder.transcoderPending.catch((): void => {});
      session.decoder.dispose();
    }
    sessions.delete(renderer);
  })();
  return session.disposal;
}

async function parseGLTF(decoder: KTX2Loader, data: ArrayBuffer, path: string): Promise<GLTF> {
  // Per-model callback scope only: this facade never initializes a transcoder
  // or starts workers. Late callbacks from a failed GLTF cannot contaminate the
  // next model's errors or enqueue work after this scope has closed.
  const textures = new KTX2Loader();
  textures.workerConfig = decoder.workerConfig;
  let closed = false;
  let completed = false;
  const closedError = new Error('Weapon texture scope closed');
  let textureFailed = false;
  let textureFailure: unknown;
  const pending: Promise<CompressedTexture>[] = [];
  const recordFailure = (error: unknown): void => {
    if (!textureFailed) {
      textureFailed = true;
      textureFailure = error;
    }
  };
  textures.parse = (buffer, onLoad, onError): void => {
    if (closed) {
      onError?.(closedError);
      return;
    }
    const task = new Promise<CompressedTexture>((resolve, reject): void => {
      decoder.parse(buffer, resolve, reject);
    });
    pending.push(task);
    void task.then(
      (texture): void => {
        if (!closed) onLoad?.(texture);
      },
      (error: unknown): void => {
        recordFailure(error);
        onError?.(error);
      }
    );
  };
  const loadTexture = textures.load.bind(textures);
  textures.load = (source, onLoad, onProgress, onError): void => {
    if (closed) {
      onError?.(closedError);
      return;
    }
    loadTexture(source, onLoad, onProgress, (error): void => {
      recordFailure(error);
      onError?.(error);
    });
  };
  try {
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(textures)
      .parseAsync(data, path);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- set by the KTX2 loader callback
    if (textureFailed) throw textureFailure;
    completed = true;
    return gltf;
  } finally {
    closed = true;
    const results = await Promise.allSettled(pending);
    if (!completed)
      for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
  }
}
