// Admin HTTP surface. Every route here is gated by basic auth against
// `env.ADMIN_PASSWORD`. The handler is the single entry point for any path
// starting with `/admin` or `/admin/` — `src/index.ts` delegates straight to
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
import { deleteTrack, getTrack, listTracks } from '../catalog/tracks';
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
    if (b.emoji !== undefined && b.emoji !== null && typeof b.emoji !== 'string') {
      return json({ error: 'bad_emoji' }, 400);
    }
    const emoji = b.emoji === undefined ? undefined : (b.emoji as string | null);
    try {
      await createGenre(env.CATALOG, {
        slug: b.slug,
        name: b.name,
        ...(emoji !== undefined ? { emoji } : {}),
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
    if (b.emoji === null || typeof b.emoji === 'string') {
      patch.emoji = b.emoji as string | null;
    }
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
  return json(rows);
}

async function handleTrackById(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
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
  if (typeof b.url !== 'string' || typeof b.genreSlug !== 'string') {
    return json({ error: 'missing_fields' }, 400);
  }
  if (b.itunesIdOverride !== undefined) {
    if (!Number.isInteger(b.itunesIdOverride) || (b.itunesIdOverride as number) <= 0) {
      return json({ error: 'bad_itunes_id' }, 400);
    }
  }
  const opts: Parameters<typeof importTrack>[1] = {
    url: b.url,
    genreSlug: b.genreSlug,
  };
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
  const trackMatch = /^\/admin\/api\/tracks\/([^/]+)$/.exec(path);
  if (trackMatch && trackMatch[1]) {
    return handleTrackById(req, env, decodeURIComponent(trackMatch[1]));
  }
  if (path === '/admin/api/import') {
    return handleImport(req, env);
  }

  return new Response('not found', { status: 404 });
}
