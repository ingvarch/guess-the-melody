// Importer orchestrator: URL in → D1 row + R2 object out.
//
// Failure modes are returned as discriminated unions, not thrown — admin
// handlers in Phase 7B turn each into a precise HTTP status. Real errors
// (D1 down, R2 down, unknown error shapes) still throw.

import { randomUrlSafe } from '../id';
import { getGenre } from '../catalog/genres';
import { getTrackByItunesId, insertTrack, isPlausibleYear } from '../catalog/tracks';
import type { Env } from '../types';
import {
  lookupItunes,
  parseItunesUrl,
  yearFromItunes,
  type ItunesTrack,
} from './itunes';
import {
  fetchSpotifyEmbedTrack,
  matchItunesForSpotify,
  parseSpotifyUrl,
  type MatchCandidate,
} from './spotify';
import { parseQueryLine, resolveQueryToItunes } from './match';
import { deletePreviewFromR2, downloadPreviewToR2 } from './r2';

export type ImportError =
  | { code: 'bad_url'; message: string }
  | { code: 'no_preview'; message: string }
  | { code: 'ambiguous'; message: string; candidates: MatchCandidate[] }
  | { code: 'duplicate'; message: string; existingId: string }
  | { code: 'unknown_genre'; message: string };

// Wall-clock cost of each outbound phase, so the CLI can show where an import
// spent its time (and which phase is slow when a batch drags).
export interface ImportTimings {
  itunesMs: number;
  r2Ms: number;
  dbMs: number;
}

export interface ImportSuccess {
  id: string;
  artist: string;
  title: string;
  year: number;
  timings: ImportTimings;
}

// Provider-agnostic resolved track. itunesId is null for Spotify embed imports
// (no iTunes row exists); dedupe then leans on the (artist, title, year) index.
interface ResolvedTrack {
  itunesId: number | null;
  artist: string;
  title: string;
  year: number;
  previewUrl: string;
  durationMs: number | null;
  artworkUrl: string | null;
}

type ResolveResult =
  | { kind: 'ok'; track: ResolvedTrack }
  | { kind: 'err'; err: ImportError };

function itunesToResolved(t: ItunesTrack): ResolvedTrack {
  return {
    itunesId: t.trackId,
    artist: t.artistName,
    title: t.trackName,
    year: yearFromItunes(t),
    previewUrl: t.previewUrl,
    durationMs: t.trackTimeMillis ?? null,
    artworkUrl: t.artworkUrl100 ?? null,
  };
}

async function resolveTrack(
  env: Env,
  opts: {
    url?: string;
    query?: string;
    country?: string;
    itunesIdOverride?: number;
  },
): Promise<ResolveResult> {
  if (opts.itunesIdOverride !== undefined) {
    const t = await lookupItunes({ trackId: opts.itunesIdOverride });
    if (!t) {
      return {
        kind: 'err',
        err: { code: 'no_preview', message: 'iTunes id override yielded no usable track' },
      };
    }
    return { kind: 'ok', track: itunesToResolved(t) };
  }

  if (opts.query !== undefined) {
    let t;
    try {
      t = await resolveQueryToItunes(parseQueryLine(opts.query), opts.country);
    } catch (e) {
      return {
        kind: 'err',
        err: {
          code: 'no_preview',
          message: e instanceof Error ? e.message : 'iTunes search failed',
        },
      };
    }
    if (!t) {
      return {
        kind: 'err',
        err: { code: 'no_preview', message: 'no iTunes match for query' },
      };
    }
    return { kind: 'ok', track: itunesToResolved(t) };
  }

  if (opts.url === undefined) {
    return {
      kind: 'err',
      err: { code: 'bad_url', message: 'no url, query, or itunes id provided' },
    };
  }

  const itunes = parseItunesUrl(opts.url);
  if (itunes) {
    const t = await lookupItunes({ trackId: itunes.trackId });
    if (!t) {
      return {
        kind: 'err',
        err: { code: 'no_preview', message: 'iTunes lookup returned no usable track' },
      };
    }
    return { kind: 'ok', track: itunesToResolved(t) };
  }

  const spotify = parseSpotifyUrl(opts.url);
  if (spotify) {
    // Preferred path: pull the preview straight from Spotify's embed page.
    const embed = await fetchSpotifyEmbedTrack(opts.url).catch(() => null);
    if (embed) {
      return {
        kind: 'ok',
        track: {
          itunesId: null,
          artist: embed.artist,
          title: embed.title,
          year: embed.year,
          previewUrl: embed.previewUrl,
          durationMs: embed.durationMs,
          artworkUrl: null,
        },
      };
    }

    // Fallback: the embed broke or had no preview — match against iTunes
    // (official, but plays the iTunes preview). itunesIdOverride still refines.
    let match;
    try {
      match = await matchItunesForSpotify(
        opts.url,
        env.SPOTIFY_CLIENT_ID,
        env.SPOTIFY_CLIENT_SECRET,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'spotify metadata fetch failed';
      return { kind: 'err', err: { code: 'no_preview', message: `spotify: ${msg}` } };
    }
    if (match.kind === 'unique') return { kind: 'ok', track: itunesToResolved(match.track) };
    if (match.kind === 'ambiguous') {
      return {
        kind: 'err',
        err: { code: 'ambiguous', message: 'Найдено несколько совпадений на iTunes', candidates: match.candidates },
      };
    }
    return {
      kind: 'err',
      err: { code: 'no_preview', message: 'no itunes match for spotify track' },
    };
  }

  return {
    kind: 'err',
    err: { code: 'bad_url', message: 'URL is neither an iTunes nor a Spotify track URL' },
  };
}

// SQLite UNIQUE-constraint failures come back as Error instances whose
// message contains "UNIQUE constraint failed". We treat both `tracks.itunes_id`
// and `idx_tracks_dedupe` (artist, title, year) hits as a duplicate.
// Message-matching is the only signal D1 currently exposes for constraint failures; revisit if D1 ships structured error codes.
function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /UNIQUE constraint failed/i.test(err.message);
}

