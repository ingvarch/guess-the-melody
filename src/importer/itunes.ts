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
  // "song" for audio tracks; "music-video" carries a .m4v preview we can't play.
  kind?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  collectionName?: string;
}

// A usable track must be playable audio. iTunes mixes music videos into
// musicTrack results; their preview is a .m4v we reject downstream, so drop
// them here. A missing `kind` is treated as a song (defensive).
function isPlayableSong(t: ItunesTrack): boolean {
  if (typeof t.previewUrl !== 'string' || t.previewUrl.length === 0) return false;
  return t.kind === undefined || t.kind === 'song';
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

// iTunes throttles ~20 req/min/IP and answers bursts with 429. Back off and
// retry (honouring Retry-After) rather than failing the import. 503 too.
const RETRY_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;

function retryDelayMs(res: Response, attempt: number): number {
  const ra = res.headers.get('retry-after');
  if (ra !== null) {
    const secs = Number.parseInt(ra, 10);
    if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  }
  return BASE_DELAY_MS * 2 ** attempt;
}

async function fetchItunes(url: string): Promise<ItunesResponse> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url);
    if (res.ok) break;
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(res, attempt)));
      continue;
    }
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
  return data.results.filter(isPlayableSong);
}

export async function lookupItunes(opts: { trackId: number }): Promise<ItunesTrack | null> {
  const params = new URLSearchParams({
    id: String(opts.trackId),
    entity: 'musicTrack',
  });
  const data = await fetchItunes(`${ITUNES_BASE}/lookup?${params.toString()}`);
  return data.results.find(isPlayableSong) ?? null;
}

export function yearFromItunes(t: ItunesTrack): number {
  const y = Number.parseInt((t.releaseDate ?? '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}
