// D1 access layer for the `genres` table.
//
// All functions take the `D1Database` binding explicitly so the module is
// trivially testable against an ephemeral D1 instance. UNIQUE-constraint
// violations surface as thrown errors — callers (admin handlers, importer)
// decide how to react.

export interface Genre {
  slug: string;
  name: string;
  sort_order: number;
  archived: number;
}

export interface CreateGenre {
  slug: string;
  name: string;
  sortOrder: number;
}

export interface UpdateGenre {
  name?: string;
  sort_order?: number;
  archived?: number;
}

export interface DeleteResult {
  deleted: boolean;
  reason?: 'has_tracks';
}

export async function listGenres(
  db: D1Database,
  opts?: { includeArchived?: boolean },
): Promise<Genre[]> {
  const sql = opts?.includeArchived
    ? 'SELECT slug, name, sort_order, archived FROM genres ORDER BY sort_order, slug'
    : 'SELECT slug, name, sort_order, archived FROM genres WHERE archived = 0 ORDER BY sort_order, slug';
  const result = await db.prepare(sql).all<Genre>();
  return result.results;
}

export async function countGenres(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM genres WHERE archived = 0')
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function getGenre(db: D1Database, slug: string): Promise<Genre | null> {
  const row = await db
    .prepare('SELECT slug, name, sort_order, archived FROM genres WHERE slug = ?')
    .bind(slug)
    .first<Genre>();
  return row;
}

export async function createGenre(db: D1Database, g: CreateGenre): Promise<void> {
  await db
    .prepare('INSERT INTO genres (slug, name, sort_order) VALUES (?, ?, ?)')
    .bind(g.slug, g.name, g.sortOrder)
    .run();
}

export async function updateGenre(
  db: D1Database,
  slug: string,
  patch: UpdateGenre,
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.sort_order !== undefined) {
    sets.push('sort_order = ?');
    values.push(patch.sort_order);
  }
  if (patch.archived !== undefined) {
    sets.push('archived = ?');
    values.push(patch.archived);
  }

  if (sets.length === 0) return;

  values.push(slug);
  await db
    .prepare(`UPDATE genres SET ${sets.join(', ')} WHERE slug = ?`)
    .bind(...values)
    .run();
}

export async function archiveGenre(
  db: D1Database,
  slug: string,
  archived: boolean,
): Promise<void> {
  await db
    .prepare('UPDATE genres SET archived = ? WHERE slug = ?')
    .bind(archived ? 1 : 0, slug)
    .run();
}

export async function deleteGenre(db: D1Database, slug: string): Promise<DeleteResult> {
  const countRow = await db
    .prepare('SELECT COUNT(*) AS c FROM tracks WHERE genre_slug = ?')
    .bind(slug)
    .first<{ c: number }>();
  const count = countRow?.c ?? 0;
  if (count > 0) {
    return { deleted: false, reason: 'has_tracks' };
  }
  await db.prepare('DELETE FROM genres WHERE slug = ?').bind(slug).run();
  return { deleted: true };
}
