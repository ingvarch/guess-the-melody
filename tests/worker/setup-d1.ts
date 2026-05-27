// Vitest setup file. Applies D1 migrations from disk (passed in via the
// `TEST_MIGRATIONS` test-only binding configured in vitest.config.ts) to the
// ephemeral D1 instance once per test file. Subsequent calls are no-ops
// because `applyD1Migrations` records applied migrations in `d1_migrations`.

import { beforeAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from 'cloudflare:test';

// `cloudflare:test` env is typed as the empty `Cloudflare.Env`; the project
// hasn't run `wrangler types`, and `TEST_MIGRATIONS` is a synthetic test-only
// binding that wrangler does not know about. One cast is the minimum here.
const testEnv = env as unknown as {
  CATALOG: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

beforeAll(async () => {
  await applyD1Migrations(testEnv.CATALOG, testEnv.TEST_MIGRATIONS);
});
