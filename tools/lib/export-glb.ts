import type { Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Bun and Node lack FileReader. GLTFExporter binary output only needs this small
// Blob adapter, not the browser's full FileReader API. Install it before exporting;
// defer onloadend so the exporter can assign its callback after starting the read.
if (typeof globalThis.FileReader === 'undefined') {
  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    writable: true,
    value: class {
      result: ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;

      readAsArrayBuffer(blob: Blob): void {
        void blob.arrayBuffer().then((result): void => {
          this.result = result;
          queueMicrotask((): void => this.onloadend?.());
        });
      }
    },
  });
}

export async function exportGlb(scene: Object3D): Promise<Buffer> {
  const value = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(value instanceof ArrayBuffer))
    throw new Error('[assets] exporter did not produce a binary GLB');
  return Buffer.from(value);
}
