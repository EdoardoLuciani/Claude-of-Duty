// Bundler extensions; raw Node imports of the same sources see neither property.
interface ImportMeta {
  /** Bun dev server only. Its HMR client awaits a returned promise before replacing modules. */
  readonly hot?: { dispose(callback: (data: unknown) => void | Promise<void>): void };
  /** Bundles only: build/bun-plugin.mjs replaces each call with `{ './match': hashedUrl }`. */
  readonly glob?: (pattern: string) => Readonly<Record<string, string>>;
}
