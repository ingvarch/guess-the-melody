// Admin HTTP surface. Every route here is gated by basic auth against
// `env.ADMIN_PASSWORD`. The handler is the single entry point for any path
// starting with `/admin` or `/admin/` — `src/router.ts` delegates straight to
// `handleAdmin` without any path inspection of its own.
//
// Status code conventions:
//   200/201 with JSON for successful reads/writes,
//   204 no body for deletes,
//   400 for malformed bodies,
//   401 with WWW-Authenticate for auth failures,
//   404 for missing rows,
//   409 with `{error: '...'}` or the importer's typed error body for conflicts.

import { basicAuthChallenge, checkBasicAuth } from '../auth';
import {
  createGenre,
  deleteGenre,
  getGenre,
  listGenres,
  updateGenre,
} from '../catalog/genres';
import {
  countTracks,
  countTracksByGenre,
  countTracksFiltered,
  deleteTrack,
  getTrack,
  isPlausibleYear,
  listTracks,
  updateTrack,
  type UpdateTrack,
} from '../catalog/tracks';
import { deleteSession, listSessions } from '../catalog/sessions';
import { importTrack } from '../importer/import-track';
import type { Env } from '../types';

const JSON_HEADERS = { 'content-type': 'application/json' };

const SLUG_RE = /^[a-z0-9-]+$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /UNIQUE constraint failed/i.test(err.message);
}

async function handleGenresIndex(req: Request, env: Env): Promise<Response> {
  if (req.method === 'GET') {
    const rows = await listGenres(env.CATALOG, { includeArchived: true });
    return json(rows);
  }
  if (req.method === 'POST') {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad_json' }, 400);
    }
    if (typeof body !== 'object' || body === null) {
      return json({ error: 'bad_body' }, 400);
    }
    const b = body as Record<string, unknown>;
    if (
      typeof b.slug !== 'string' ||
      b.slug.length === 0 ||
      typeof b.name !== 'string' ||
      b.name.length === 0 ||
      typeof b.sortOrder !== 'number'
    ) {
      return json({ error: 'missing_fields' }, 400);
    }
    if (!SLUG_RE.test(b.slug)) {
      return json({ error: 'bad_slug' }, 400);
    }
    try {
      await createGenre(env.CATALOG, {
        slug: b.slug,
        name: b.name,
        sortOrder: b.sortOrder,
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return json({ error: 'duplicate' }, 409);
      throw err;
    }
    const created = await getGenre(env.CATALOG, b.slug);
    return json(created, 201);
  }
  return new Response('method not allowed', { status: 405 });
}

async function handleGenreBySlug(
  req: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  if (req.method === 'PATCH') {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad_json' }, 400);
    }
    if (typeof body !== 'object' || body === null) {
      return json({ error: 'bad_body' }, 400);
    }
    const existing = await getGenre(env.CATALOG, slug);
    if (!existing) return json({ error: 'not_found' }, 404);

    const b = body as Record<string, unknown>;
    const patch: Parameters<typeof updateGenre>[2] = {};
    if (typeof b.name === 'string') patch.name = b.name;
    if (typeof b.sortOrder === 'number') patch.sort_order = b.sortOrder;
    if (typeof b.archived === 'boolean') patch.archived = b.archived ? 1 : 0;

    await updateGenre(env.CATALOG, slug, patch);
    const updated = await getGenre(env.CATALOG, slug);
    return json(updated);
  }
  if (req.method === 'DELETE') {
    const existing = await getGenre(env.CATALOG, slug);
    if (!existing) return json({ error: 'not_found' }, 404);
    const result = await deleteGenre(env.CATALOG, slug);
    if (result.deleted) return new Response(null, { status: 204 });
    return json({ error: result.reason ?? 'conflict' }, 409);
  }
  return new Response('method not allowed', { status: 405 });
}

async function handleTracksIndex(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  const url = new URL(req.url);
  const opts: Parameters<typeof listTracks>[1] = {};
  const genre = url.searchParams.get('genre');
  if (genre) opts.genreSlug = genre;
  const search = url.searchParams.get('search');
  if (search) opts.search = search;
  const limit = url.searchParams.get('limit');
  if (limit) {
    const n = Number.parseInt(limit, 10);
    if (Number.isFinite(n)) opts.limit = n;
  }
  const offset = url.searchParams.get('offset');
  if (offset) {
    const n = Number.parseInt(offset, 10);
    if (Number.isFinite(n)) opts.offset = n;
  }
  const rows = await listTracks(env.CATALOG, opts);
  const total = await countTracksFiltered(env.CATALOG, opts);
  return json({ tracks: rows, total });
}

