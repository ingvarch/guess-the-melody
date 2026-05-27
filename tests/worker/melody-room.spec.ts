// MelodyRoom DO contract: state storage, owner-token gate, SSE fan-out.
// These tests speak to the DO directly via internal HTTP routes that the
// Worker calls in later phases.

import { describe, it, expect } from 'vitest';
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import type { Env, RoomState } from '../../src/types';

// `cloudflare:test` types `env` as the empty `Cloudflare.Env`; our project
// hasn't run `wrangler types` so we cast once for binding access.
const testEnv = env as unknown as Env;

function roomStub(sessionId: string) {
  const id = testEnv.MELODY_ROOM.idFromName(sessionId);
  return testEnv.MELODY_ROOM.get(id);
}

// `URL` constructor needs an origin; the DO's fetch only inspects the path.
const BASE = 'https://do.local';

interface ChunkReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

async function readNextStateEvent(reader: ChunkReader): Promise<RoomState> {
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error('SSE stream closed before any state event');
    buf += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buf.indexOf('\n\n');
      if (idx < 0) break;
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = event.split('\n');
      const isStateEvent = lines.some((l) => l === 'event: state');
      if (!isStateEvent) continue;
      const dataLines = lines
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice('data: '.length));
      if (dataLines.length > 0) {
        return JSON.parse(dataLines.join('\n')) as RoomState;
      }
    }
  }
}

