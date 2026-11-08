// Bun dev server extension; raw Node imports of the same sources see no `hot`.
interface ImportMeta {
  /** Its HMR client awaits a returned promise before replacing modules. */
  readonly hot?: { dispose(callback: (data: unknown) => void | Promise<void>): void };
}
