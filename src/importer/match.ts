// Free-text track matching against iTunes.
//
// Shared by the Spotify→iTunes match path (spotify.ts) and the curated
// "Artist — Title" batch importer. Given a query, search iTunes, score each
// result, and auto-pick the best playable one.

import { searchItunes, type ItunesTrack } from './itunes';

export interface TrackQuery {
  artist: string;
  title: string;
}

// Tracks below this score are not a confident enough match to import.
const MATCH_THRESHOLD = 50;

// Splits the first artist/title separator: em dash, en dash, or a spaced
// hyphen. A line with no separator is a title-only query.
const SEPARATOR = /\s+[—–-]\s+/;

export function parseQueryLine(line: string): TrackQuery {
  const m = SEPARATOR.exec(line);
  if (!m) return { artist: '', title: line.trim() };
  return {
    artist: line.slice(0, m.index).trim(),
    title: line.slice(m.index + m[0].length).trim(),
  };
}

function normalise(s: string): string {
  return s.toLowerCase().trim();
}

// Score in [0, 100]. 100 = both exact (case-insensitive). 80 = both substring.
// 50 = one side substring. <50 if neither substring => drop.
export function scoreMatch(q: TrackQuery, t: ItunesTrack): number {
  const sa = normalise(q.artist);
  const st = normalise(q.title);
  const ta = normalise(t.artistName);
  const tt = normalise(t.trackName);

  if (sa === ta && st === tt) return 100;

  const artistSub = ta.includes(sa) || sa.includes(ta);
  const titleSub = tt.includes(st) || st.includes(tt);

  if (artistSub && titleSub) return 80;

  // A title-only hit is not a match when the query named an artist. iTunes
  // carries cover bands, karaoke labels and lullaby renditions under the exact
  // original title, and accepting those imports the wrong recording.
  if (sa.length > 0 && !artistSub) return 0;

  if (artistSub || titleSub) return 50;
  return 0;
}

// Searches iTunes for a free-text query and returns the highest-scoring
// playable track, or null when nothing clears the match threshold.
export async function resolveQueryToItunes(
  query: TrackQuery,
  country?: string,
): Promise<ItunesTrack | null> {
  const term = `${query.artist} ${query.title}`.trim();
  const results = await searchItunes(country ? { term, country } : { term });

  const best = results
    .map((t) => ({ t, score: scoreMatch(query, t) }))
    .filter((s) => s.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)[0];

  return best?.t ?? null;
}
