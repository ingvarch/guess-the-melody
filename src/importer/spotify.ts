// Spotify metadata via the public Web API (Client Credentials flow), plus
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

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

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

export interface SpotifyEmbedTrack {
  artist: string;
  title: string;
  year: number;
  previewUrl: string;
  durationMs: number | null;
}

const EMBED_BASE = 'https://open.spotify.com/embed/track/';

interface EmbedEntity {
  title?: unknown;
  artists?: Array<{ name?: unknown }>;
  releaseDate?: { isoString?: unknown };
  audioPreview?: { url?: unknown };
  duration?: unknown;
}

// Pulls track metadata + the 30s preview straight from Spotify's embed page,
// which still ships an `audioPreview.url` (p.scdn.co) even though the Web API
// stopped returning preview_url. No auth needed. Unofficial: returns null on
// any shape change so the caller can fall back to the iTunes match path.
export async function fetchSpotifyEmbedTrack(url: string): Promise<SpotifyEmbedTrack | null> {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) return null;

  let html: string;
  try {
    const res = await fetch(`${EMBED_BASE}${parsed.providerId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GuessTheMelody/1.0)' },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m || !m[1]) return null;

  let entity: EmbedEntity | undefined;
  try {
    const parsedJson = JSON.parse(m[1]) as {
      props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } };
    };
    entity = parsedJson.props?.pageProps?.state?.data?.entity;
  } catch {
    return null;
  }
  if (!entity) return null;

  const title = typeof entity.title === 'string' ? entity.title : '';
  const artist =
    Array.isArray(entity.artists) && typeof entity.artists[0]?.name === 'string'
      ? entity.artists[0].name
      : '';
  const previewUrl =
    typeof entity.audioPreview?.url === 'string' ? entity.audioPreview.url : '';
  if (!title || !artist || !previewUrl) return null;

  let year = 0;
  const iso = entity.releaseDate?.isoString;
  if (typeof iso === 'string') {
    const y = new Date(iso).getUTCFullYear();
    if (Number.isFinite(y)) year = y;
  }
  const durationMs = typeof entity.duration === 'number' ? entity.duration : null;

  return { artist, title, year, previewUrl, durationMs };
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (data.error || !data.access_token) {
    throw new Error(`Spotify token error: ${data.error ?? 'no access_token'}`);
  }
  return data.access_token;
}

export async function metadataFromSpotify(
  url: string,
  clientId: string,
  clientSecret: string,
): Promise<SpotifyTrackMeta> {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) {
    throw new Error('invalid spotify url');
  }

  const token = await getAccessToken(clientId, clientSecret);
  const res = await fetch(`${API_BASE}/tracks/${parsed.providerId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify API failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    name?: unknown;
    artists?: Array<{ name?: unknown }>;
  };
  const title = typeof data.name === 'string' ? data.name : '';
  const artist =
    Array.isArray(data.artists) &&
    data.artists[0] &&
    typeof data.artists[0].name === 'string'
      ? data.artists[0].name
      : '';

  if (!artist || !title) {
    throw new Error('Spotify API: could not extract artist/title');
  }
  return { artist, title };
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

export async function matchItunesForSpotify(
  url: string,
  clientId: string,
  clientSecret: string,
): Promise<SpotifyMatchResult> {
  const meta = await metadataFromSpotify(url, clientId, clientSecret);
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
