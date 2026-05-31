// Worker entry. All dispatch lives in `router.ts`; this file exists only to
// satisfy the runtime's ExportedHandler shape and re-export the DO class so
// the new_sqlite_classes migration in wrangler.toml resolves.

import { route } from './router';
import { deleteSessionsOlderThan } from './catalog/sessions';
import type { Env } from './types';

export { MelodyRoom } from './melody-room';

// Registry rows are advisory snapshots; a live DO re-registers on its next
// mutation. The daily cron sweeps rows untouched for this long so the admin
// Live Game list doesn't accumulate abandoned games.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export default {
  fetch(req, env, ctx) {
    return route(req, env, ctx);
  },
  async scheduled(_controller, env, _ctx) {
    await deleteSessionsOlderThan(env.CATALOG, Date.now() - SESSION_TTL_MS);
  },
} satisfies ExportedHandler<Env>;
