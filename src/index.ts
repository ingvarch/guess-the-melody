// Worker entry. All dispatch lives in `router.ts`; this file exists only to
// satisfy the runtime's ExportedHandler shape and re-export the DO class so
// the new_sqlite_classes migration in wrangler.toml resolves.

import { route } from './router';
import type { Env } from './types';

export { MelodyRoom } from './melody-room';

export default {
  fetch(req, env, ctx) {
    return route(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
