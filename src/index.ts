// Worker entry. Phase 4 scaffold: static assets are served via ASSETS;
// API/session/admin paths are reserved and return 404 until later phases
// wire up real handlers. The DO class is re-exported so the
// new_sqlite_classes migration in wrangler.toml resolves.

import type { Env } from './types';

export { MelodyRoom } from './melody-room';

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/s/') ||
      url.pathname.startsWith('/admin/') ||
      url.pathname === '/admin'
    ) {
      return new Response('not found', { status: 404 });
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