export async function importTrack(
  env: Env,
  opts: {
    url?: string;
    query?: string;
    country?: string;
    genreSlug: string;
    itunesIdOverride?: number;
  },
): Promise<ImportSuccess | ImportError> {
  // 1. Genre check first — cheapest validation, and guarantees we never
  // touch iTunes/R2 for an unknown genre.
  const genre = await getGenre(env.CATALOG, opts.genreSlug);
  if (!genre) return { code: 'unknown_genre', message: 'Неизвестный жанр' };

  // 2. Resolve URL → ResolvedTrack (or a typed error). Spotify URLs prefer the
  // embed preview and fall back to an iTunes match.
  const itunesStart = Date.now();
  const resolved = await resolveTrack(env, {
    ...(opts.url !== undefined ? { url: opts.url } : {}),
    ...(opts.query !== undefined ? { query: opts.query } : {}),
    ...(opts.country !== undefined ? { country: opts.country } : {}),
    ...(opts.itunesIdOverride !== undefined ? { itunesIdOverride: opts.itunesIdOverride } : {}),
  });
  const itunesMs = Date.now() - itunesStart;
  if (resolved.kind === 'err') return resolved.err;
  const t = resolved.track;

  // 3. Dedupe by iTunes id before any R2 work (only when we have one — Spotify
  // embed imports carry no itunes_id, so they dedupe on the insert below).
  if (t.itunesId !== null) {
    const existing = await getTrackByItunesId(env.CATALOG, t.itunesId);
    if (existing) {
      return {
        code: 'duplicate',
        message: `Трек уже есть в каталоге: ${existing.artist} – ${existing.title}`,
        existingId: existing.id,
      };
    }
  }

  // 4. Validate release year before any R2 work. A 0/malformed year is caught
  // by the plausible-year window.
  if (!isPlausibleYear(t.year)) {
    return { code: 'no_preview', message: 'track missing or invalid release year' };
  }

  // 5. Generate internal id, download preview, insert row. On D1 unique-
  // constraint races, remove the orphan R2 object before surfacing the error.
  const id = randomUrlSafe(12);

  let r2Key: string;
  const r2Start = Date.now();
  try {
    r2Key = await downloadPreviewToR2(env, { trackId: id, previewUrl: t.previewUrl });
  } catch (err) {
    return {
      code: 'no_preview',
      message: err instanceof Error ? err.message : 'preview download failed',
    };
  }

  const r2Ms = Date.now() - r2Start;

  const dbStart = Date.now();
  try {
    await insertTrack(env.CATALOG, {
      id,
      genre_slug: opts.genreSlug,
      artist: t.artist,
      title: t.title,
      year: t.year,
      itunes_id: t.itunesId,
      source_url: opts.url ?? null,
      preview_url: t.previewUrl,
      r2_key: r2Key,
      duration_ms: t.durationMs,
      artwork_url: t.artworkUrl,
      added_at: Date.now(),
    });
  } catch (err) {
    // Rollback the R2 object. If the delete itself fails we leak an orphan
    // object rather than masking the original D1 error.
    try {
      await deletePreviewFromR2(env, r2Key);
    } catch {
      /* leak orphan R2 object; original error wins */
    }
    if (isUniqueConstraintError(err)) {
      // Surface the colliding row's id when we collided on itunes_id; the
      // (artist, title, year) index has no easy reverse lookup, so omit it.
      const dupe = t.itunesId !== null ? await getTrackByItunesId(env.CATALOG, t.itunesId) : null;
      const msg = dupe
        ? `Трек уже есть в каталоге: ${dupe.artist} – ${dupe.title}`
        : 'Трек уже есть в каталоге';
      return { code: 'duplicate', message: msg, existingId: dupe?.id ?? '' };
    }
    throw err;
  }

  return {
    id,
    artist: t.artist,
    title: t.title,
    year: t.year,
    timings: { itunesMs, r2Ms, dbMs: Date.now() - dbStart },
  };
}
