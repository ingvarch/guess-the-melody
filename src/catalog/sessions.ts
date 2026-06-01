// D1 access layer for the `sessions` registry.
//
// The MelodyRoom DO writes a snapshot here on every mutation; the admin
// "Live Game" view reads it. Rows are advisory: a DO eviction leaves a stale
// row behind, so consumers judge liveness by `updated_at`, not existence.

export interface TrackAnswer {
  artist: string;
  title: string;
  year: number;
}

export interface SessionRow {
  id: string;
  created_at: number;
  updated_at: number;
  phase: string;
  selected_genre: string | null;
  rounds_played: number;
  team_count: number;
  teams_json: string;
  current_answer: string | null;
}

export interface SessionSnapshot {
  id: string;
  now: number;
  phase: string;
  selectedGenre: string | null;
  roundsPlayed: number;
  teams: { name: string; score: number }[];
  // Host-private answer for the current (possibly unrevealed) track. Null when
  // no round is in progress. Lives only here, never in the broadcast RoomState.
  currentAnswer?: TrackAnswer | null;
}

const COLS =
  'id, created_at, updated_at, phase, selected_genre, rounds_played, team_count, teams_json, current_answer';

export async function upsertSession(
  db: D1Database,
  snap: SessionSnapshot,
): Promise<void> {
  const teamsJson = JSON.stringify(snap.teams);
  const answerJson = snap.currentAnswer ? JSON.stringify(snap.currentAnswer) : null;
  await db
    .prepare(
      `INSERT INTO sessions
         (id, created_at, updated_at, phase, selected_genre, rounds_played, team_count, teams_json, current_answer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         updated_at     = excluded.updated_at,
         phase          = excluded.phase,
         selected_genre = excluded.selected_genre,
         rounds_played  = excluded.rounds_played,
         team_count     = excluded.team_count,
         teams_json     = excluded.teams_json,
         current_answer = excluded.current_answer`,
    )
    .bind(
      snap.id,
      snap.now,
      snap.now,
      snap.phase,
      snap.selectedGenre,
      snap.roundsPlayed,
      snap.teams.length,
      teamsJson,
      answerJson,
    )
    .run();
}

// Removes the advisory registry row. A still-live DO will re-add itself on its
// next mutation; this is for clearing out stale/abandoned sessions from the
// admin list. Returns whether a row was actually deleted.
export async function deleteSession(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

// Bulk sweep for the daily cron: drop registry rows untouched since `cutoff`.
// A still-live DO re-registers on its next mutation, so deleting a recent-but-
// idle row is harmless. Returns how many rows were removed.
export async function deleteSessionsOlderThan(
  db: D1Database,
  cutoff: number,
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM sessions WHERE updated_at < ?')
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

export async function listSessions(
  db: D1Database,
  opts: { updatedAfter?: number; limit?: number } = {},
): Promise<SessionRow[]> {
  const where: string[] = [];
  const binds: number[] = [];
  if (opts.updatedAfter !== undefined) {
    where.push('updated_at > ?');
    binds.push(opts.updatedAfter);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 100, 200);
  binds.push(limit);
  const sql = `SELECT ${COLS} FROM sessions ${whereSql} ORDER BY updated_at DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...binds).all<SessionRow>();
  return result.results;
}
