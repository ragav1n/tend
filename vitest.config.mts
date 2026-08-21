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

    /**
     * One zone for the whole suite, or a date test passes in New York and fails
     * in Auckland.
     *
     * `toLocaleDateString` reads the system zone, so an assertion on a rendered
     * day is an assertion about where the machine is. Pinned here rather than
     * worked around per file, because the same trap catches anything that
     * formats an instant. The app's own wall-clock rules are unaffected: a task
     * due 9am is due at 9am wherever it is read, and the reminder pipeline
     * asserts UTC instants as literals for exactly that reason.
     */
    env: { TZ: 'UTC' },

    /**
     * Bounded parallelism, because three of these files boot a Postgres.
     *
     * `bootPostgres()` starts PGlite, a whole Postgres compiled to wasm, once
     * per file, and six more files stand up a jsdom. Left to run one worker per
     * core the suite would occasionally exhaust the machine and fail eight tests
     * across four files at once, including files that never finished loading.
     * That looks exactly like a real bug and is not one, which is worse than
     * being slow: a suite people learn to re-run is a suite that stops being
     * evidence.
     *
     * Four is measured rather than picked. It keeps the wall time inside a
     * second of the unbounded run on a 12 core machine and has not flaked.
     */
    maxWorkers: 4,

    /**
     * The Postgres files earn a longer leash. Seven seconds is the whole
     * convergence suite when it has the machine to itself, and the default five
     * per test is close enough to that to lose a race it should win.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
