// Catalogue access layer: genres. Migrations are applied by ./setup-d1.ts.
// Each test cleans the catalogue to a known state (seeded 4 genres, no tracks).

import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../src/types';
import {
  archiveGenre,
  createGenre,
  deleteGenre,
  getGenre,
  listGenres,
  updateGenre,
} from '../../src/catalog/genres';
import { insertTrack } from '../../src/catalog/tracks';

const testEnv = env as unknown as Env;

const SEEDED_SLUGS = ['rock', 'pop', 'hip-hop', 'soundtrack'] as const;

async function resetCatalog(): Promise<void> {
  // Drop tracks first (no FK enforcement, but logically owned by genres),
  // then non-seeded genres, then reset any mutated seeded fields.
  await testEnv.CATALOG.exec('DELETE FROM tracks');
  await testEnv.CATALOG.prepare(
    `DELETE FROM genres WHERE slug NOT IN ('rock','pop','hip-hop','soundtrack')`,
  ).run();
  await testEnv.CATALOG.batch([
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Rock',       emoji=NULL, sort_order=10, archived=0 WHERE slug='rock'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Pop',        emoji=NULL, sort_order=20, archived=0 WHERE slug='pop'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Hip-Hop',    emoji=NULL, sort_order=30, archived=0 WHERE slug='hip-hop'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Soundtrack', emoji=NULL, sort_order=40, archived=0 WHERE slug='soundtrack'`,
    ),
  ]);
}

describe('catalog/genres', () => {
  beforeEach(async () => {
    await resetCatalog();
  });

  it('listGenres returns the four seeded genres in sort_order', async () => {
    const rows = await listGenres(testEnv.CATALOG);
    expect(rows.map((g) => g.slug)).toEqual([...SEEDED_SLUGS]);
    expect(rows[0]).toMatchObject({ slug: 'rock', name: 'Rock', sort_order: 10, archived: 0 });
  });

  it('listGenres excludes archived by default; includeArchived returns all', async () => {
    await archiveGenre(testEnv.CATALOG, 'pop', true);

    const defaultRows = await listGenres(testEnv.CATALOG);
    expect(defaultRows.map((g) => g.slug)).toEqual(['rock', 'hip-hop', 'soundtrack']);

    const allRows = await listGenres(testEnv.CATALOG, { includeArchived: true });
    expect(allRows.map((g) => g.slug)).toEqual([...SEEDED_SLUGS]);
    const pop = allRows.find((g) => g.slug === 'pop');
    expect(pop?.archived).toBe(1);
  });

  it('getGenre returns the row or null', async () => {
    const rock = await getGenre(testEnv.CATALOG, 'rock');
    expect(rock?.name).toBe('Rock');

    const missing = await getGenre(testEnv.CATALOG, 'nope');
    expect(missing).toBeNull();
  });

  it('createGenre inserts a new row', async () => {
    await createGenre(testEnv.CATALOG, {
      slug: 'jazz',
      name: 'Jazz',
      emoji: null,
      sortOrder: 50,
    });
    const jazz = await getGenre(testEnv.CATALOG, 'jazz');
    expect(jazz).toMatchObject({ slug: 'jazz', name: 'Jazz', sort_order: 50, archived: 0 });
  });

  it('updateGenre mutates only the supplied fields', async () => {
    await updateGenre(testEnv.CATALOG, 'rock', { name: 'Rock & Roll', emoji: 'guitar' });
    const row = await getGenre(testEnv.CATALOG, 'rock');
    expect(row?.name).toBe('Rock & Roll');
    expect(row?.emoji).toBe('guitar');
    expect(row?.sort_order).toBe(10); // unchanged
  });

  it('updateGenre with empty patch is a no-op', async () => {
    await expect(updateGenre(testEnv.CATALOG, 'rock', {})).resolves.toBeUndefined();
    const row = await getGenre(testEnv.CATALOG, 'rock');
    expect(row?.name).toBe('Rock');
  });

  it('archiveGenre(slug, true) hides the genre from default listGenres', async () => {
    await archiveGenre(testEnv.CATALOG, 'rock', true);
    const archived = await getGenre(testEnv.CATALOG, 'rock');
    expect(archived?.archived).toBe(1);

    const rows = await listGenres(testEnv.CATALOG);
    expect(rows.map((g) => g.slug)).not.toContain('rock');

    await archiveGenre(testEnv.CATALOG, 'rock', false);
    const restored = await getGenre(testEnv.CATALOG, 'rock');
    expect(restored?.archived).toBe(0);
  });

  it('deleteGenre on an empty genre returns { deleted: true }', async () => {
    await createGenre(testEnv.CATALOG, {
      slug: 'temp',
      name: 'Temp',
      emoji: null,
      sortOrder: 99,
    });
    const result = await deleteGenre(testEnv.CATALOG, 'temp');
    expect(result).toEqual({ deleted: true });
    const gone = await getGenre(testEnv.CATALOG, 'temp');
    expect(gone).toBeNull();
  });

  it('deleteGenre on a non-existent slug returns { deleted: true } (idempotent)', async () => {
    const result = await deleteGenre(testEnv.CATALOG, 'never-existed');
    expect(result).toEqual({ deleted: true });
  });

  it('deleteGenre returns { deleted: false, reason: "has_tracks" } when tracks exist', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 't-rock-1',
      genre_slug: 'rock',
      artist: 'The Beatles',
      title: 'Hey Jude',
      year: 1968,
      preview_url: 'https://example.com/hey-jude.m4a',
      added_at: 1_700_000_000_000,
    });

    const result = await deleteGenre(testEnv.CATALOG, 'rock');
    expect(result).toEqual({ deleted: false, reason: 'has_tracks' });

    const rock = await getGenre(testEnv.CATALOG, 'rock');
    expect(rock).not.toBeNull();
  });
});
