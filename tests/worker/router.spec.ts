// Router (Phase 8): user-facing surface that wires session create, the
// MelodyRoom DO proxy, R2 audio streaming, and the host/display HTML shells.
// All tests drive the real Worker via SELF.fetch so we exercise the same
// dispatch path real clients hit.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import type { Env, RoomState } from '../../src/types';
import { insertTrack } from '../../src/catalog/tracks';

const testEnv = env as unknown as Env;

interface SessionCreated {
  sessionId: string;
  ownerCookie: string;
  ownerToken: string;
}

function parseOwnerFromSetCookie(setCookie: string): string {
  const m = /(?:^|;\s*)owner=([^;]+)/.exec(setCookie);
  if (!m) throw new Error(`no owner= in Set-Cookie: ${setCookie}`);
  return m[1]!;
}

async function createSession(): Promise<SessionCreated> {
  const res = await SELF.fetch('http://localhost/api/session', { method: 'POST' });
  if (res.status !== 200) {
    throw new Error(`session create failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('missing Set-Cookie on session create');
  const body = (await res.json()) as { sessionId: string };
  return {
    sessionId: body.sessionId,
    ownerCookie: `owner=${parseOwnerFromSetCookie(setCookie)}`,
    ownerToken: parseOwnerFromSetCookie(setCookie),
  };
}

async function clearAudio(): Promise<void> {
  const list = await testEnv.AUDIO.list();
  for (const obj of list.objects) {
    await testEnv.AUDIO.delete(obj.key);
  }
}

async function resetCatalog(): Promise<void> {
  await testEnv.CATALOG.exec('DELETE FROM tracks');
  await clearAudio();
}

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

describe('Worker router', () => {
  beforeEach(async () => {
    await resetCatalog();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /api/session returns 200 with sessionId and an owner Set-Cookie scoped to /s/<id>/', async () => {
    const res = await SELF.fetch('http://localhost/api/session', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string };
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(0);

    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie!).toMatch(/^owner=[^;]+/);
    expect(setCookie!).toContain(`Path=/s/${body.sessionId}/`);
    expect(setCookie!).toContain('HttpOnly');
    expect(setCookie!).toContain('Secure');
    expect(setCookie!).toContain('SameSite=Strict');
  });

  it('POST /s/<id>/api/state with the owner cookie succeeds (team.add)', async () => {
    const { sessionId, ownerCookie } = await createSession();
    const res = await SELF.fetch(`http://localhost/s/${sessionId}/api/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Cats' }),
    });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoomState;
    expect(state.teams).toEqual([{ id: 't1', name: 'Cats', score: 0 }]);
  });

  it('POST /s/<id>/api/state without the owner cookie returns 403', async () => {
    const { sessionId } = await createSession();
    const res = await SELF.fetch(`http://localhost/s/${sessionId}/api/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Cats' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /s/<id>/api/state with the wrong owner cookie returns 403', async () => {
    const { sessionId } = await createSession();
    const res = await SELF.fetch(`http://localhost/s/${sessionId}/api/state`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'owner=deadbeef-wrong-token',
      },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Cats' }),
    });
    expect(res.status).toBe(403);
  });

  it('GET /s/<id>/api/state returns the current room state without auth', async () => {
    const { sessionId, ownerCookie } = await createSession();
    await SELF.fetch(`http://localhost/s/${sessionId}/api/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Cats' }),
    });

    const res = await SELF.fetch(`http://localhost/s/${sessionId}/api/state`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoomState;
    expect(state.teams).toEqual([{ id: 't1', name: 'Cats', score: 0 }]);
  });

  it('GET /s/<id>/api/events returns text/event-stream with an initial state event', async () => {
    const { sessionId } = await createSession();
    const res = await SELF.fetch(`http://localhost/s/${sessionId}/api/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    const initial = await readNextStateEvent(reader);
    expect(initial.phase).toBe('idle');
    await reader.cancel();
  });

  it('GET /s/<id>/api/track/<id>.mp3 returns 200 audio/mpeg when the track + R2 object exist', async () => {
    const { sessionId } = await createSession();
    const trackId = 'tr-router-1';
    const key = `tracks/${trackId}.mp3`;
    const payload = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x01]);
    await testEnv.AUDIO.put(key, payload, {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
    await insertTrack(testEnv.CATALOG, {
      id: trackId,
      genre_slug: 'rock',
      artist: 'A',
      title: 'B',
      year: 2001,
      preview_url: 'https://example.com/p.m4a',
      r2_key: key,
      added_at: 1,
    });

    const res = await SELF.fetch(
      `http://localhost/s/${sessionId}/api/track/${trackId}.mp3`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=31536000/);
    expect(res.headers.get('Cache-Control')).toMatch(/immutable/);
    expect(res.headers.get('Content-Length')).toBe(String(payload.byteLength));
    const got = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(payload));
  });

  it('GET /s/<id>/api/track/<missing>.mp3 returns 404 when the track row is missing', async () => {
    const { sessionId } = await createSession();
    const res = await SELF.fetch(
      `http://localhost/s/${sessionId}/api/track/does-not-exist.mp3`,
    );
    expect(res.status).toBe(404);
  });

  it('GET /s/<id>/api/track/<id>.mp3 returns 404 when r2_key is null', async () => {
    const { sessionId } = await createSession();
    const trackId = 'tr-no-r2';
    await insertTrack(testEnv.CATALOG, {
      id: trackId,
      genre_slug: 'rock',
      artist: 'A',
      title: 'B',
      year: 2001,
      preview_url: 'https://example.com/p.m4a',
      added_at: 1,
    });
    const res = await SELF.fetch(
      `http://localhost/s/${sessionId}/api/track/${trackId}.mp3`,
    );
    expect(res.status).toBe(404);
  });

  it('GET /s/<id>/ returns 200 HTML with <meta name="session-id" content="<id>">', async () => {
    const { sessionId } = await createSession();
    const res = await SELF.fetch(`http://localhost/s/${sessionId}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const text = await res.text();
    expect(text).toContain(`<meta name="session-id" content="${sessionId}">`);
  });

  it('GET /s/<id>/ runs HTMLRewriter on the host.html asset and preserves original content', async () => {
    // why: public/host.html does not exist yet, so the live router falls through
    // to placeholderShell and the HTMLRewriter branch is never exercised. Override
    // ASSETS.fetch to return a real HTML body so we cover the rewriter path.
    const { sessionId } = await createSession();
    const assetHtml =
      '<!doctype html><html><head><title>Host</title></head>' +
      '<body><h1>host</h1></body></html>';
    const wrappedEnv = {
      ...testEnv,
      ASSETS: {
        async fetch(_req: Request) {
          return new Response(assetHtml, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        },
      } as unknown as Fetcher,
    } as Env;
    const { route } = await import('../../src/router');
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const res = await route(
      new Request(`http://localhost/s/${sessionId}/`, { method: 'GET' }),
      wrappedEnv,
      ctx,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<title>Host</title>');
    expect(text).toContain(`<meta name="session-id" content="${sessionId}">`);
  });

  it('GET /s/<id>/display returns 200 HTML with the session-id meta tag', async () => {
    const { sessionId } = await createSession();
    const res = await SELF.fetch(`http://localhost/s/${sessionId}/display`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const text = await res.text();
    expect(text).toContain(`<meta name="session-id" content="${sessionId}">`);
  });

  it('GET /s/<id>/qr.svg is deferred to Phase 13 and returns 501', async () => {
    const { sessionId } = await createSession();
    const res = await SELF.fetch(`http://localhost/s/${sessionId}/qr.svg`);
    expect(res.status).toBe(501);
  });

  it('GET /admin/api/genres still works through the router (regression)', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres', {
      headers: { authorization: 'Basic ' + btoa('admin:test-pw') },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ slug: string }>;
    expect(body.map((g) => g.slug)).toContain('rock');
  });

  it('GET / serves the landing page with title and main-landing.js module', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const body = await res.text();
    expect(body).toContain('Угадай мелодию');
    expect(body).toContain(
      '<script type="module" src="/static/js/main-landing.js">',
    );
  });

  it('POST /api/session returns 429 when SESSION_RATE_LIMITER reports success=false', async () => {
    const ratelimited = {
      ...testEnv,
      SESSION_RATE_LIMITER: {
        async limit(_opts: { key: string }) {
          return { success: false };
        },
      } as unknown as RateLimit,
    };
    const { route } = await import('../../src/router');
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const res = await route(
      new Request('http://localhost/api/session', { method: 'POST' }),
      ratelimited,
      ctx,
    );
    expect(res.status).toBe(429);
  });
});
