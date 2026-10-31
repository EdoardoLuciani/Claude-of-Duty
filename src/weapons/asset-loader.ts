import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { Renderer } from 'three/webgpu';

// Deferred weapons load concurrently; serialize transcoding to bound worker/memory use.
let previousLoad: Promise<void> = Promise.resolve();

export function loadWeaponGLTF(renderer: Pick<Renderer, 'hasFeature'>, url: string): Promise<GLTF> {
  const loaded = previousLoad.then((): Promise<GLTF> => loadGLTF(renderer, url));
  previousLoad = loaded.then(
    (): void => {},
    (): void => {}
  );
  return loaded;
}

async function loadGLTF(renderer: Pick<Renderer, 'hasFeature'>, url: string): Promise<GLTF> {
  const decoder = new KTX2Loader().setWorkerLimit(2);
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
  // Image fetches can finish after geometry has already rejected the GLTF load.
  let closed = false;
  const closedError = new Error('Weapon texture decoder closed');
  const init = decoder.init.bind(decoder);
  decoder.init = (): Promise<void> => (closed ? Promise.reject(closedError) : init());
  const transcodes: Promise<MessageEvent<unknown>>[] = [];
  const postMessage = decoder.workerPool.postMessage.bind(decoder.workerPool);
  decoder.workerPool.postMessage = (
    message: unknown,
    transfer?: Transferable[]
  ): Promise<MessageEvent<unknown>> => {
    if (closed) return Promise.reject(closedError);
    const task = postMessage(message, transfer).then(
      (event: MessageEvent<unknown>): MessageEvent<unknown> => {
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
      }
    );
    transcodes.push(task);
    return task;
  };
  // GLTFLoader converts image failures to null textures; retain their original cause.
  let textureFailed = false;
  let textureFailure: unknown;
  const recordTextureFailure = (error: unknown): void => {
    if (!textureFailed) {
      textureFailed = true;
      textureFailure = error;
    }
  };
  // r187 parses embedded KTX2 bufferViews directly, bypassing load().
  const parseTexture = decoder.parse.bind(decoder);
  decoder.parse = (buffer, onLoad, onError): void => {
    try {
      parseTexture(buffer, onLoad, (error): void => {
        recordTextureFailure(error);
        onError?.(error);
      });
    } catch (error) {
      recordTextureFailure(error);
      throw error;
    }
  };
  const loadTexture = decoder.load.bind(decoder);
  decoder.load = (source, onLoad, onProgress, onError): void => {
    loadTexture(source, onLoad, onProgress, (error): void => {
      recordTextureFailure(error);
      onError?.(error);
    });
  };
  // UASTC data maps fall back to RGBA when ASTC/BC7 are unavailable, avoiding
  // lower-quality transcoding of normal/ORM channels into color-only formats.
  try {
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(decoder)
      .loadAsync(url);
    await decoder.transcoderPending;
    if (textureFailed) throw textureFailure;
    return gltf;
  } finally {
    closed = true;
    // PNG diagnostic loads never initialize the decoder or increment its count.
    if (decoder.transcoderPending) {
      // Prevent late worker-URL creation; preserve any load/initialization error.
      await decoder.transcoderPending.catch((): void => {});
      await Promise.allSettled(transcodes);
      decoder.dispose();
    }
  }
}
