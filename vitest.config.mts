import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    // Pure logic (db, sync, recurrence, parser) runs in node; component tests
    // opt into jsdom with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['{lib,hooks,components,app}/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
