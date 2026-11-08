// Offline canvas fixtures must supply nominal image instances just as browsers do.
// This double stays in tests; production checks the realm's ImageBitmap constructor.
export class FixtureImageBitmap implements ImageBitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray | undefined;
  constructor({
    width,
    height,
    data,
  }: {
    width: number;
    height: number;
    data?: Uint8ClampedArray;
  }) {
    this.width = width;
    this.height = height;
    this.data = data;
  }

  close(): void {}
}

export function installImageBitmapFixture(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ImageBitmap');
  Object.defineProperty(globalThis, 'ImageBitmap', {
    configurable: true,
    writable: true,
    value: FixtureImageBitmap,
  });
  return (): void => {
    if (previous) Object.defineProperty(globalThis, 'ImageBitmap', previous);
    else Reflect.deleteProperty(globalThis, 'ImageBitmap');
  };
}
