// Offline canvas fixtures must supply nominal image instances just as browsers do.
// This double stays in tests; production checks the realm's ImageBitmap constructor.
export class FixtureImageBitmap {
  constructor({ width, height, data }) {
    this.width = width;
    this.height = height;
    this.data = data;
  }

  close() {}
}

export function installImageBitmapFixture() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ImageBitmap');
  Object.defineProperty(globalThis, 'ImageBitmap', {
    configurable: true,
    writable: true,
    value: FixtureImageBitmap,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'ImageBitmap', previous);
    else delete globalThis.ImageBitmap;
  };
}
