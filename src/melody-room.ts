// Per-session MelodyRoom Durable Object.
//
// Holds the RoomState snapshot, owner-token gate, and an SSE subscriber
// set for live fan-out. Mutations are routed through applyAction (the
// same pure logic the clients use), so transition rules live in exactly
// one place. Storage mirrors are written on every mutation so a cold
// boot rehydrates without losing state.

import { DurableObject } from 'cloudflare:workers';
import type { Env, RoomState } from './types';
// applyAction is bundled by Wrangler at deploy and resolved by Vitest's
// workers-pool. Re-implementing it here would split the source of truth.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- bundled JS module, no .d.ts shipped.
import { applyAction } from '../public/static/js/logic.js';
// @ts-expect-error -- bundled JS module, no .d.ts shipped.
import { initialState } from '../public/static/js/state.js';

const STATE_KEY = 'state';
const META_KEY = 'meta';
const HEARTBEAT_MS = 25_000;

interface Meta {
  ownerToken: string | null;
}

interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  alive: boolean;
}

const ENCODER = new TextEncoder();
const HEARTBEAT_FRAME = ENCODER.encode(': keep-alive\n\n');

function sseStateFrame(state: RoomState): Uint8Array {
  return ENCODER.encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export class MelodyRoom extends DurableObject<Env> {
  #state: RoomState = initialState() as RoomState;
  #meta: Meta = { ownerToken: null };
  #subscribers = new Set<Subscriber>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const [s, m] = await Promise.all([
        ctx.storage.get<RoomState>(STATE_KEY),
        ctx.storage.get<Meta>(META_KEY),
      ]);
      if (s) this.#state = s;
      if (m) this.#meta = m;
    });
  }

  override async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const method = req.method;

    if (method === 'POST' && pathname === '/init') return this.#handleInit(req);
    if (method === 'GET' && pathname === '/state') return Response.json(this.#state);
    if (method === 'POST' && pathname === '/state') return this.#handleMutation(req);
    if (method === 'GET' && pathname === '/events') return this.#handleEvents();

    return new Response('not found', { status: 404 });
  }

  async #handleInit(req: Request): Promise<Response> {
    const body = await safeJson(req);
    if (
      body === null ||
      typeof body !== 'object' ||
      typeof (body as { ownerToken?: unknown }).ownerToken !== 'string'
    ) {
      return new Response('bad json', { status: 400 });
    }
    // One-shot: prevents hijack by re-init from anyone who can reach the DO.
    if (this.#meta.ownerToken !== null) {
      return new Response('already initialised', { status: 409 });
    }
    this.#meta = { ownerToken: (body as { ownerToken: string }).ownerToken };
    await this.ctx.storage.put(META_KEY, this.#meta);
    return new Response('ok');
  }

  async #handleMutation(req: Request): Promise<Response> {
    if (this.#meta.ownerToken === null) {
      return new Response('uninitialised', { status: 403 });
    }
    const provided = req.headers.get('x-owner-token');
    if (provided !== this.#meta.ownerToken) {
      return new Response('forbidden', { status: 403 });
    }
    const payload = await safeJson(req);
    if (payload === null || typeof payload !== 'object') {
      return new Response('bad json', { status: 400 });
    }

    let next: RoomState;
    try {
      next = applyAction(this.#state, payload) as RoomState;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'invalid action';
      return new Response(msg, { status: 409 });
    }
    this.#state = next;
    await this.ctx.storage.put(STATE_KEY, this.#state);
    this.#broadcast();
    return Response.json(this.#state);
  }

  #handleEvents(): Response {
    let sub: Subscriber | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        sub = { controller, alive: true };
        this.#subscribers.add(sub);
        // Bootstrap: late joiners see current snapshot without a round-trip.
        try {
          controller.enqueue(sseStateFrame(this.#state));
        } catch {
          sub.alive = false;
          this.#subscribers.delete(sub);
        }
        void this.#scheduleHeartbeat();
      },
      cancel: () => {
        if (sub) {
          sub.alive = false;
          this.#subscribers.delete(sub);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  override async alarm(): Promise<void> {
    this.#fanOut(HEARTBEAT_FRAME);
    // Reschedule unconditionally: the alarm slot was just consumed by the
    // runtime, so there is nothing to coalesce against.
    if (this.#subscribers.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    }
  }

  #broadcast(): void {
    this.#fanOut(sseStateFrame(this.#state));
  }

  #fanOut(frame: Uint8Array): void {
    const dead: Subscriber[] = [];
    for (const sub of this.#subscribers) {
      if (!sub.alive) {
        dead.push(sub);
        continue;
      }
      try {
        sub.controller.enqueue(frame);
      } catch {
        sub.alive = false;
        dead.push(sub);
      }
    }
    for (const sub of dead) this.#subscribers.delete(sub);
  }

  async #scheduleHeartbeat(): Promise<void> {
    if (this.#subscribers.size === 0) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    }
  }
}
