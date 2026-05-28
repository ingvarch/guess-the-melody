// D1 access layer for the `sessions` registry.
//
// The MelodyRoom DO writes a snapshot here on every mutation; the admin
// "Live Game" view reads it. Rows are advisory: a DO eviction leaves a stale
// row behind, so consumers judge liveness by `updated_at`, not existence.

export interface SessionRow {
  id: string;
  created_at: number;
  updated_at: number;
  phase: string;
  selected_genre: string | null;
  rounds_played: number;
  team_count: number;
  teams_json: string;
}

export interface SessionSnapshot {
  id: string;
  now: number;
  phase: string;
  selectedGenre: string | null;
  roundsPlayed: number;
  teams: { name: string; score: number }[];
}

const COLS =
  'id, created_at, updated_at, phase, selected_genre, rounds_played, team_count, teams_json';

export async function upsertSession(
  db: D1Database,
  snap: SessionSnapshot,
): Promise<void> {
  const teamsJson = JSON.stringify(snap.teams);
  await db
    .prepare(
      `INSERT INTO sessions
         (id, created_at, updated_at, phase, selected_genre, rounds_played, team_count, teams_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         updated_at     = excluded.updated_at,
         phase          = excluded.phase,
         selected_genre = excluded.selected_genre,
         rounds_played  = excluded.rounds_played,
         team_count     = excluded.team_count,
         teams_json     = excluded.teams_json`,
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
    )
    .run();
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
