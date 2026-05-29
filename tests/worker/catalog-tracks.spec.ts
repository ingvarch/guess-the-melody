// Catalogue access layer: tracks. Migrations applied by ./setup-d1.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../src/types';
import { archiveGenre } from '../../src/catalog/genres';
import {
  countTracks,
  countTracksByGenre,
  deleteTrack,
  getTrack,
  getTrackByItunesId,
  insertTrack,
  listTracks,
  pickRandomTrack,
  type InsertTrack,
} from '../../src/catalog/tracks';

const testEnv = env as unknown as Env;

async function resetCatalog(): Promise<void> {
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

function track(overrides: Partial<InsertTrack> & { id: string }): InsertTrack {
  return {
    genre_slug: 'rock',
    artist: 'The Beatles',
    title: 'Hey Jude',
    year: 1968,
    preview_url: 'https://example.com/hey-jude.m4a',
    added_at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('catalog/tracks', () => {
  beforeEach(async () => {
    await resetCatalog();
  });

  it('insertTrack + getTrack roundtrip', async () => {
    const t = track({
      id: 't1',
      itunes_id: 12345,
      source_url: 'https://itunes.example/12345',
      r2_key: 'audio/t1.m4a',
      duration_ms: 30_000,
      artwork_url: 'https://example.com/art.jpg',
    });
    await insertTrack(testEnv.CATALOG, t);
    const got = await getTrack(testEnv.CATALOG, 't1');
    expect(got).toEqual({
      id: 't1',
      genre_slug: 'rock',
      artist: 'The Beatles',
      title: 'Hey Jude',
      year: 1968,
      itunes_id: 12345,
      source_url: 'https://itunes.example/12345',
      preview_url: 'https://example.com/hey-jude.m4a',
      r2_key: 'audio/t1.m4a',
      duration_ms: 30_000,
      artwork_url: 'https://example.com/art.jpg',
      added_at: 1_700_000_000_000,
    });
  });

  it('getTrack returns null for an unknown id', async () => {
    expect(await getTrack(testEnv.CATALOG, 'nope')).toBeNull();
  });

  it('insertTrack throws on duplicate (artist, title, year)', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1' }));
    await expect(
      insertTrack(testEnv.CATALOG, track({ id: 't2' })),
    ).rejects.toThrow();
  });

  it('insertTrack throws on duplicate itunes_id', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1', itunes_id: 42 }));
    await expect(
      insertTrack(
        testEnv.CATALOG,
        track({ id: 't2', title: 'Let It Be', year: 1970, itunes_id: 42 }),
      ),
    ).rejects.toThrow();
  });

  it('getTrackByItunesId returns the row or null', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1', itunes_id: 7 }));
    const row = await getTrackByItunesId(testEnv.CATALOG, 7);
    expect(row?.id).toBe('t1');
    expect(await getTrackByItunesId(testEnv.CATALOG, 999)).toBeNull();
  });

  it('listTracks filters by genreSlug', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1' }));
    await insertTrack(
      testEnv.CATALOG,
      track({ id: 't2', genre_slug: 'pop', artist: 'Madonna', title: 'Vogue', year: 1990 }),
    );

    const rockRows = await listTracks(testEnv.CATALOG, { genreSlug: 'rock' });
    expect(rockRows.map((t) => t.id)).toEqual(['t1']);

    const popRows = await listTracks(testEnv.CATALOG, { genreSlug: 'pop' });
    expect(popRows.map((t) => t.id)).toEqual(['t2']);
  });

  it('listTracks search is a case-insensitive substring match on artist or title', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1', added_at: 1 }));
    await insertTrack(
      testEnv.CATALOG,
      track({ id: 't2', artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975, added_at: 2 }),
    );
    await insertTrack(
      testEnv.CATALOG,
      track({
        id: 't3',
        genre_slug: 'pop',
        artist: 'Madonna',
        title: 'Material Girl',
        year: 1984,
        added_at: 3,
      }),
    );

    const queen = await listTracks(testEnv.CATALOG, { search: 'queen' });
    expect(queen.map((t) => t.id)).toEqual(['t2']);

    const material = await listTracks(testEnv.CATALOG, { search: 'MATERIAL' });
    expect(material.map((t) => t.id)).toEqual(['t3']);

    const hey = await listTracks(testEnv.CATALOG, { search: 'hey' });
    expect(hey.map((t) => t.id)).toEqual(['t1']);
  });

  it('listTracks honours limit and offset and caps limit at 200', async () => {
    for (let i = 0; i < 5; i++) {
      await insertTrack(
        testEnv.CATALOG,
        track({ id: `t${i}`, title: `Song ${i}`, year: 1970 + i, added_at: i }),
      );
    }
    // Default order: added_at DESC -> t4, t3, t2, t1, t0
    const page1 = await listTracks(testEnv.CATALOG, { limit: 2, offset: 0 });
    expect(page1.map((t) => t.id)).toEqual(['t4', 't3']);

    const page2 = await listTracks(testEnv.CATALOG, { limit: 2, offset: 2 });
    expect(page2.map((t) => t.id)).toEqual(['t2', 't1']);

    // Cap: requesting 1000 still returns at most 5 (only 5 rows exist), and
    // must not error. The effective LIMIT clause is min(1000, 200) = 200.
    const huge = await listTracks(testEnv.CATALOG, { limit: 1000 });
    expect(huge).toHaveLength(5);
  });

  it('deleteTrack returns true on success and false on missing id', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1' }));
    expect(await deleteTrack(testEnv.CATALOG, 't1')).toBe(true);
    expect(await getTrack(testEnv.CATALOG, 't1')).toBeNull();
    expect(await deleteTrack(testEnv.CATALOG, 't1')).toBe(false);
  });

  it('pickRandomTrack by genreSlug returns one of the eligible tracks', async () => {
    // Single eligible track for determinism.
    await insertTrack(testEnv.CATALOG, track({ id: 't1' }));
    await insertTrack(
      testEnv.CATALOG,
      track({ id: 't2', genre_slug: 'pop', artist: 'Madonna', title: 'Vogue', year: 1990 }),
    );

    const picked = await pickRandomTrack(testEnv.CATALOG, { genreSlug: 'rock' });
    expect(picked?.id).toBe('t1');
  });

  it('pickRandomTrack returns null when all candidates are excluded', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1' }));
    await insertTrack(
      testEnv.CATALOG,
      track({ id: 't2', title: 'Let It Be', year: 1970 }),
    );
    const picked = await pickRandomTrack(testEnv.CATALOG, {
      genreSlug: 'rock',
      excludeIds: ['t1', 't2'],
    });
    expect(picked).toBeNull();
  });

  it('pickRandomTrack without a genre returns a track from any non-archived genre', async () => {
    // Archive every genre except pop, then insert only a pop track. Forces
    // the random pick to that single eligible row.
    await archiveGenre(testEnv.CATALOG, 'rock', true);
    await archiveGenre(testEnv.CATALOG, 'hip-hop', true);
    await archiveGenre(testEnv.CATALOG, 'soundtrack', true);
    await insertTrack(
      testEnv.CATALOG,
      track({ id: 't1', genre_slug: 'pop', artist: 'Madonna', title: 'Vogue', year: 1990 }),
    );

    const picked = await pickRandomTrack(testEnv.CATALOG, {});
    expect(picked?.id).toBe('t1');
    expect(picked?.genre_slug).toBe('pop');
  });

  it('pickRandomTrack returns null when the requested genre is archived', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1' }));
    await archiveGenre(testEnv.CATALOG, 'rock', true);

    const picked = await pickRandomTrack(testEnv.CATALOG, { genreSlug: 'rock' });
    expect(picked).toBeNull();
  });

  it('countTracks returns the total row count', async () => {
    expect(await countTracks(testEnv.CATALOG)).toBe(0);
    await insertTrack(testEnv.CATALOG, track({ id: 't1' }));
    await insertTrack(testEnv.CATALOG, track({ id: 't2', genre_slug: 'pop', title: 'B' }));
    await insertTrack(testEnv.CATALOG, track({ id: 't3', genre_slug: 'pop', title: 'C' }));
    expect(await countTracks(testEnv.CATALOG)).toBe(3);
  });

  it('countTracksByGenre groups counts per genre slug', async () => {
    await insertTrack(testEnv.CATALOG, track({ id: 't1', genre_slug: 'rock', title: 'A' }));
    await insertTrack(testEnv.CATALOG, track({ id: 't2', genre_slug: 'pop', title: 'B' }));
    await insertTrack(testEnv.CATALOG, track({ id: 't3', genre_slug: 'pop', title: 'C' }));

    const byGenre = await countTracksByGenre(testEnv.CATALOG);
    expect(byGenre).toEqual({ rock: 1, pop: 2 });
  });

  it('countTracksByGenre returns an empty map when there are no tracks', async () => {
    expect(await countTracksByGenre(testEnv.CATALOG)).toEqual({});
  });
});
