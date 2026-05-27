// Worker entry point. Phase 1 scaffold: the DO class is declared so the
// `new_sqlite_classes` migration in wrangler.toml resolves, and the fetch
// handler defers everything to the static ASSETS binding. Real routing
// lands in later phases.

import { DurableObject } from 'cloudflare:workers';

interface Env {
  ASSETS: Fetcher;
  AUDIO: R2Bucket;
  CATALOG: D1Database;
  MELODY_ROOM: DurableObjectNamespace<MelodyRoom>;
  SESSION_RATE_LIMITER: RateLimit;
}

export class MelodyRoom extends DurableObject {}

export default {
  async fetch(request, env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
