// Spotify metadata via the public oEmbed endpoint (no auth required), plus
// a heuristic to find the matching iTunes track that we can actually play.
//
// We cannot stream Spotify preview audio without their Web API; iTunes hands
// out a 30-second preview file directly. So Spotify URLs are translated into
// an iTunes track via title+artist search, and we play the iTunes preview.

import { searchItunes, type ItunesTrack } from './itunes';

export interface SpotifyTrackMeta {
  artist: string;
  title: string;
}

export interface MatchCandidate {
  itunesId: number;
  artist: string;
  title: string;
  releaseDate: string;
  previewUrl: string;
  score: number;
}

export type SpotifyMatchResult =
  | { kind: 'unique'; track: ItunesTrack }
  | { kind: 'ambiguous'; candidates: MatchCandidate[] }
  | { kind: 'none' };

const OEMBED_URL = 'https://open.spotify.com/oembed';

export function parseSpotifyUrl(url: string): { providerId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'open.spotify.com') return null;
  // Path: /track/<id>
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] !== 'track') return null;
  const id = parts[1];
  if (!id) return null;
  return { providerId: id };
}

export async function metadataFromSpotify(url: string): Promise<SpotifyTrackMeta> {
  const res = await fetch(`${OEMBED_URL}?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    throw new Error(`Spotify oEmbed failed: ${res.status}`);
  }
  const data = (await res.json()) as { title?: unknown; author_name?: unknown };
  const title = typeof data.title === 'string' ? data.title : '';
  const author = typeof data.author_name === 'string' ? data.author_name : '';

  if (author && title) {
    return { artist: author, title };
  }
  // Fallback: oEmbed sometimes returns "Artist - Title" in `title` only.
  const sepIdx = title.indexOf(' - ');
  if (sepIdx > 0) {
    return {
      artist: title.slice(0, sepIdx).trim(),
      title: title.slice(sepIdx + 3).trim(),
    };
  }
  throw new Error('Spotify oEmbed: could not extract artist/title');
}

function normalise(s: string): string {
  return s.toLowerCase().trim();
}

// Score in [0, 100]. 100 = both exact (case-insensitive). 80 = both substring.
// 50 = one side substring. <50 if neither substring => drop.
function scoreMatch(spotify: SpotifyTrackMeta, t: ItunesTrack): number {
  const sa = normalise(spotify.artist);
  const st = normalise(spotify.title);
  const ta = normalise(t.artistName);
  const tt = normalise(t.trackName);

  if (sa === ta && st === tt) return 100;

  const artistSub = ta.includes(sa) || sa.includes(ta);
  const titleSub = tt.includes(st) || st.includes(tt);

  if (artistSub && titleSub) return 80;
  if (artistSub || titleSub) return 50;
  return 0;
}

function toCandidate(t: ItunesTrack, score: number): MatchCandidate {
  return {
    itunesId: t.trackId,
    artist: t.artistName,
    title: t.trackName,
    releaseDate: t.releaseDate,
    previewUrl: t.previewUrl,
    score,
  };
}

export async function matchItunesForSpotify(url: string): Promise<SpotifyMatchResult> {
  const meta = await metadataFromSpotify(url);
  const term = `${meta.artist} ${meta.title}`;
  const results = await searchItunes({ term });

  const scored = results
    .map((t) => ({ track: t, score: scoreMatch(meta, t) }))
    .filter((s) => s.score >= 50)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: 'none' };

  const top = scored.filter((s) => s.score >= 90);
  if (top.length === 1) {
    return { kind: 'unique', track: top[0]!.track };
  }

  // Everything else with score >= 80 is "ambiguous" — including the 1-result
  // case where the lone match scored in [80, 90).
  const above80 = scored.filter((s) => s.score >= 80);
  if (above80.length >= 1) {
    return {
      kind: 'ambiguous',
      candidates: above80.map((s) => toCandidate(s.track, s.score)),
    };
  }

  // Only 50-tier matches: not strong enough to act on.
  return { kind: 'none' };
}
