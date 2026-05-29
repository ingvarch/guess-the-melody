// iTunes Search API client.
//
// Two endpoints: /search (free-text query) and /lookup (by track id).
// Results without a `previewUrl` are dropped: we can't use a track we
// can't play. Public docs:
//   https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/

const ITUNES_BASE = 'https://itunes.apple.com';

export interface ItunesTrack {
  trackId: number;
  artistName: string;
  trackName: string;
  releaseDate: string;
  previewUrl: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  collectionName?: string;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesTrack[];
}

export function parseItunesUrl(url: string): { trackId: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'music.apple.com' && parsed.hostname !== 'itunes.apple.com') {
    return null;
  }
  const i = parsed.searchParams.get('i');
  if (i === null) return null;
  const n = Number.parseInt(i, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { trackId: n };
}

async function fetchItunes(url: string): Promise<ItunesResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`iTunes request failed: ${res.status}`);
  }
  // iTunes returns text/javascript with a JSON body; res.json() handles it.
  const data = (await res.json()) as unknown;
  if (
    typeof data !== 'object' ||
    data === null ||
    !('results' in data) ||
    !Array.isArray((data as { results: unknown }).results)
  ) {
    throw new Error('iTunes response: malformed JSON');
  }
  return data as ItunesResponse;
}

export async function searchItunes(opts: {
  term: string;
  limit?: number;
  country?: string;
}): Promise<ItunesTrack[]> {
  const params = new URLSearchParams({
    term: opts.term,
    entity: 'musicTrack',
    limit: String(opts.limit ?? 25),
  });
  if (opts.country) params.set('country', opts.country);
  const data = await fetchItunes(`${ITUNES_BASE}/search?${params.toString()}`);
  return data.results.filter((r): r is ItunesTrack => typeof r.previewUrl === 'string' && r.previewUrl.length > 0);
}

export async function lookupItunes(opts: { trackId: number }): Promise<ItunesTrack | null> {
  const params = new URLSearchParams({
    id: String(opts.trackId),
    entity: 'musicTrack',
  });
  const data = await fetchItunes(`${ITUNES_BASE}/lookup?${params.toString()}`);
  if (data.resultCount === 0 || data.results.length === 0) return null;
  const first = data.results[0];
  if (!first || typeof first.previewUrl !== 'string' || first.previewUrl.length === 0) {
    return null;
  }
  return first;
}

export function yearFromItunes(t: ItunesTrack): number {
  const y = Number.parseInt((t.releaseDate ?? '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}