async function handleTrackPatch(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'bad_body' }, 400);
  }
  const existing = await getTrack(env.CATALOG, id);
  if (!existing) return json({ error: 'not_found' }, 404);

  const b = body as Record<string, unknown>;
  const patch: UpdateTrack = {};

  if (b.genreSlug !== undefined) {
    if (typeof b.genreSlug !== 'string') return json({ error: 'bad_field' }, 400);
    const genre = await getGenre(env.CATALOG, b.genreSlug);
    if (!genre) return json({ error: 'unknown_genre' }, 400);
    patch.genre_slug = b.genreSlug;
  }
  for (const field of ['artist', 'title'] as const) {
    if (b[field] !== undefined) {
      if (typeof b[field] !== 'string' || (b[field] as string).trim().length === 0) {
        return json({ error: 'bad_field' }, 400);
      }
      patch[field] = (b[field] as string).trim();
    }
  }
  if (b.year !== undefined) {
    if (typeof b.year !== 'number' || !isPlausibleYear(b.year)) {
      return json({ error: 'bad_year' }, 400);
    }
    patch.year = b.year;
  }

  try {
    await updateTrack(env.CATALOG, id, patch);
  } catch (err) {
    if (isUniqueConstraintError(err)) return json({ error: 'duplicate' }, 409);
    throw err;
  }
  const updated = await getTrack(env.CATALOG, id);
  return json(updated);
}

async function handleTrackById(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (req.method === 'PATCH') {
    return handleTrackPatch(req, env, id);
  }
  if (req.method !== 'DELETE') {
    return new Response('method not allowed', { status: 405 });
  }
  const row = await getTrack(env.CATALOG, id);
  if (!row) return json({ error: 'not_found' }, 404);

  if (row.r2_key) {
    // Best-effort R2 cleanup. If the bucket call throws, surface it — leaking
    // a row+orphan key would be worse than a 500 the operator can retry.
    await env.AUDIO.delete(row.r2_key);
  }
  await deleteTrack(env.CATALOG, id);
  return new Response(null, { status: 204 });
}

async function handleTrackAudio(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  const row = await getTrack(env.CATALOG, id);
  if (!row || !row.r2_key) {
    return new Response('not found', { status: 404 });
  }
  const obj = await env.AUDIO.get(row.r2_key);
  if (!obj) {
    return new Response('not found', { status: 404 });
  }
  const headers: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'private, max-age=3600',
  };
  if (typeof obj.size === 'number') {
    headers['Content-Length'] = String(obj.size);
  }
  return new Response(obj.body, { status: 200, headers });
}

function parseTeams(json: string): { name: string; score: number }[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseAnswer(
  json: string | null,
): { artist: string; title: string; year: number } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch {
    return null;
  }
}

async function handleStats(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  const genres = await listGenres(env.CATALOG, { includeArchived: true });
  const totalTracks = await countTracks(env.CATALOG);
  const perGenre = await countTracksByGenre(env.CATALOG);
  return json({
    totalTracks,
    totalGenres: genres.length,
    activeGenres: genres.filter((g) => g.archived === 0).length,
    perGenre,
  });
}

// "Active" filter window for the Live Game view. The DO refreshes a session's
// updated_at on every host action, so a row untouched this long is effectively
// abandoned and hidden when the admin toggles `activeOnly`.
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

async function handleSessions(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  const url = new URL(req.url);
  const opts: Parameters<typeof listSessions>[1] = {};
  if (url.searchParams.get('activeOnly') === '1') {
    opts.updatedAfter = Date.now() - ACTIVE_WINDOW_MS;
  }
  const rows = await listSessions(env.CATALOG, opts);
  const out = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    phase: r.phase,
    selectedGenre: r.selected_genre,
    roundsPlayed: r.rounds_played,
    teamCount: r.team_count,
    teams: parseTeams(r.teams_json),
    currentAnswer: parseAnswer(r.current_answer),
  }));
  return json(out);
}

async function handleSessionById(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (req.method !== 'DELETE') {
    return new Response('method not allowed', { status: 405 });
  }
  // Idempotent: deleting an already-gone row still reports success.
  await deleteSession(env.CATALOG, id);
  return new Response(null, { status: 204 });
}

// Injects the per-session meta tag so the admin console page knows which DO to
// talk to. Mirrors the router's host/display injection.
class InjectSessionId {
  constructor(private readonly sessionId: string) {}
  element(el: Element): void {
    el.append(`<meta name="session-id" content="${this.sessionId}">`, { html: true });
  }
}

