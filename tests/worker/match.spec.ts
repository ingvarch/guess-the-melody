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

describe('scoreMatch: artist must match when the query names one', () => {
  const t = (artistName: string, trackName: string) => ({
    trackId: 1,
    artistName,
    trackName,
    releaseDate: '2020-01-01T00:00:00Z',
    previewUrl: 'https://x/p.m4a',
  });

  it('rejects a title-only hit by an unrelated artist', () => {
    // iTunes is full of cover bands and karaoke cuts carrying the exact title.
    const q = { artist: 'Tate McRae', title: 'greedy' };
    expect(scoreMatch(q, t('Julien Laurent', 'Greedy'))).toBeLessThan(50);
  });

  it('rejects a karaoke rendition credited to a karaoke label', () => {
    const q = { artist: 'Полина Гагарина', title: 'Нет' };
    expect(
      scoreMatch(q, t('Univers Karaoké', 'Нет (Rendu célèbre par Полина Гагарина)')),
    ).toBeLessThan(50);
  });

  it('still accepts the real artist', () => {
    const q = { artist: 'Tate McRae', title: 'greedy' };
    expect(scoreMatch(q, t('Tate McRae', 'greedy'))).toBe(100);
  });

  it('still accepts a collaboration credit that extends the artist', () => {
    const q = { artist: 'Nino Rota', title: 'Love Theme' };
    expect(scoreMatch(q, t('Nino Rota & Carlo Savina', 'Love Theme'))).toBeGreaterThanOrEqual(50);
  });

  it('keeps title-only matching for a query with no artist', () => {
    const q = { artist: '', title: 'greedy' };
    expect(scoreMatch(q, t('Julien Laurent', 'Greedy'))).toBeGreaterThanOrEqual(50);
  });
});
