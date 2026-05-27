// Per-session game-room Durable Object. Phase 4 stub: returns 501 for any
// request. Real game logic and storage land in later phases.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types';

export class MelodyRoom extends DurableObject<Env> {
  override async fetch(_req: Request): Promise<Response> {
    return new Response('not implemented', { status: 501 });
  }
}
