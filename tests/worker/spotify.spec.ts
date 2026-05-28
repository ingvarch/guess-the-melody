// Spotify Web API metadata + iTunes match. All HTTP stubbed.

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

const TEST_CLIENT_ID = 'test-id';
const TEST_CLIENT_SECRET = 'test-secret';

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
    it('returns artist + title from the Web API track object', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'accounts.spotify.com/api/token': () =>
            jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
          'api.spotify.com/v1/tracks': () =>
            jsonResponse({
              name: "Sweet Child o' Mine",
              artists: [{ name: "Guns N' Roses" }],
            }),
        }),
      );
      const meta = await metadataFromSpotify(
        'https://open.spotify.com/track/abc',
        TEST_CLIENT_ID,
        TEST_CLIENT_SECRET,
      );
      expect(meta).toEqual({ artist: "Guns N' Roses", title: "Sweet Child o' Mine" });
    });

    it('uses the first artist when multiple are returned', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'accounts.spotify.com/api/token': () =>
            jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
          'api.spotify.com/v1/tracks': () =>
            jsonResponse({
              name: 'Despacito',
              artists: [{ name: 'Luis Fonsi' }, { name: 'Daddy Yankee' }],
            }),
        }),
      );
      const meta = await metadataFromSpotify(
        'https://open.spotify.com/track/xyz',
        TEST_CLIENT_ID,
        TEST_CLIENT_SECRET,
      );
      expect(meta).toEqual({ artist: 'Luis Fonsi', title: 'Despacito' });
    });

    it('throws when the token endpoint returns non-2xx', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'accounts.spotify.com/api/token': () =>
            new Response('invalid_client', { status: 400 }),
        }),
      );
      await expect(
        metadataFromSpotify(
          'https://open.spotify.com/track/abc',
          TEST_CLIENT_ID,
          TEST_CLIENT_SECRET,
        ),
      ).rejects.toThrow(/token request failed/);
    });

    it('throws when the track API returns non-2xx', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'accounts.spotify.com/api/token': () =>
            jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
          'api.spotify.com/v1/tracks': () => new Response('not found', { status: 404 }),
        }),
      );
      await expect(
        metadataFromSpotify(
          'https://open.spotify.com/track/abc',
          TEST_CLIENT_ID,
          TEST_CLIENT_SECRET,
        ),
      ).rejects.toThrow(/Spotify API failed/);
    });

    it('throws when the track response is missing artist/title', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'accounts.spotify.com/api/token': () =>
            jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
          'api.spotify.com/v1/tracks': () => jsonResponse({ name: '', artists: [] }),
        }),
      );
      await expect(
        metadataFromSpotify(
          'https://open.spotify.com/track/abc',
          TEST_CLIENT_ID,
          TEST_CLIENT_SECRET,
        ),
      ).rejects.toThrow(/could not extract artist\/title/);
    });
  });

  describe('matchItunesForSpotify', () => {
    it('returns kind=unique when a single result is an exact match', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'accounts.spotify.com/api/token': () =>
            jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
          'api.spotify.com/v1/tracks': () =>
            jsonResponse({
              name: "Sweet Child o' Mine",
              artists: [{ name: "Guns N' Roses" }],
            }),
          'itunes.apple.com/search': () => jsonResponse({
            resultCount: 1,
            results: [itunesTrack({ trackId: 1 })],
          }),
        }),
      );

      const out = await matchItunesForSpotify(
        'https://open.spotify.com/track/abc',
        TEST_CLIENT_ID,
        TEST_CLIENT_SECRET,
      );
      expect(out.kind).toBe('unique');
      if (out.kind === 'unique') {
        expect(out.track.trackId).toBe(1);
      }
    });

    it('returns kind=ambiguous when multiple results score >= 80', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'accounts.spotify.com/api/token': () =>
            jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
          'api.spotify.com/v1/tracks': () =>
            jsonResponse({
              name: 'Yesterday',
              artists: [{ name: 'The Beatles' }],
            }),
          'itunes.apple.com/search': () => jsonResponse({
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

      const out = await matchItunesForSpotify(
        'https://open.spotify.com/track/abc',
        TEST_CLIENT_ID,
        TEST_CLIENT_SECRET,
      );
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
          'accounts.spotify.com/api/token': () =>
            jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
          'api.spotify.com/v1/tracks': () =>
            jsonResponse({
              name: 'Some Song',
              artists: [{ name: 'Some Artist' }],
            }),
          'itunes.apple.com/search': () => jsonResponse({
            resultCount: 1,
            results: [
              itunesTrack({ trackId: 9, artistName: 'Other', trackName: 'Different' }),
            ],
          }),
        }),
      );

      const out = await matchItunesForSpotify(
        'https://open.spotify.com/track/abc',
        TEST_CLIENT_ID,
        TEST_CLIENT_SECRET,
      );
      expect(out.kind).toBe('none');
    });

    it('scores an exact case-insensitive match as 100 (single result => unique)', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          'accounts.spotify.com/api/token': () =>
            jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
          'api.spotify.com/v1/tracks': () =>
            jsonResponse({
              name: 'YESTERDAY',
              artists: [{ name: 'the beatles' }],
            }),
          'itunes.apple.com/search': () => jsonResponse({
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

      const out = await matchItunesForSpotify(
        'https://open.spotify.com/track/abc',
        TEST_CLIENT_ID,
        TEST_CLIENT_SECRET,
      );
      expect(out.kind).toBe('unique');
      if (out.kind === 'unique') {
        expect(out.track.trackId).toBe(1);
      }
    });
  });
});
