import { RepeatWrapping, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Stub image decode, not GLTFLoader's source/sampler texture cache identity. */
export function parseM4(bytes) {
  const loader = new GLTFLoader().register((parser) => {
    const textures = new Map();
    return {
      name: 'M4_NODE_IMAGES',
      loadTexture(index) {
        const definition = parser.json.textures[index];
        const key = `${definition.source}:${definition.sampler}`;
        if (!textures.has(key)) {
          const texture = new Texture();
          texture.name = `image-${definition.source}`;
          texture.flipY = false;
          texture.wrapS = texture.wrapT = RepeatWrapping;
          textures.set(key, texture);
        }
        return Promise.resolve(textures.get(key));
      },
    };
  });
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  );
}
