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

export async function listTracks(
  db: D1Database,
  opts: ListTracksOpts = {},
): Promise<Track[]> {
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

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = opts.offset ?? 0;
  binds.push(limit, offset);

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT ${TRACK_COLS} FROM tracks ${whereSql} ORDER BY added_at DESC LIMIT ? OFFSET ?`;

  const result = await db.prepare(sql).bind(...binds).all<Track>();
  return result.results;
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
