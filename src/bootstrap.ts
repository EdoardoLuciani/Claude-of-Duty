declare global {
  interface Window {
    __STARTUP__: {
      stage(text: 'Loading world and assets…' | 'Preparing graphics…'): void;
      complete(): void;
      terminal(): void;
      fail(error: unknown): void;
    };
  }
}

// Keep the entry graph inside this rejection boundary, including module fetch,
// evaluation and top-level boot work. Later gameplay errors belong to Engine.
try {
  await import('./main.ts');
} catch (error) {
  window.__STARTUP__.fail(error);
  throw error;
}

export {};
