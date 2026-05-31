// D1 access layer for the `tracks` table.
//
// Uniqueness is enforced by two SQL constraints: `idx_tracks_dedupe`
// (artist, title, year) and `tracks.itunes_id UNIQUE`. Duplicate insertions
// throw — the importer (Phase 7) catches them; admin handlers surface them
// as 409s.

export interface Track {
  id: string;
  genre_slug: string;
  artist: string;
  title: string;
  year: number;
  itunes_id: number | null;
  source_url: string | null;
  preview_url: string;
  r2_key: string | null;
  duration_ms: number | null;
  artwork_url: string | null;
  added_at: number;
}

export interface InsertTrack {
  id: string;
  genre_slug: string;
  artist: string;
  title: string;
  year: number;
  itunes_id?: number | null;
  source_url?: string | null;
  preview_url: string;
  r2_key?: string | null;
  duration_ms?: number | null;
  artwork_url?: string | null;
  added_at: number;
}

export interface UpdateTrack {
  genre_slug?: string;
  artist?: string;
  title?: string;
  year?: number;
}

// Shared release-year sanity window: 1900..currentYear+2. Used by the importer
// (rejecting malformed iTunes dates) and by the admin edit handler.
export function isPlausibleYear(year: number, now: Date = new Date()): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= now.getUTCFullYear() + 2;
}

export interface ListTracksOpts {
  genreSlug?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TRACK_COLS =
  'id, genre_slug, artist, title, year, itunes_id, source_url, preview_url, r2_key, duration_ms, artwork_url, added_at';

export async function insertTrack(db: D1Database, t: InsertTrack): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tracks (${TRACK_COLS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      t.id,
      t.genre_slug,
      t.artist,
      t.title,
      t.year,
      t.itunes_id ?? null,
      t.source_url ?? null,
      t.preview_url,
      t.r2_key ?? null,
      t.duration_ms ?? null,
      t.artwork_url ?? null,
      t.added_at,
    )
    .run();
}

export async function getTrack(db: D1Database, id: string): Promise<Track | null> {
  return await db
    .prepare(`SELECT ${TRACK_COLS} FROM tracks WHERE id = ?`)
    .bind(id)
    .first<Track>();
}

export async function getTrackByItunesId(
  db: D1Database,
  itunesId: number,
): Promise<Track | null> {
  return await db
    .prepare(`SELECT ${TRACK_COLS} FROM tracks WHERE itunes_id = ?`)
    .bind(itunesId)
    .first<Track>();
}

// Shared genre + search WHERE clause for listTracks and countTracksFiltered,
// so the count always matches the page it paginates.
function buildTrackFilter(
  opts: Pick<ListTracksOpts, 'genreSlug' | 'search'>,
): { whereSql: string; binds: (string | number)[] } {
  const where: string[] = [];
  const binds: (string | number)[] = [];

  if (opts.genreSlug !== undefined) {
    where.push('genre_slug = ?');
    binds.push(opts.genreSlug);
  }
  if (opts.search !== undefined && opts.search.length > 0) {
    where.push('(artist LIKE ? OR title LIKE ?)');
    const pat = `%${opts.search}%`;
    binds.push(pat, pat);
  }

  return { whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', binds };
}

export async function listTracks(
  db: D1Database,
  opts: ListTracksOpts = {},
): Promise<Track[]> {
  const { whereSql, binds } = buildTrackFilter(opts);

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = opts.offset ?? 0;
  binds.push(limit, offset);

  const sql = `SELECT ${TRACK_COLS} FROM tracks ${whereSql} ORDER BY added_at DESC LIMIT ? OFFSET ?`;

  const result = await db.prepare(sql).bind(...binds).all<Track>();
  return result.results;
}

// Row count for the same filter listTracks would apply (ignores limit/offset).
export async function countTracksFiltered(
  db: D1Database,
  opts: Pick<ListTracksOpts, 'genreSlug' | 'search'> = {},
): Promise<number> {
  const { whereSql, binds } = buildTrackFilter(opts);
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM tracks ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function countTracks(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM tracks')
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function countTracksByGenre(
  db: D1Database,
): Promise<Record<string, number>> {
  const result = await db
    .prepare('SELECT genre_slug, COUNT(*) AS c FROM tracks GROUP BY genre_slug')
    .all<{ genre_slug: string; c: number }>();
  const out: Record<string, number> = {};
  for (const r of result.results) out[r.genre_slug] = r.c;
  return out;
}

// Patches only the supplied columns. Returns false when nothing was provided
// or the id matched no row. Throws the raw UNIQUE-constraint error when the new
// (artist, title, year) collides with another track — the admin handler maps it
// to a 409.
export async function updateTrack(
  db: D1Database,
  id: string,
  patch: UpdateTrack,
): Promise<boolean> {
  const sets: string[] = [];
  const binds: (string | number)[] = [];
  if (patch.genre_slug !== undefined) {
    sets.push('genre_slug = ?');
    binds.push(patch.genre_slug);
  }
  if (patch.artist !== undefined) {
    sets.push('artist = ?');
    binds.push(patch.artist);
  }
  if (patch.title !== undefined) {
    sets.push('title = ?');
    binds.push(patch.title);
  }
  if (patch.year !== undefined) {
    sets.push('year = ?');
    binds.push(patch.year);
  }
  if (sets.length === 0) return false;

  binds.push(id);
  const result = await db
    .prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteTrack(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM tracks WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function pickRandomTrack(
  db: D1Database,
  opts: { genreSlug?: string; excludeIds?: string[] },
): Promise<Track | null> {
  const excludeJson = JSON.stringify(opts.excludeIds ?? []);

  // JOIN genres to filter out tracks belonging to archived genres regardless
  // of whether the caller passed an explicit `genreSlug`.
  // json_each lets us bind excludeIds as a single JSON parameter, avoiding
  // dynamic `IN (?, ?, ...)` SQL stitching.
  const conditions: string[] = [
    'g.archived = 0',
    't.id NOT IN (SELECT value FROM json_each(?))',
  ];
  const binds: (string | number)[] = [excludeJson];

  if (opts.genreSlug !== undefined) {
    conditions.push('t.genre_slug = ?');
    binds.push(opts.genreSlug);
  }

  const sql = `SELECT ${TRACK_COLS.split(', ').map((c) => `t.${c}`).join(', ')}
               FROM tracks t
               JOIN genres g ON g.slug = t.genre_slug
               WHERE ${conditions.join(' AND ')}
               ORDER BY RANDOM()
               LIMIT 1`;

  return await db.prepare(sql).bind(...binds).first<Track>();
}
