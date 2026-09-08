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

// Russian catalogues spell ё as е about as often as not ("Идём на восток" vs
// iTunes' "Идем на восток!"), so fold it or the two never compare equal.
function normalise(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim();
}

// "The Goo Goo Dolls" and "Goo Goo Dolls" are the same band.
function stripLeadingThe(s: string): string {
  return s.replace(/^the\s+/, '');
}

// A rendition of the right song is not the right recording. iTunes marks these
// in the title; reject them unless the query asked for that rendition.
const VERSION_MARKER =
  /\b(live|remix|remaster(ed)?|acoustic|remake|karaoke|karaoké|cover|instrumental|unplugged|demo|reprise|sped up|slowed|edit|version|версия|ремикс|караоке|инструментал)\b/;

// The queried artist must lead the credit, not trail it. iTunes credits tribute
// acts and lullaby labels as "Celtic Pink Floyd" or "Sparrow Sleeps & The
// Offspring" — the real name is in there, but the performer is someone else.
function artistMatches(sa: string, ta: string): boolean {
  const a = stripLeadingThe(sa);
  const b = stripLeadingThe(ta);
  if (a === b) return true;
  return b.startsWith(a) || a.startsWith(b);
}

// Score in [0, 100]. 100 = both exact (case-insensitive). 80 = both substring.
// 50 = one side substring. <50 if neither substring => drop.
export function scoreMatch(q: TrackQuery, t: ItunesTrack): number {
  const sa = normalise(q.artist);
  const st = normalise(q.title);
  const ta = normalise(t.artistName);
  const tt = normalise(t.trackName);

  if (sa === ta && st === tt) return 100;

  // A rendition marker the query never asked for means a different recording.
  if (VERSION_MARKER.test(tt) && !VERSION_MARKER.test(st)) return 0;

  const artistSub = artistMatches(sa, ta);
  const titleSub = tt.includes(st) || st.includes(tt);

  if (artistSub && titleSub) return 80;

  // One-sided hits are not matches when the query named an artist. A title-only
  // hit imports a cover band, karaoke label or lullaby rendition of the right
  // song; an artist-only hit imports the right performer singing a different
  // song. Both were observed in production imports.
  if (sa.length > 0) return 0;

  // Title-only query (no artist given): the title is all there is to go on.
  return titleSub ? 50 : 0;
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
