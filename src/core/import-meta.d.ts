// Bun bundler extensions; raw source imports see neither value.
interface ImportMeta {
  /** Fixed at build/dev-server startup; absent when imported without the build plugin. */
  readonly BUILD_REVISION?: string;
  /** Its HMR client awaits a returned promise before replacing modules. */
  readonly hot?: { dispose(callback: (data: unknown) => void | Promise<void>): void };
}
