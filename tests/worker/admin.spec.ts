// Admin HTTP surface. Drives the real Worker entry via SELF.fetch so the
// dispatcher wiring is exercised end-to-end. ADMIN_PASSWORD is injected via
// the miniflare bindings override in vitest.config.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import type { Env } from '../../src/types';
import { insertTrack } from '../../src/catalog/tracks';
import { archiveGenre } from '../../src/catalog/genres';
import { upsertSession } from '../../src/catalog/sessions';

const testEnv = env as unknown as Env;
const PW = 'test-pw';

function authHeader(pw = PW): string {
  return 'Basic ' + btoa(`admin:${pw}`);
}

async function resetCatalog(): Promise<void> {
  await testEnv.CATALOG.exec('DELETE FROM tracks');
  await testEnv.CATALOG.prepare(
    `DELETE FROM genres WHERE slug NOT IN ('rock','pop','hip-hop','soundtrack')`,
  ).run();
  await testEnv.CATALOG.batch([
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Rock', sort_order=10, archived=0 WHERE slug='rock'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Pop', sort_order=20, archived=0 WHERE slug='pop'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Hip-Hop', sort_order=30, archived=0 WHERE slug='hip-hop'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Soundtrack', sort_order=40, archived=0 WHERE slug='soundtrack'`,
    ),
  ]);
  const list = await testEnv.AUDIO.list();
  for (const obj of list.objects) {
    await testEnv.AUDIO.delete(obj.key);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function audioResponse(body: string | Uint8Array): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
}

type Route = {
  match: (url: string) => boolean;
  respond: () => Response | Promise<Response>;
};

function routedFetch(routes: Route[]): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const r of routes) {
      if (r.match(url)) return await r.respond();
    }
    throw new Error(`routedFetch: no route for ${url}`);
  });
}

describe('admin handlers', () => {
  beforeEach(async () => {
    await resetCatalog();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /admin returns 200 placeholder when ASSETS has no admin.html, auth required', async () => {
    const unauth = await SELF.fetch('http://localhost/admin');
    expect(unauth.status).toBe(401);

    const ok = await SELF.fetch('http://localhost/admin', {
      headers: { authorization: authHeader() },
    });
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(text).toMatch(/admin/i);
  });

  it('GET /admin/api/sessions without auth returns 401', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/sessions');
    expect(res.status).toBe(401);
  });

  it('DELETE /admin/api/sessions/:id without auth returns 401', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/sessions/whatever', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('DELETE /admin/api/sessions/:id removes the registry row', async () => {
    await testEnv.CATALOG.exec('DELETE FROM sessions');
    await upsertSession(testEnv.CATALOG, {
      id: 'doomed', now: Date.now(), phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [],
    });
    const del = await SELF.fetch('http://localhost/admin/api/sessions/doomed', {
      method: 'DELETE',
      headers: { authorization: authHeader() },
    });
    expect(del.status).toBe(204);
    const row = await testEnv.CATALOG.prepare('SELECT id FROM sessions WHERE id = ?').bind('doomed').first();
    expect(row).toBeNull();
  });

  it('GET /admin/api/sessions returns the registry newest-first', async () => {
    await testEnv.CATALOG.exec('DELETE FROM sessions');
    await upsertSession(testEnv.CATALOG, {
      id: 'older', now: Date.now() - 1000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [],
    });
    await upsertSession(testEnv.CATALOG, {
      id: 'newer', now: Date.now(), phase: 'playing', selectedGenre: 'rock', roundsPlayed: 3,
      teams: [{ name: 'Cats', score: 7 }],
    });
    const res = await SELF.fetch('http://localhost/admin/api/sessions', {
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; phase: string; teams: unknown }>;
    expect(rows.map((r) => r.id)).toEqual(['newer', 'older']);
    expect(rows[0]!.phase).toBe('playing');
    expect(rows[0]!.teams).toEqual([{ name: 'Cats', score: 7 }]);
  });

  it('GET /admin/api/sessions?activeOnly=1 hides rows older than the active window', async () => {
    await testEnv.CATALOG.exec('DELETE FROM sessions');
    await upsertSession(testEnv.CATALOG, {
      id: 'stale', now: Date.now() - 2 * 60 * 60 * 1000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [],
    });
    await upsertSession(testEnv.CATALOG, {
      id: 'live', now: Date.now(), phase: 'playing', selectedGenre: 'rock', roundsPlayed: 1, teams: [],
    });

    const filtered = await SELF.fetch('http://localhost/admin/api/sessions?activeOnly=1', {
      headers: { authorization: authHeader() },
    });
    expect(filtered.status).toBe(200);
    const liveRows = (await filtered.json()) as Array<{ id: string }>;
    expect(liveRows.map((r) => r.id)).toEqual(['live']);

    // Without the flag the stale row is still listed.
    const all = await SELF.fetch('http://localhost/admin/api/sessions', {
      headers: { authorization: authHeader() },
    });
    const allRows = (await all.json()) as Array<{ id: string }>;
    expect(allRows.map((r) => r.id).sort()).toEqual(['live', 'stale']);
  });

  it('GET /admin/api/sessions exposes the host-private current answer', async () => {
    await testEnv.CATALOG.exec('DELETE FROM sessions');
    await upsertSession(testEnv.CATALOG, {
      id: 'with-answer', now: Date.now(), phase: 'playing', selectedGenre: 'rock', roundsPlayed: 0, teams: [],
      currentAnswer: { artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975 },
    });
    const res = await SELF.fetch('http://localhost/admin/api/sessions', {
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; currentAnswer: unknown }>;
    expect(rows[0]!.currentAnswer).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975 });
  });

  it('GET /admin/console/:id without auth returns 401', async () => {
    const res = await SELF.fetch('http://localhost/admin/console/abc123');
    expect(res.status).toBe(401);
  });

  it('GET /admin/console/:id with auth returns HTML carrying the session-id meta', async () => {
    const res = await SELF.fetch('http://localhost/admin/console/abc123', {
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const text = await res.text();
    expect(text).toContain('<meta name="session-id" content="abc123">');
  });

  it('POST /admin/api/console/:id/action without auth returns 401', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/console/abc/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Cats' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /admin/api/console/:id/action drives the DO by admin password, no owner cookie', async () => {
    // Real session so the DO is initialised with an owner token we never send.
    const created = await SELF.fetch('http://localhost/api/session', { method: 'POST' });
    const { sessionId } = (await created.json()) as { sessionId: string };

    const res = await SELF.fetch(`http://localhost/admin/api/console/${sessionId}/action`, {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'team.add', id: 't1', name: 'Phone' }),
    });
    expect(res.status).toBe(200);

    const state = await SELF.fetch(`http://localhost/s/${sessionId}/api/state`);
    const body = (await state.json()) as { teams: Array<{ name: string }> };
    expect(body.teams.map((t) => t.name)).toEqual(['Phone']);
  });

  it('GET /admin/api/stats without auth returns 401', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/stats');
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/stats returns totals, active count and per-genre counts', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 's1', genre_slug: 'rock', artist: 'A', title: 'T1', year: 2000,
      preview_url: 'https://e/1.m4a', added_at: 1,
    });
    await insertTrack(testEnv.CATALOG, {
      id: 's2', genre_slug: 'rock', artist: 'B', title: 'T2', year: 2001,
      preview_url: 'https://e/2.m4a', added_at: 2,
    });
    await insertTrack(testEnv.CATALOG, {
      id: 's3', genre_slug: 'pop', artist: 'C', title: 'T3', year: 2002,
      preview_url: 'https://e/3.m4a', added_at: 3,
    });
    await archiveGenre(testEnv.CATALOG, 'soundtrack', true);

    const res = await SELF.fetch('http://localhost/admin/api/stats', {
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalTracks: number;
      totalGenres: number;
      activeGenres: number;
      perGenre: Record<string, number>;
    };
    expect(body.totalTracks).toBe(3);
    expect(body.totalGenres).toBe(4);
    expect(body.activeGenres).toBe(3);
    expect(body.perGenre).toEqual({ rock: 2, pop: 1 });
  });

  it('GET /admin/api/genres without auth returns 401', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/Basic/);
  });

  it('GET /admin/api/genres with wrong password returns 401', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres', {
      headers: { authorization: authHeader('wrong') },
    });
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/genres with valid auth returns the seeded genres including archived', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres', {
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ slug: string }>;
    const slugs = body.map((g) => g.slug);
    expect(slugs).toEqual(['rock', 'pop', 'hip-hop', 'soundtrack']);
  });

  it('POST /admin/api/genres creates a genre; GET shows it', async () => {
    const create = await SELF.fetch('http://localhost/admin/api/genres', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'jazz', name: 'Jazz', sortOrder: 60 }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { slug: string; name: string; sort_order: number };
    expect(created.slug).toBe('jazz');
    expect(created.name).toBe('Jazz');
    expect(created.sort_order).toBe(60);

    const list = await SELF.fetch('http://localhost/admin/api/genres', {
      headers: { authorization: authHeader() },
    });
    const genres = (await list.json()) as Array<{ slug: string }>;
    expect(genres.map((g) => g.slug)).toContain('jazz');
  });

  it('POST /admin/api/genres with duplicate slug returns 409', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'rock', name: 'Rock Again', sortOrder: 99 }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('duplicate');
  });

  it('POST /admin/api/genres with bad slug shape returns 400 bad_slug', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'Rock & Roll', name: 'Rock', sortOrder: 100 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_slug');
  });

  it('POST /admin/api/genres with missing fields returns 400', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'incomplete' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /admin/api/genres/:slug renames a genre', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres/rock', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rock & Roll', sortOrder: 11 }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { name: string; sort_order: number };
    expect(updated.name).toBe('Rock & Roll');
    expect(updated.sort_order).toBe(11);
  });

  it('PATCH /admin/api/genres/:slug ignores slug field in body', async () => {
    const create = await SELF.fetch('http://localhost/admin/api/genres', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'jazz', name: 'Jazz', sortOrder: 60 }),
    });
    expect(create.status).toBe(201);

    const patch = await SELF.fetch('http://localhost/admin/api/genres/jazz', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'jazz-new', name: 'Jazzy' }),
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as { slug: string; name: string };
    expect(updated.slug).toBe('jazz');
    expect(updated.name).toBe('Jazzy');

    const stillThere = await SELF.fetch('http://localhost/admin/api/genres', {
      headers: { authorization: authHeader() },
    });
    const list = (await stillThere.json()) as Array<{ slug: string; name: string }>;
    const jazz = list.find((g) => g.slug === 'jazz');
    expect(jazz).toBeDefined();
    expect(jazz!.name).toBe('Jazzy');
    expect(list.find((g) => g.slug === 'jazz-new')).toBeUndefined();
  });

  it('PATCH /admin/api/genres/:slug with unknown slug returns 404', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/genres/does-not-exist', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /admin/api/genres/:slug for an empty genre returns 204', async () => {
    await SELF.fetch('http://localhost/admin/api/genres', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'temp', name: 'Temp', sortOrder: 99 }),
    });
    const res = await SELF.fetch('http://localhost/admin/api/genres/temp', {
      method: 'DELETE',
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(204);
  });

  it('DELETE /admin/api/genres/:slug with tracks returns 409 has_tracks', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-has-tracks',
      genre_slug: 'rock',
      artist: 'A',
      title: 'B',
      year: 2001,
      preview_url: 'https://example.com/p.m4a',
      added_at: 1,
    });
    const res = await SELF.fetch('http://localhost/admin/api/genres/rock', {
      method: 'DELETE',
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('has_tracks');
  });

  it('GET /admin/api/tracks filters by genre', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-rock-a',
      genre_slug: 'rock',
      artist: 'RA',
      title: 'RT',
      year: 2000,
      preview_url: 'https://example.com/ra.m4a',
      added_at: 100,
    });
    await insertTrack(testEnv.CATALOG, {
      id: 't-pop-a',
      genre_slug: 'pop',
      artist: 'PA',
      title: 'PT',
      year: 2001,
      preview_url: 'https://example.com/pa.m4a',
      added_at: 200,
    });

    const res = await SELF.fetch('http://localhost/admin/api/tracks?genre=rock', {
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tracks: Array<{ id: string; genre_slug: string }>;
      total: number;
    };
    expect(body.tracks.map((t) => t.id)).toEqual(['t-rock-a']);
    expect(body.total).toBe(1);
  });

  it('DELETE /admin/api/tracks/:id removes D1 row and R2 object', async () => {
    const id = 't-del-1';
    const key = `tracks/${id}.mp3`;
    await testEnv.AUDIO.put(key, 'preview-bytes', {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
    await insertTrack(testEnv.CATALOG, {
      id,
      genre_slug: 'rock',
      artist: 'DA',
      title: 'DT',
      year: 2002,
      r2_key: key,
      preview_url: 'https://example.com/d.m4a',
      added_at: 300,
    });

    const res = await SELF.fetch(`http://localhost/admin/api/tracks/${id}`, {
      method: 'DELETE',
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(204);

    const row = await testEnv.CATALOG
      .prepare('SELECT id FROM tracks WHERE id = ?')
      .bind(id)
      .first();
    expect(row).toBeNull();

    const obj = await testEnv.AUDIO.get(key);
    expect(obj).toBeNull();
  });

  it('PATCH /admin/api/tracks/:id updates artist, title, year and genre', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-edit-1', genre_slug: 'rock', artist: 'A', title: 'T', year: 2000,
      preview_url: 'https://example.com/e.m4a', added_at: 1,
    });
    const res = await SELF.fetch('http://localhost/admin/api/tracks/t-edit-1', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975, genreSlug: 'pop' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { artist: string; title: string; year: number; genre_slug: string };
    expect(updated.artist).toBe('Queen');
    expect(updated.title).toBe('Bohemian Rhapsody');
    expect(updated.year).toBe(1975);
    expect(updated.genre_slug).toBe('pop');
  });

  it('PATCH /admin/api/tracks/:id without auth returns 401', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/tracks/whatever', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artist: 'X' }),
    });
    expect(res.status).toBe(401);
  });

  it('PATCH /admin/api/tracks/:id returns 404 when missing', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/tracks/nope', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ artist: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /admin/api/tracks/:id returns 400 for an unknown genre', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-edit-g', genre_slug: 'rock', artist: 'A', title: 'T', year: 2000,
      preview_url: 'https://example.com/g.m4a', added_at: 1,
    });
    const res = await SELF.fetch('http://localhost/admin/api/tracks/t-edit-g', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ genreSlug: 'does-not-exist' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unknown_genre');
  });

  it('PATCH /admin/api/tracks/:id returns 400 for an out-of-range year', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-edit-y', genre_slug: 'rock', artist: 'A', title: 'T', year: 2000,
      preview_url: 'https://example.com/y.m4a', added_at: 1,
    });
    const res = await SELF.fetch('http://localhost/admin/api/tracks/t-edit-y', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ year: 1700 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_year');
  });

  it('PATCH /admin/api/tracks/:id returns 400 for an empty artist', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-edit-a', genre_slug: 'rock', artist: 'A', title: 'T', year: 2000,
      preview_url: 'https://example.com/a.m4a', added_at: 1,
    });
    const res = await SELF.fetch('http://localhost/admin/api/tracks/t-edit-a', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ artist: '   ' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_field');
  });

  it('PATCH /admin/api/tracks/:id returns 409 when it collides with another row', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-keep', genre_slug: 'rock', artist: 'Queen', title: 'Yesterday', year: 1965,
      preview_url: 'https://example.com/k.m4a', added_at: 1,
    });
    await insertTrack(testEnv.CATALOG, {
      id: 't-move', genre_slug: 'rock', artist: 'Beatles', title: 'Help', year: 1965,
      preview_url: 'https://example.com/m.m4a', added_at: 2,
    });
    const res = await SELF.fetch('http://localhost/admin/api/tracks/t-move', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ artist: 'Queen', title: 'Yesterday', year: 1965 }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('duplicate');
  });

  it('PATCH /admin/api/tracks/:id returns 400 on malformed JSON', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-edit-j', genre_slug: 'rock', artist: 'A', title: 'T', year: 2000,
      preview_url: 'https://example.com/j.m4a', added_at: 1,
    });
    const res = await SELF.fetch('http://localhost/admin/api/tracks/t-edit-j', {
      method: 'PATCH',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /admin/api/tracks/:id returns 404 when missing', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/tracks/never-here', {
      method: 'DELETE',
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(404);
  });

  it('GET /admin/api/tracks/:id.mp3 returns 200 audio/mpeg from R2', async () => {
    const id = 't-play-1';
    const key = `tracks/${id}.mp3`;
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    await testEnv.AUDIO.put(key, payload, {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
    await insertTrack(testEnv.CATALOG, {
      id,
      genre_slug: 'rock',
      artist: 'PA',
      title: 'PT',
      year: 2010,
      r2_key: key,
      preview_url: 'https://example.com/p.m4a',
      added_at: 400,
    });

    const res = await SELF.fetch(`http://localhost/admin/api/tracks/${id}.mp3`, {
      method: 'GET',
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(payload));
  });

  it('GET /admin/api/tracks/:id.mp3 serves stored content type and honours Range', async () => {
    const id = 't-play-range';
    const key = `tracks/${id}.mp3`;
    const payload = new Uint8Array([20, 21, 22, 23, 24, 25]);
    await testEnv.AUDIO.put(key, payload, {
      httpMetadata: { contentType: 'audio/mp4' },
    });
    await insertTrack(testEnv.CATALOG, {
      id,
      genre_slug: 'rock',
      artist: 'PA',
      title: 'PT',
      year: 2010,
      r2_key: key,
      preview_url: 'https://example.com/p.m4a',
      added_at: 401,
    });

    const full = await SELF.fetch(`http://localhost/admin/api/tracks/${id}.mp3`, {
      method: 'GET',
      headers: { authorization: authHeader() },
    });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');

    const part = await SELF.fetch(`http://localhost/admin/api/tracks/${id}.mp3`, {
      method: 'GET',
      headers: { authorization: authHeader(), Range: 'bytes=1-3' },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 1-3/${payload.byteLength}`);
    const body = new Uint8Array(await part.arrayBuffer());
    expect(Array.from(body)).toEqual([21, 22, 23]);
  });

  it('GET /admin/api/tracks/:id.mp3 returns 401 without auth', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/tracks/some-id.mp3', {
      method: 'GET',
    });
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/tracks/:id.mp3 returns 404 when track missing', async () => {
    const res = await SELF.fetch('http://localhost/admin/api/tracks/nope.mp3', {
      method: 'GET',
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(404);
  });

  it('GET /admin/api/tracks/:id.mp3 returns 404 when r2_key is null', async () => {
    const id = 't-no-r2';
    await insertTrack(testEnv.CATALOG, {
      id,
      genre_slug: 'rock',
      artist: 'NA',
      title: 'NT',
      year: 2011,
      preview_url: 'https://example.com/n.m4a',
      added_at: 401,
    });

    const res = await SELF.fetch(`http://localhost/admin/api/tracks/${id}.mp3`, {
      method: 'GET',
      headers: { authorization: authHeader() },
    });
    expect(res.status).toBe(404);
  });

  it('POST /admin/api/import: happy iTunes path inserts D1 row and R2 object', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/lookup'),
          respond: () =>
            jsonResponse({
              resultCount: 1,
              results: [
                {
                  trackId: 999111,
                  artistName: 'Importer',
                  trackName: 'Imported Song',
                  releaseDate: '2005-04-01',
                  previewUrl: 'https://audio-ssl.itunes.apple.com/imp.m4a',
                  artworkUrl100: 'https://example.com/art.jpg',
                  trackTimeMillis: 30_000,
                },
              ],
            }),
        },
        {
          match: (u) => u.includes('audio-ssl.itunes.apple.com/imp.m4a'),
          respond: () => audioResponse('imp-bytes'),
        },
      ]),
    );

    const res = await SELF.fetch('http://localhost/admin/api/import', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://music.apple.com/us/album/x/1?i=999111',
        genreSlug: 'rock',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      artist: string;
      title: string;
      year: number;
    };
    expect(body.artist).toBe('Importer');
    expect(body.title).toBe('Imported Song');
    expect(body.year).toBe(2005);

    const row = await testEnv.CATALOG
      .prepare('SELECT id, r2_key FROM tracks WHERE id = ?')
      .bind(body.id)
      .first<{ id: string; r2_key: string }>();
    expect(row).not.toBeNull();
    expect(row!.r2_key).toBe(`tracks/${body.id}.mp3`);

    const obj = await testEnv.AUDIO.get(row!.r2_key);
    expect(obj).not.toBeNull();
  });

  it('POST /admin/api/import: free-text query path inserts a row', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/search'),
          respond: () =>
            jsonResponse({
              resultCount: 1,
              results: [
                {
                  trackId: 555222,
                  artistName: 'Кино',
                  trackName: 'Группа крови',
                  releaseDate: '1988-01-01',
                  previewUrl: 'https://audio-ssl.itunes.apple.com/gk.m4a',
                },
              ],
            }),
        },
        {
          match: (u) => u.includes('audio-ssl.itunes.apple.com/gk.m4a'),
          respond: () => audioResponse('gk-bytes'),
        },
      ]),
    );

    const res = await SELF.fetch('http://localhost/admin/api/import', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'Кино — Группа крови',
        genreSlug: 'rock',
        country: 'RU',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { artist: string; title: string; year: number };
    expect(body.artist).toBe('Кино');
    expect(body.title).toBe('Группа крови');
    expect(body.year).toBe(1988);
  });

  it('POST /admin/api/import returns 400 when neither url nor query is given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('missing-fields path must not fetch');
    }));
    const res = await SELF.fetch('http://localhost/admin/api/import', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ genreSlug: 'rock' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_fields');
  });

  it('POST /admin/api/import returns 409 ambiguous on Spotify ambiguous match', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('accounts.spotify.com/api/token'),
          respond: () => jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
        },
        {
          match: (u) => u.includes('api.spotify.com/v1/tracks'),
          respond: () =>
            jsonResponse({ name: 'Yesterday', artists: [{ name: 'The Beatles' }] }),
        },
        {
          match: (u) => u.includes('itunes.apple.com/search'),
          respond: () =>
            jsonResponse({
              resultCount: 2,
              results: [
                {
                  trackId: 1,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday (Remastered)',
                  releaseDate: '1965-08-06',
                  previewUrl: 'https://x.example/1.m4a',
                },
                {
                  trackId: 2,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday (Live)',
                  releaseDate: '1994-01-01',
                  previewUrl: 'https://x.example/2.m4a',
                },
              ],
            }),
        },
      ]),
    );

    const res = await SELF.fetch('http://localhost/admin/api/import', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://open.spotify.com/track/abc',
        genreSlug: 'rock',
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; message: string; candidates: unknown[] };
    expect(body.code).toBe('ambiguous');
    expect(body.message).toMatch(/несколько совпадений/);
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /admin/api/import returns 400 for unknown_genre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('genre check must happen before any fetch');
    }));
    const res = await SELF.fetch('http://localhost/admin/api/import', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://music.apple.com/us/album/x/1?i=1',
        genreSlug: 'does-not-exist',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('unknown_genre');
    expect(body.message).toMatch(/Неизвестный жанр/);
  });

  it('POST /admin/api/import returns 400 bad_itunes_id for non-positive itunesIdOverride', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('itunesIdOverride validation must happen before any fetch');
    }));
    const res = await SELF.fetch('http://localhost/admin/api/import', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://music.apple.com/us/album/x/1?i=1',
        genreSlug: 'rock',
        itunesIdOverride: 0,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_itunes_id');
  });

  it('POST /admin/api/import returns 400 for bad_url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('bad_url must not fetch');
    }));
    const res = await SELF.fetch('http://localhost/admin/api/import', {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/random',
        genreSlug: 'rock',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_url');
  });
});