describe('MelodyRoom DO', () => {
  it('returns initial idle state on a fresh room', async () => {
    const stub = roomStub('session-initial');
    const res = await stub.fetch(`${BASE}/state`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoomState;
    expect(state.phase).toBe('idle');
    expect(state.teams).toEqual([]);
    expect(state.selectedGenre).toBeNull();
    expect(state.currentTrack).toBeNull();
    expect(state.revealedTrack).toBeNull();
    expect(state.playedTrackIds).toEqual([]);
    expect(state.spinSeed).toBe(0);
    expect(state.audioStartTimestamp).toBeNull();
  });

  it('accepts a mutation after /init when X-Owner-Token matches', async () => {
    const stub = roomStub('session-init-mutate');
    const init = await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'x' }),
    });
    expect(init.status).toBe(200);

    const post = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Cats' }),
    });
    expect(post.status).toBe(200);

    const get = await stub.fetch(`${BASE}/state`);
    const state = (await get.json()) as RoomState;
    expect(state.teams).toEqual([{ id: 't1', name: 'Cats', score: 0 }]);
  });

  it('returns 403 on mutation without X-Owner-Token after /init', async () => {
    const stub = roomStub('session-no-token');
    await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'x' }),
    });

    const res = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Cats' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 on mutation with wrong X-Owner-Token', async () => {
    const stub = roomStub('session-wrong-token');
    await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'x' }),
    });

    const res = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'wrong' },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Cats' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 409 on invalid transition (play from idle)', async () => {
    const stub = roomStub('session-invalid');
    await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'x' }),
    });

    const res = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({ action: 'play', now: 1000 }),
    });
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toMatch(/invalid transition/i);
  });

  it('persists state across stub re-acquisition for the same session id', async () => {
    const sid = 'session-persist';
    const first = roomStub(sid);
    await first.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'x' }),
    });
    await first.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({ action: 'team.add', id: 'tp', name: 'Persistent' }),
    });

    // Re-derive the stub: same id, same DO instance + storage.
    const second = roomStub(sid);
    const get = await second.fetch(`${BASE}/state`);
    const state = (await get.json()) as RoomState;
    expect(state.teams).toEqual([{ id: 'tp', name: 'Persistent', score: 0 }]);
  });

  it('opens an SSE stream that emits the current state immediately', async () => {
    const stub = roomStub('session-sse-bootstrap');
    const res = await stub.fetch(`${BASE}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('Cache-Control')).toMatch(/no-cache/);

    const reader = res.body!.getReader();
    const initial = await readNextStateEvent(reader);
    expect(initial.phase).toBe('idle');
    expect(initial.teams).toEqual([]);
    await reader.cancel();
  });

  it('broadcasts state mutations to SSE subscribers', async () => {
    const stub = roomStub('session-sse-broadcast');
    await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'x' }),
    });

    const sse = await stub.fetch(`${BASE}/events`);
    const reader = sse.body!.getReader();
    const bootstrap = await readNextStateEvent(reader);
    expect(bootstrap.teams).toEqual([]);

    const post = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({ action: 'team.add', id: 'tb', name: 'Broadcast' }),
    });
    expect(post.status).toBe(200);

    const next = await readNextStateEvent(reader);
    expect(next.teams).toEqual([{ id: 'tb', name: 'Broadcast', score: 0 }]);
    await reader.cancel();
  });

  it('rejects /init with a non-object JSON body', async () => {
    const stub = roomStub('session-init-string');
    const res = await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify('not-an-object'),
    });
    expect(res.status).toBe(400);
  });

  it('rejects /init when ownerToken is missing from the body', async () => {
    const stub = roomStub('session-init-missing');
    const res = await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 on mutation before /init has been called', async () => {
    const stub = roomStub('session-mutation-pre-init');
    const res = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'anything' },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'X' }),
    });
    expect(res.status).toBe(403);
  });

  it('broadcasts mutations to every connected SSE subscriber', async () => {
    const stub = roomStub('session-sse-multi');
    await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'x' }),
    });

    const sseA = await stub.fetch(`${BASE}/events`);
    const sseB = await stub.fetch(`${BASE}/events`);
    const readerA = sseA.body!.getReader();
    const readerB = sseB.body!.getReader();

    // Drain bootstrap on both.
    await readNextStateEvent(readerA);
    await readNextStateEvent(readerB);

    const post = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({ action: 'team.add', id: 'tm', name: 'Multi' }),
    });
    expect(post.status).toBe(200);

    const nextA = await readNextStateEvent(readerA);
    const nextB = await readNextStateEvent(readerB);
    expect(nextA.teams).toEqual([{ id: 'tm', name: 'Multi', score: 0 }]);
    expect(nextB.teams).toEqual([{ id: 'tm', name: 'Multi', score: 0 }]);

    await readerA.cancel();
    await readerB.cancel();
  });

  it('alarm fan-out delivers a keep-alive chunk and reschedules itself', async () => {
    const stub = roomStub('session-heartbeat');
    const sse = await stub.fetch(`${BASE}/events`);
    const reader = sse.body!.getReader();
    // Drain bootstrap state event so the next chunk is the heartbeat.
    await readNextStateEvent(reader);

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const decoder = new TextDecoder();
    let acc = '';
    while (!acc.includes(': keep-alive')) {
      const { done, value } = await reader.read();
      if (done) throw new Error('SSE closed before heartbeat arrived');
      acc += decoder.decode(value, { stream: true });
    }
    expect(acc).toMatch(/: keep-alive\n\n/);

    // A new alarm must be queued because there's still a live subscriber.
    const next = await runInDurableObject(stub, async (_inst, state) => {
      return state.storage.getAlarm();
    });
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(Date.now());

    await reader.cancel();
  });

  it('rejects a second /init and keeps the original ownerToken', async () => {
    const stub = roomStub('session-reinit');
    const first = await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'first' }),
    });
    expect(first.status).toBe(200);

    const second = await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'second' }),
    });
    expect(second.status).toBe(409);

    // Original token still works.
    const ok = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'first' },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'A' }),
    });
    expect(ok.status).toBe(200);

    // New token is rejected.
    const bad = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'second' },
      body: JSON.stringify({ action: 'team.add', id: 't2', name: 'B' }),
    });
    expect(bad.status).toBe(403);
  });

  it('endgame without resetScores preserves teams and scores', async () => {
    const stub = roomStub('session-endgame');
    await stub.fetch(`${BASE}/init`, {
      method: 'POST',
      body: JSON.stringify({ ownerToken: 'x' }),
    });

    // Build up: add team, spin, play, reveal, award.
    await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({ action: 'team.add', id: 'te', name: 'Endteam' }),
    });
    await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({
        action: 'spin',
        selectedGenre: 'rock',
        trackId: 'tr-1',
        spinSeed: 42,
      }),
    });
    await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({ action: 'play', now: 10_000 }),
    });
    await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({
        action: 'award',
        teamId: 'te',
        points: 2,
      }),
    });

    const endRes = await stub.fetch(`${BASE}/state`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'x' },
      body: JSON.stringify({ action: 'endgame', resetScores: false }),
    });
    expect(endRes.status).toBe(200);

    const get = await stub.fetch(`${BASE}/state`);
    const state = (await get.json()) as RoomState;
    expect(state.phase).toBe('idle');
    expect(state.teams).toEqual([{ id: 'te', name: 'Endteam', score: 2 }]);
    expect(state.selectedGenre).toBeNull();
    expect(state.currentTrack).toBeNull();
  });
});
