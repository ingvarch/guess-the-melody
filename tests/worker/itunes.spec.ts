// iTunes search/lookup module. All HTTP stubbed via vi.stubGlobal('fetch').

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lookupItunes,
  parseItunesUrl,
  searchItunes,
  yearFromItunes,
  type ItunesTrack,
} from '../../src/importer/itunes';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeTrack(overrides: Partial<ItunesTrack> & { trackId: number }): ItunesTrack {
  return {
    artistName: 'Guns N\' Roses',
    trackName: 'Sweet Child o\' Mine',
    releaseDate: '1987-07-21T07:00:00Z',
    previewUrl: 'https://example.com/preview.m4a',
    ...overrides,
  };
}

describe('importer/itunes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('parseItunesUrl', () => {
    it('extracts trackId from a music.apple.com album URL with ?i= query', () => {
      const u = 'https://music.apple.com/us/album/sweet-child-o-mine/716135724?i=716135809';
      expect(parseItunesUrl(u)).toEqual({ trackId: 716135809 });
    });

    it('extracts trackId from an itunes.apple.com album URL with ?i= query', () => {
      const u = 'https://itunes.apple.com/us/album/foo/716135724?i=716135809';
      expect(parseItunesUrl(u)).toEqual({ trackId: 716135809 });
    });

    it('returns null when ?i= is missing', () => {
      expect(parseItunesUrl('https://music.apple.com/us/album/foo/716135724')).toBeNull();
    });

    it('returns null for a non-Apple URL', () => {
      expect(parseItunesUrl('https://open.spotify.com/track/abc')).toBeNull();
    });
  });

  describe('searchItunes', () => {
    it('returns results that have a previewUrl and drops those that do not', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse({
          resultCount: 3,
          results: [
            makeTrack({ trackId: 1 }),
            makeTrack({ trackId: 2, previewUrl: undefined as unknown as string }),
            makeTrack({ trackId: 3 }),
          ],
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const out = await searchItunes({ term: 'guns n roses sweet child' });
      expect(out.map((t) => t.trackId)).toEqual([1, 3]);
    });

    it('uses limit=25 by default', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse({ resultCount: 0, results: [] }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await searchItunes({ term: 'foo' });
      const calledUrl = String(mockFetch.mock.calls[0]?.[0]);
      expect(calledUrl).toContain('itunes.apple.com/search');
      expect(calledUrl).toContain('limit=25');
      expect(calledUrl).toContain('entity=musicTrack');
      expect(calledUrl).toContain('term=foo');
    });

    it('honours an explicit limit', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse({ resultCount: 0, results: [] }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await searchItunes({ term: 'foo', limit: 10 });
      const calledUrl = String(mockFetch.mock.calls[0]?.[0]);
      expect(calledUrl).toContain('limit=10');
    });

    it('throws on non-2xx response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('boom', { status: 500 })),
      );
      await expect(searchItunes({ term: 'foo' })).rejects.toThrow();
    });

    it('throws on malformed JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('not json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
      await expect(searchItunes({ term: 'foo' })).rejects.toThrow();
    });
  });

  describe('lookupItunes', () => {
    it('returns the single result on resultCount > 0 with a previewUrl', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            resultCount: 1,
            results: [makeTrack({ trackId: 716135809 })],
          }),
        ),
      );
      const got = await lookupItunes({ trackId: 716135809 });
      expect(got?.trackId).toBe(716135809);
    });

    it('returns null when resultCount is 0', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ resultCount: 0, results: [] })),
      );
      expect(await lookupItunes({ trackId: 1 })).toBeNull();
    });

    it('returns null when the single result has no previewUrl', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            resultCount: 1,
            results: [makeTrack({ trackId: 1, previewUrl: undefined as unknown as string })],
          }),
        ),
      );
      expect(await lookupItunes({ trackId: 1 })).toBeNull();
    });
  });

  describe('yearFromItunes', () => {
    it('parses the year from a full ISO 8601 timestamp', () => {
      expect(yearFromItunes(makeTrack({ trackId: 1, releaseDate: '1991-02-12T08:00:00Z' }))).toBe(
        1991,
      );
    });

    it('parses the year from a date-only string', () => {
      expect(yearFromItunes(makeTrack({ trackId: 1, releaseDate: '1968-08-26' }))).toBe(1968);
    });
  });
});
