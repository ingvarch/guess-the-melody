// Per-session MelodyRoom Durable Object.
//
// Holds the RoomState snapshot, owner-token gate, and an SSE subscriber
// set for live fan-out. Mutations are routed through applyAction (the
// same pure logic the clients use), so transition rules live in exactly
// one place. Storage mirrors are written on every mutation so a cold
// boot rehydrates without losing state.

import { DurableObject } from 'cloudflare:workers';
import { getTrack, pickRandomTrack } from './catalog/tracks';
import { upsertSession } from './catalog/sessions';
import { boostedGenre } from './spin-boost';
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
  sessionId: string | null;
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
  #meta: Meta = { ownerToken: null, sessionId: null };
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
    const b = body as { ownerToken: string; sessionId?: unknown };
    this.#meta = {
      ownerToken: b.ownerToken,
      sessionId: typeof b.sessionId === 'string' ? b.sessionId : null,
    };
    await this.ctx.storage.put(META_KEY, this.#meta);
    return new Response('ok');
  }

  async #handleMutation(req: Request): Promise<Response> {
    // Two ways to authorise a write:
    //   1. the owner token (host's HttpOnly cookie, forwarded by the router), or
    //   2. X-Admin-Override, which the router sets ONLY after basic-auth passes.
    // The DO is reachable solely through the Worker binding, so a header the
    // Worker attaches post-auth is trustworthy; the public state proxy never
    // forwards a client-supplied X-Admin-Override.
    const adminOverride = req.headers.get('x-admin-override') === '1';
    if (!adminOverride) {
      if (this.#meta.ownerToken === null) {
        return new Response('uninitialised', { status: 403 });
      }
      const provided = req.headers.get('x-owner-token');
      if (provided !== this.#meta.ownerToken) {
        return new Response('forbidden', { status: 403 });
      }
    }
    const payload = await safeJson(req);
    if (payload === null || typeof payload !== 'object') {
      return new Response('bad json', { status: 400 });
    }

    // Resolve catalogue-backed actions (spin, reveal) into the fully-populated
    // payload the pure state machine expects. Callers pass only intent; the DO
    // is the single owner of "which track" and "what metadata".
    let effective: Record<string, unknown>;
    try {
      effective = await this.#resolveAction(payload as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'invalid action';
      return new Response(msg, { status: 409 });
    }

    let next: RoomState;
    try {
      next = applyAction(this.#state, effective) as RoomState;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'invalid action';
      return new Response(msg, { status: 409 });
    }
    this.#state = next;
    await this.ctx.storage.put(STATE_KEY, this.#state);
    this.#broadcast();
    await this.#registerSnapshot();
    return Response.json(this.#state);
  }

  // Best-effort write-through to the D1 session registry that backs the admin
  // "Live Game" view. A registry failure must never fail the mutation, so it is
  // swallowed; the snapshot is advisory and will be refreshed on the next write.
  async #registerSnapshot(): Promise<void> {
    if (this.#meta.sessionId === null) return;
    try {
      // Host-private answer for the admin Live Game view. Looked up from the
      // catalogue (the current track's id is the only track ref in RoomState)
      // so the answer never has to live in the broadcast state where the
      // public /display would leak it. Null when no round is in progress.
      let currentAnswer = null;
      const current = this.#state.currentTrack;
      if (current !== null) {
        const track = await getTrack(this.env.CATALOG, current.id);
        if (track !== null) {
          currentAnswer = { artist: track.artist, title: track.title, year: track.year };
        }
      }
      await upsertSession(this.env.CATALOG, {
        id: this.#meta.sessionId,
        now: Date.now(),
        phase: this.#state.phase,
        selectedGenre: this.#state.selectedGenre,
        roundsPlayed: this.#state.playedTrackIds.length,
        teams: this.#state.teams.map((t) => ({ name: t.name, score: t.score })),
        currentAnswer,
      });
    } catch {
      /* advisory registry; ignore write failures */
    }
  }

  async #resolveAction(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (payload['action'] === 'spin') {
      const selectedGenre =
        typeof payload['selectedGenre'] === 'string'
          ? payload['selectedGenre']
          : undefined;
      const opts: { genreSlug?: string; excludeIds?: string[] } = {
        excludeIds: this.#state.playedTrackIds,
      };
      if (selectedGenre !== undefined) opts.genreSlug = selectedGenre;
      // The host's explicit genre wins; the boost only steers auto spins. Once
      // the favoured genre runs dry the spin falls back to the whole catalogue.
      const boosted =
        selectedGenre === undefined ? boostedGenre(payload, Math.random()) : undefined;
      let picked =
        boosted === undefined
          ? null
          : await pickRandomTrack(this.env.CATALOG, { ...opts, genreSlug: boosted });
      picked ??= await pickRandomTrack(this.env.CATALOG, opts);
      if (picked === null) {
        throw new Error('no tracks available');
      }
      const seedBuf = new Uint32Array(1);
      crypto.getRandomValues(seedBuf);
      return {
        action: 'spin',
        selectedGenre: picked.genre_slug,
        // The host chose the genre when it supplied one; auto-spin sends none.
        genrePicked: selectedGenre !== undefined,
        trackId: picked.id,
        spinSeed: seedBuf[0],
      };
    }
    if (
      payload['action'] === 'play' ||
      payload['action'] === 'replay' ||
      payload['action'] === 'pause' ||
      payload['action'] === 'resume' ||
      payload['action'] === 'seek'
    ) {
      // The DO owns the clock; clients never supply a trustworthy `now`.
      return { ...payload, now: Date.now() };
    }
    if (payload['action'] === 'reveal') {
      const current = this.#state.currentTrack;
      if (current === null) {
        throw new Error('no current track');
      }
      const track = await getTrack(this.env.CATALOG, current.id);
      if (track === null) {
        throw new Error('track not found');
      }
      const revealed: { artist: string; title: string; year: number; artworkUrl?: string } = {
        artist: track.artist,
        title: track.title,
        year: track.year,
      };
      if (track.artwork_url !== null) {
        revealed.artworkUrl = track.artwork_url;
      }
      return { action: 'reveal', track: revealed };
    }
    return payload;
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
