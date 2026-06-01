// Active-session registry access layer. Migrations applied by ./setup-d1.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../src/types';
import {
  upsertSession,
  listSessions,
  deleteSession,
  deleteSessionsOlderThan,
} from '../../src/catalog/sessions';

const testEnv = env as unknown as Env;

async function resetSessions(): Promise<void> {
  await testEnv.CATALOG.exec('DELETE FROM sessions');
}

describe('sessions registry', () => {
  beforeEach(resetSessions);

  it('upsert inserts a new snapshot and listSessions returns it', async () => {
    await upsertSession(testEnv.CATALOG, {
      id: 'abc',
      now: 1_000,
      phase: 'spinning',
      selectedGenre: 'rock',
      roundsPlayed: 2,
      teams: [{ name: 'Cats', score: 3 }],
    });
    const rows = await listSessions(testEnv.CATALOG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'abc',
      phase: 'spinning',
      selected_genre: 'rock',
      rounds_played: 2,
      team_count: 1,
      created_at: 1_000,
      updated_at: 1_000,
    });
    expect(JSON.parse(rows[0]!.teams_json)).toEqual([{ name: 'Cats', score: 3 }]);
  });

  it('upsert preserves created_at but advances updated_at on conflict', async () => {
    await upsertSession(testEnv.CATALOG, {
      id: 'abc', now: 1_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [],
    });
    await upsertSession(testEnv.CATALOG, {
      id: 'abc', now: 5_000, phase: 'playing', selectedGenre: 'pop', roundsPlayed: 1,
      teams: [{ name: 'Dogs', score: 5 }],
    });
    const rows = await listSessions(testEnv.CATALOG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      created_at: 1_000,
      updated_at: 5_000,
      phase: 'playing',
      selected_genre: 'pop',
      rounds_played: 1,
      team_count: 1,
    });
  });

  it('listSessions orders by most-recently-updated first', async () => {
    await upsertSession(testEnv.CATALOG, { id: 'old', now: 1_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [] });
    await upsertSession(testEnv.CATALOG, { id: 'new', now: 9_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [] });
    const rows = await listSessions(testEnv.CATALOG);
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('deleteSession removes the row and reports whether anything was deleted', async () => {
    await upsertSession(testEnv.CATALOG, {
      id: 'kill', now: 1_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [],
    });
    expect(await deleteSession(testEnv.CATALOG, 'kill')).toBe(true);
    expect(await listSessions(testEnv.CATALOG)).toHaveLength(0);
    expect(await deleteSession(testEnv.CATALOG, 'kill')).toBe(false);
  });

  it('listSessions can filter out stale rows by updatedAfter', async () => {
    await upsertSession(testEnv.CATALOG, { id: 'stale', now: 1_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [] });
    await upsertSession(testEnv.CATALOG, { id: 'fresh', now: 10_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [] });
    const rows = await listSessions(testEnv.CATALOG, { updatedAfter: 5_000 });
    expect(rows.map((r) => r.id)).toEqual(['fresh']);
  });

  it('upsert round-trips the host-private current answer', async () => {
    await upsertSession(testEnv.CATALOG, {
      id: 'ans', now: 1_000, phase: 'playing', selectedGenre: 'rock', roundsPlayed: 0, teams: [],
      currentAnswer: { artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975 },
    });
    const rows = await listSessions(testEnv.CATALOG);
    expect(JSON.parse(rows[0]!.current_answer!)).toEqual({
      artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975,
    });
  });

  it('upsert clears the current answer when none is supplied', async () => {
    await upsertSession(testEnv.CATALOG, {
      id: 'ans', now: 1_000, phase: 'playing', selectedGenre: 'rock', roundsPlayed: 0, teams: [],
      currentAnswer: { artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975 },
    });
    await upsertSession(testEnv.CATALOG, {
      id: 'ans', now: 2_000, phase: 'idle', selectedGenre: null, roundsPlayed: 1, teams: [],
      currentAnswer: null,
    });
    const rows = await listSessions(testEnv.CATALOG);
    expect(rows[0]!.current_answer).toBeNull();
  });

  it('deleteSessionsOlderThan removes rows updated before the cutoff and returns the count', async () => {
    await upsertSession(testEnv.CATALOG, { id: 'old1', now: 1_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [] });
    await upsertSession(testEnv.CATALOG, { id: 'old2', now: 2_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [] });
    await upsertSession(testEnv.CATALOG, { id: 'keep', now: 9_000, phase: 'idle', selectedGenre: null, roundsPlayed: 0, teams: [] });

    const deleted = await deleteSessionsOlderThan(testEnv.CATALOG, 5_000);
    expect(deleted).toBe(2);
    const rows = await listSessions(testEnv.CATALOG);
    expect(rows.map((r) => r.id)).toEqual(['keep']);
  });
});
