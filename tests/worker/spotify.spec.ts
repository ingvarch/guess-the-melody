// Spotify oEmbed metadata + iTunes match. All HTTP stubbed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  matchItunesForSpotify,
  metadataFromSpotify,
  parseSpotifyUrl,
} from '../../src/importer/spotify';
import type { ItunesTrack } from '../../src/importer/itunes';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function itunesTrack(o: Partial<ItunesTrack> & { trackId: number }): ItunesTrack {
  return {
    artistName: 'Guns N\' Roses',
    trackName: 'Sweet Child o\' Mine',
    releaseDate: '1987-07-21T07:00:00Z',
    previewUrl: 'https://example.com/p.m4a',
    ...o,
  };
}

// fetch mock that routes by URL substring. Keeps individual tests terse.
function mockFetch(map: Record<string, () => Response>): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [needle, make] of Object.entries(map)) {
      if (url.includes(needle)) return make();
    }
    throw new Error(`mockFetch: no route for ${url}`);
  });
}

describe('importer/spotify', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('parseSpotifyUrl', () => {
    it('extracts providerId from a bare track URL', () => {
      expect(parseSpotifyUrl('https://open.spotify.com/track/7snQQk1zcKl8gZ92AnueZW')).toEqual({
        providerId: '7snQQk1zcKl8gZ92AnueZW',
      });
    });

    it('extracts providerId from a track URL with ?si= query', () => {
      expect(
        parseSpotifyUrl('https://open.spotify.com/track/7snQQk1zcKl8gZ92AnueZW?si=foo'),
      ).toEqual({ providerId: '7snQQk1zcKl8gZ92AnueZW' });
    });

    it('returns null for a non-Spotify URL', () => {
      expect(parseSpotifyUrl('https://music.apple.com/us/album/foo/1?i=2')).toBeNull();
    });

    it('returns null for a non-track Spotify URL', () => {
      expect(parseSpotifyUrl('https://open.spotify.com/album/abc')).toBeNull();
    });
  });

  describe('metadataFromSpotify', () => {
    it('uses author_name + title when both are present', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'open.spotify.com/oembed': () =>
            jsonResponse({
              title: "Sweet Child o' Mine",
              author_name: "Guns N' Roses",
            }),
        }),
      );
      const meta = await metadataFromSpotify('https://open.spotify.com/track/abc');
      expect(meta).toEqual({ artist: "Guns N' Roses", title: "Sweet Child o' Mine" });
    });

    it('falls back to splitting "Artist - Title" when only title is present', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'open.spotify.com/oembed': () =>
            jsonResponse({ title: "Guns N' Roses - Sweet Child o' Mine" }),
        }),
      );
      const meta = await metadataFromSpotify('https://open.spotify.com/track/abc');
      expect(meta).toEqual({ artist: "Guns N' Roses", title: "Sweet Child o' Mine" });
    });

    it('throws on non-2xx', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('nope', { status: 404 })),
      );
      await expect(
        metadataFromSpotify('https://open.spotify.com/track/abc'),
      ).rejects.toThrow();
    });
  });

  describe('matchItunesForSpotify', () => {
    it('returns kind=unique when a single result is an exact match', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'open.spotify.com/oembed': () =>
            jsonResponse({ title: "Sweet Child o' Mine", author_name: "Guns N' Roses" }),
          'itunes.apple.com/search': () =>
            jsonResponse({
              resultCount: 1,
              results: [itunesTrack({ trackId: 1 })],
            }),
        }),
      );

      const out = await matchItunesForSpotify('https://open.spotify.com/track/abc');
      expect(out.kind).toBe('unique');
      if (out.kind === 'unique') {
        expect(out.track.trackId).toBe(1);
      }
    });

    it('returns kind=ambiguous when multiple results score >= 80', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'open.spotify.com/oembed': () =>
            jsonResponse({ title: 'Yesterday', author_name: 'The Beatles' }),
          'itunes.apple.com/search': () =>
            jsonResponse({
              resultCount: 3,
              results: [
                itunesTrack({
                  trackId: 1,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday (Remastered 2009)',
                }),
                itunesTrack({
                  trackId: 2,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday (Live)',
                }),
                itunesTrack({
                  trackId: 3,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday (Anthology Version)',
                }),
              ],
            }),
        }),
      );

      const out = await matchItunesForSpotify('https://open.spotify.com/track/abc');
      expect(out.kind).toBe('ambiguous');
      if (out.kind === 'ambiguous') {
        expect(out.candidates.length).toBeGreaterThanOrEqual(2);
        expect(out.candidates.every((c) => c.score >= 80)).toBe(true);
      }
    });

    it('returns kind=none when nothing scores >= 50', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'open.spotify.com/oembed': () =>
            jsonResponse({ title: 'Some Song', author_name: 'Some Artist' }),
          'itunes.apple.com/search': () =>
            jsonResponse({
              resultCount: 1,
              results: [
                itunesTrack({ trackId: 9, artistName: 'Other', trackName: 'Different' }),
              ],
            }),
        }),
      );

      const out = await matchItunesForSpotify('https://open.spotify.com/track/abc');
      expect(out.kind).toBe('none');
    });

    it('scores an exact case-insensitive match as 100 (single result => unique)', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'open.spotify.com/oembed': () =>
            jsonResponse({ title: 'YESTERDAY', author_name: 'the beatles' }),
          'itunes.apple.com/search': () =>
            jsonResponse({
              resultCount: 1,
              results: [
                itunesTrack({
                  trackId: 1,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday',
                }),
              ],
            }),
        }),
      );

      const out = await matchItunesForSpotify('https://open.spotify.com/track/abc');
      expect(out.kind).toBe('unique');
      if (out.kind === 'unique') {
        expect(out.track.trackId).toBe(1);
      }
    });
  });
});
