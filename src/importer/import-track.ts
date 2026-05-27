// Importer orchestrator: URL in → D1 row + R2 object out.
//
// Failure modes are returned as discriminated unions, not thrown — admin
// handlers in Phase 7B turn each into a precise HTTP status. Real errors
// (D1 down, R2 down, unknown error shapes) still throw.

import { randomUrlSafe } from '../id';
import { getGenre } from '../catalog/genres';
import { getTrackByItunesId, insertTrack } from '../catalog/tracks';
import type { Env } from '../types';
import {
  lookupItunes,
  parseItunesUrl,
  yearFromItunes,
  type ItunesTrack,
} from './itunes';
import { matchItunesForSpotify, parseSpotifyUrl, type MatchCandidate } from './spotify';
import { deletePreviewFromR2, downloadPreviewToR2 } from './r2';

export type ImportError =
  | { code: 'bad_url'; message: string }
  | { code: 'no_preview'; message: string }
  | { code: 'ambiguous'; candidates: MatchCandidate[] }
  | { code: 'duplicate'; existingId: string }
  | { code: 'unknown_genre' };

export interface ImportSuccess {
  id: string;
  artist: string;
  title: string;
  year: number;
}

type ResolveResult =
  | { kind: 'ok'; track: ItunesTrack }
  | { kind: 'err'; err: ImportError };

async function resolveItunes(opts: {
  url: string;
  itunesIdOverride?: number;
}): Promise<ResolveResult> {
  if (opts.itunesIdOverride !== undefined) {
    const t = await lookupItunes({ trackId: opts.itunesIdOverride });
    if (!t) {
      return {
        kind: 'err',
        err: { code: 'no_preview', message: 'iTunes id override yielded no usable track' },
      };
    }
    return { kind: 'ok', track: t };
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
    return { kind: 'ok', track: t };
  }

  const spotify = parseSpotifyUrl(opts.url);
  if (spotify) {
    let match;
    try {
      match = await matchItunesForSpotify(opts.url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'spotify metadata fetch failed';
      return { kind: 'err', err: { code: 'no_preview', message: `spotify: ${msg}` } };
    }
    if (match.kind === 'unique') return { kind: 'ok', track: match.track };
    if (match.kind === 'ambiguous') {
      return { kind: 'err', err: { code: 'ambiguous', candidates: match.candidates } };
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
    url: string;
    genreSlug: string;
    itunesIdOverride?: number;
  },
): Promise<ImportSuccess | ImportError> {
  // 1. Genre check first — cheapest validation, and guarantees we never
  // touch iTunes/R2 for an unknown genre.
  const genre = await getGenre(env.CATALOG, opts.genreSlug);
  if (!genre) return { code: 'unknown_genre' };

  // 2. Resolve URL → ItunesTrack (or a typed error).
  const resolved = await resolveItunes({
    url: opts.url,
    ...(opts.itunesIdOverride !== undefined ? { itunesIdOverride: opts.itunesIdOverride } : {}),
  });
  if (resolved.kind === 'err') return resolved.err;
  const t = resolved.track;

  // 3. Dedupe by iTunes id before any R2 work.
  const existing = await getTrackByItunesId(env.CATALOG, t.trackId);
  if (existing) {
    return { code: 'duplicate', existingId: existing.id };
  }

  // 4. Validate release year before any R2 work. yearFromItunes returns 0
  // for malformed/missing releaseDate; the plausible-year window catches that.
  const year = yearFromItunes(t);
  const currentYear = new Date().getUTCFullYear();
  if (year < 1900 || year > currentYear + 2) {
    return { code: 'no_preview', message: 'iTunes track missing or invalid release year' };
  }

  // 5. Generate internal id, download preview, insert row. On D1 unique-
  // constraint races, remove the orphan R2 object before surfacing the error.
  const id = randomUrlSafe(12);

  let r2Key: string;
  try {
    r2Key = await downloadPreviewToR2(env, { trackId: id, previewUrl: t.previewUrl });
  } catch (err) {
    return {
      code: 'no_preview',
      message: err instanceof Error ? err.message : 'preview download failed',
    };
  }

  try {
    await insertTrack(env.CATALOG, {
      id,
      genre_slug: opts.genreSlug,
      artist: t.artistName,
      title: t.trackName,
      year,
      itunes_id: t.trackId,
      source_url: opts.url,
      preview_url: t.previewUrl,
      r2_key: r2Key,
      duration_ms: t.trackTimeMillis ?? null,
      artwork_url: t.artworkUrl100 ?? null,
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
      // Try to surface the colliding row's id. If we collided on itunes_id,
      // getTrackByItunesId will find it; otherwise (artist, title, year)
      // dedupe — no easy lookup, so omit existingId precision.
      const dupe = await getTrackByItunesId(env.CATALOG, t.trackId);
      return { code: 'duplicate', existingId: dupe?.id ?? '' };
    }
    throw err;
  }

  return { id, artist: t.artistName, title: t.trackName, year };
}
