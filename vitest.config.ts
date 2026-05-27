import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Migrations are read from disk by the pool (Node side) and surfaced as a
// test-only `TEST_MIGRATIONS` binding so the setup file can apply them to the
// ephemeral D1 instance via `applyD1Migrations`.
export default defineConfig({
  test: {
    include: ['tests/worker/**/*.{spec,test}.ts'],
    setupFiles: ['./tests/worker/setup-d1.ts'],
  },
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, 'db', 'migrations'),
      );
      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // ADMIN_PASSWORD is a plain var (not a secret) for the worker tests;
          // wrangler.toml does not define it, so we inject it here so the
          // admin handler tests can use a known credential.
          bindings: { TEST_MIGRATIONS: migrations, ADMIN_PASSWORD: 'test-pw' },
        },
      };
    }),
  ],
});
