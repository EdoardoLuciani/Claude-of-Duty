import { defineConfig } from 'vitest/config';

// Separate from vite.config.js so `npm test` does not export models or
// validate the world — those stay on `dev` / `build`.
export default defineConfig({
  test: {
    include: ['tools/smoke-*.test.mjs'],
    environment: 'node',
  },
  resolve: { dedupe: ['three'] },
});