// Serves the admin-gated host console for a session. Basic auth was already
// verified by handleAdmin, so reaching here means the operator holds the
// password — no owner cookie required.
async function handleConsolePage(
  req: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  const origin = new URL(req.url).origin;
  const assetRes = await env.ASSETS.fetch(
    new Request(`${origin}/console.html`, { method: 'GET' }),
  );
  if (assetRes.status === 200) {
    return new HTMLRewriter()
      .on('head', new InjectSessionId(sessionId))
      .transform(assetRes);
  }
  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="session-id" content="${sessionId}"></head>` +
    `<body>console</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// Forwards a host action to the session's DO authorised by admin password
// (X-Admin-Override), so a phone holding only the password can control a game
// it didn't create. The DO is binding-only, so this header is never client-set.
async function handleConsoleAction(
  req: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const stub = env.MELODY_ROOM.get(env.MELODY_ROOM.idFromName(sessionId));
  const body = await req.arrayBuffer();
  return stub.fetch('http://room/state', {
    method: 'POST',
    headers: {
      'Content-Type': req.headers.get('content-type') ?? 'application/json',
      'X-Admin-Override': '1',
    },
    body,
  });
}

async function handleImport(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'bad_body' }, 400);
  }
  const b = body as Record<string, unknown>;
  const hasUrl = typeof b.url === 'string';
  const hasQuery = typeof b.query === 'string';
  if (typeof b.genreSlug !== 'string' || (!hasUrl && !hasQuery)) {
    return json({ error: 'missing_fields' }, 400);
  }
  if (b.itunesIdOverride !== undefined) {
    if (!Number.isInteger(b.itunesIdOverride) || (b.itunesIdOverride as number) <= 0) {
      return json({ error: 'bad_itunes_id' }, 400);
    }
  }
  const opts: Parameters<typeof importTrack>[1] = {
    genreSlug: b.genreSlug,
  };
  if (hasUrl) opts.url = b.url as string;
  if (hasQuery) opts.query = b.query as string;
  if (typeof b.country === 'string') opts.country = b.country;
  if (typeof b.itunesIdOverride === 'number') {
    opts.itunesIdOverride = b.itunesIdOverride;
  }
  const result = await importTrack(env, opts);
  if ('id' in result) return json(result, 201);

  // ImportError → HTTP status.
  switch (result.code) {
    case 'bad_url':
      return json(result, 400);
    case 'unknown_genre':
      return json(result, 400);
    case 'no_preview':
      return json(result, 404);
    case 'ambiguous':
      return json(result, 409);
    case 'duplicate':
      return json(result, 409);
    default: {
      const _exhaustive: never = result;
      throw new Error(
        `unhandled import error code: ${(_exhaustive as { code: string }).code}`,
      );
    }
  }
}

export async function handleAdmin(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  if (!checkBasicAuth(req.headers.get('authorization'), env.ADMIN_PASSWORD)) {
    return basicAuthChallenge();
  }

  const url = new URL(req.url);
  const path = url.pathname;

  if (path === '/admin' || path === '/admin/') {
    // Defer to ASSETS for admin.html. If absent, serve a placeholder.
    const assetRes = await env.ASSETS.fetch(
      new Request(`${url.origin}/admin.html`, { method: 'GET' }),
    );
    if (assetRes.status === 200) return assetRes;
    return new Response('admin (UI not yet built)', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }

  if (path === '/admin/api/genres') {
    return handleGenresIndex(req, env);
  }
  const genreMatch = /^\/admin\/api\/genres\/([^/]+)$/.exec(path);
  if (genreMatch && genreMatch[1]) {
    return handleGenreBySlug(req, env, decodeURIComponent(genreMatch[1]));
  }
  if (path === '/admin/api/tracks') {
    return handleTracksIndex(req, env);
  }
  const audioMatch = /^\/admin\/api\/tracks\/([^/]+)\.mp3$/.exec(path);
  if (audioMatch && audioMatch[1]) {
    return handleTrackAudio(req, env, decodeURIComponent(audioMatch[1]));
  }
  const trackMatch = /^\/admin\/api\/tracks\/([^/]+)$/.exec(path);
  if (trackMatch && trackMatch[1]) {
    return handleTrackById(req, env, decodeURIComponent(trackMatch[1]));
  }
  if (path === '/admin/api/import') {
    return handleImport(req, env);
  }
  if (path === '/admin/api/sessions') {
    return handleSessions(req, env);
  }
  const sessionMatch = /^\/admin\/api\/sessions\/([^/]+)$/.exec(path);
  if (sessionMatch && sessionMatch[1]) {
    return handleSessionById(req, env, decodeURIComponent(sessionMatch[1]));
  }
  const consoleActionMatch = /^\/admin\/api\/console\/([^/]+)\/action$/.exec(path);
  if (consoleActionMatch && consoleActionMatch[1]) {
    return handleConsoleAction(req, env, decodeURIComponent(consoleActionMatch[1]));
  }
  const consolePageMatch = /^\/admin\/console\/([^/]+)$/.exec(path);
  if (consolePageMatch && consolePageMatch[1]) {
    return handleConsolePage(req, env, decodeURIComponent(consolePageMatch[1]));
  }
  if (path === '/admin/api/stats') {
    return handleStats(req, env);
  }

  return new Response('not found', { status: 404 });
}
