// Free-text track matching: line parsing, scoring, and iTunes auto-pick.
// HTTP stubbed via vi.stubGlobal('fetch').

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseQueryLine,
  resolveQueryToItunes,
  scoreMatch,
} from '../../src/importer/match';
import type { ItunesTrack } from '../../src/importer/itunes';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeTrack(o: Partial<ItunesTrack> & { trackId: number }): ItunesTrack {
  return {
    artistName: 'Кино',
    trackName: 'Группа крови',
    releaseDate: '1988-01-01T00:00:00Z',
    previewUrl: 'https://example.com/p.m4a',
    ...o,
  };
}

describe('importer/match', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('parseQueryLine', () => {
    it('splits on an em dash with spaces', () => {
      expect(parseQueryLine('Кино — Группа крови')).toEqual({
        artist: 'Кино',
        title: 'Группа крови',
      });
    });

    it('splits on an en dash with spaces', () => {
      expect(parseQueryLine('Queen – Bohemian Rhapsody')).toEqual({
        artist: 'Queen',
        title: 'Bohemian Rhapsody',
      });
    });

    it('splits on a hyphen with spaces', () => {
      expect(parseQueryLine('Nirvana - Come as You Are')).toEqual({
        artist: 'Nirvana',
        title: 'Come as You Are',
      });
    });

    it('splits on the first separator only (title may contain a dash)', () => {
      expect(parseQueryLine('AC/DC — T.N.T. - Live')).toEqual({
        artist: 'AC/DC',
        title: 'T.N.T. - Live',
      });
    });

    it('trims surrounding whitespace on both sides', () => {
      expect(parseQueryLine('  Сплин   —   Выхода нет  ')).toEqual({
        artist: 'Сплин',
        title: 'Выхода нет',
      });
    });

    it('treats a line with no separator as a title-only query', () => {
      expect(parseQueryLine('Imagine')).toEqual({ artist: '', title: 'Imagine' });
    });
  });

  describe('scoreMatch', () => {
    it('scores an exact case-insensitive match as 100', () => {
      expect(
        scoreMatch(
          { artist: 'кино', title: 'группа крови' },
          makeTrack({ trackId: 1, artistName: 'Кино', trackName: 'Группа крови' }),
        ),
      ).toBe(100);
    });

    it('scores a both-sides substring match as 80', () => {
      expect(
        scoreMatch(
          { artist: 'Кино', title: 'Группа' },
          makeTrack({ trackId: 1, artistName: 'Кино', trackName: 'Группа крови' }),
        ),
      ).toBe(80);
    });

    it('scores a non-match as 0', () => {
      expect(
        scoreMatch(
          { artist: 'Other', title: 'Different' },
          makeTrack({ trackId: 1 }),
        ),
      ).toBe(0);
    });
  });

  describe('resolveQueryToItunes', () => {
    it('auto-picks the highest-scoring playable result', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            resultCount: 2,
            results: [
              makeTrack({ trackId: 1, trackName: 'Группа крови (Live)' }), // 80
              makeTrack({ trackId: 2, trackName: 'Группа крови' }), // 100
            ],
          }),
        ),
      );

      const out = await resolveQueryToItunes({ artist: 'Кино', title: 'Группа крови' });
      expect(out?.trackId).toBe(2);
    });

    it('threads country into the iTunes search', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse({ resultCount: 1, results: [makeTrack({ trackId: 1 })] }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await resolveQueryToItunes({ artist: 'Кино', title: 'Группа крови' }, 'RU');
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain('country=RU');
    });

    it('returns null when nothing scores above the threshold', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            resultCount: 1,
            results: [makeTrack({ trackId: 9, artistName: 'Other', trackName: 'Different' })],
          }),
        ),
      );

      expect(await resolveQueryToItunes({ artist: 'Кино', title: 'Группа крови' })).toBeNull();
    });

    it('returns null when the search yields no results', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ resultCount: 0, results: [] })),
      );
      expect(await resolveQueryToItunes({ artist: 'Кино', title: 'X' })).toBeNull();
    });
  });
});
