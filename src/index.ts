// Worker entry. Static assets are served via ASSETS; admin routes go to the
// dedicated admin dispatcher. /api/* and /s/* are reserved for later phases
// and currently return 404. The DO class is re-exported so the
// new_sqlite_classes migration in wrangler.toml resolves.

import { handleAdmin } from './admin/handlers';
import type { Env } from './types';

export { MelodyRoom } from './melody-room';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return handleAdmin(req, env, ctx);
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/s/')) {
      return new Response('not found', { status: 404 });
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
