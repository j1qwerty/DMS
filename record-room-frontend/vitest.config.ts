import { defineConfig } from 'vitest/config';

/*
 * Vitest picks this file over `vite.config.ts`, so the suites do not inherit
 * the dev server's plugins or the developer's `.env.local`.
 *
 * The mode is pinned to the in-memory adapter: the service suites run in a
 * node environment (no `window`, which the HTTP reset path needs), and a
 * `VITE_API_MODE=http` in `.env.local` would flip them onto the API. The live
 * API is covered deliberately and explicitly by tests/api-contract.test.ts.
 */
export default defineConfig({
  test: {
    environment: 'node',
    env: {
      VITE_API_MODE: 'local',
    },
  },
});
