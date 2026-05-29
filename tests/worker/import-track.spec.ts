// Importer orchestrator. Uses real D1 + R2 from cloudflare:test; stubs fetch
// for iTunes search/lookup, Spotify oEmbed, and the preview audio download.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../src/types';
import { importTrack } from '../../src/importer/import-track';
import { getTrack, getTrackByItunesId, insertTrack } from '../../src/catalog/tracks';

const testEnv = env as unknown as Env;

async function resetCatalog(): Promise<void> {
  await testEnv.CATALOG.exec('DELETE FROM tracks');
  await testEnv.CATALOG.prepare(
    `DELETE FROM genres WHERE slug NOT IN ('rock','pop','hip-hop','soundtrack')`,
  ).run();
  await testEnv.CATALOG.batch([
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Rock', sort_order=10, archived=0 WHERE slug='rock'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Pop', sort_order=20, archived=0 WHERE slug='pop'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Hip-Hop', sort_order=30, archived=0 WHERE slug='hip-hop'`,
    ),
    testEnv.CATALOG.prepare(
      `UPDATE genres SET name='Soundtrack', sort_order=40, archived=0 WHERE slug='soundtrack'`,
    ),
  ]);
  const list = await testEnv.AUDIO.list();
  for (const obj of list.objects) {
    await testEnv.AUDIO.delete(obj.key);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function audioResponse(body: string | Uint8Array): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
}

type Route = {
  match: (url: string) => boolean;
  respond: () => Response | Promise<Response>;
};

function routedFetch(routes: Route[]): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const r of routes) {
      if (r.match(url)) return await r.respond();
    }
    throw new Error(`routedFetch: no route for ${url}`);
  });
}

const PREVIEW_PAYLOAD = 'preview-bytes';

const itunesTrackJson = {
  resultCount: 1,
  results: [
    {
      trackId: 716135809,
      artistName: 'Guns N\' Roses',
      trackName: 'Sweet Child o\' Mine',
      releaseDate: '1987-07-21T07:00:00Z',
      previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
      artworkUrl100: 'https://example.com/art100.jpg',
      trackTimeMillis: 30_000,
      collectionName: 'Appetite for Destruction',
    },
  ],
};

describe('importer/import-track', () => {
  beforeEach(async () => {
    await resetCatalog();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('imports an iTunes URL: D1 row written, R2 preview cached', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/lookup'),
          respond: () => jsonResponse(itunesTrackJson),
        },
        {
          match: (u) => u.includes('audio-ssl.itunes.apple.com/preview.m4a'),
          respond: () => audioResponse(PREVIEW_PAYLOAD),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://music.apple.com/us/album/sweet-child-o-mine/716135724?i=716135809',
      genreSlug: 'rock',
    });

    expect('id' in out).toBe(true);
    if ('id' in out) {
      expect(out.artist).toBe("Guns N' Roses");
      expect(out.title).toBe("Sweet Child o' Mine");
      expect(out.year).toBe(1987);

      const row = await getTrack(testEnv.CATALOG, out.id);
      expect(row).not.toBeNull();
      expect(row?.itunes_id).toBe(716135809);
      expect(row?.r2_key).toBe(`tracks/${out.id}.mp3`);
      expect(row?.genre_slug).toBe('rock');
      expect(row?.preview_url).toBe('https://audio-ssl.itunes.apple.com/preview.m4a');
      expect(row?.artwork_url).toBe('https://example.com/art100.jpg');

      const r2Obj = await testEnv.AUDIO.get(`tracks/${out.id}.mp3`);
      expect(r2Obj).not.toBeNull();
    }
  });

  function embedHtml(entity: unknown): string {
    const data = { props: { pageProps: { state: { data: { entity } } } } };
    return `<!doctype html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body>`;
  }

  it('imports a Spotify URL via the embed page (preview straight from Spotify, no iTunes id)', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('open.spotify.com/embed/track'),
          respond: () => new Response(embedHtml({
            title: 'Sweet Child o\' Mine',
            artists: [{ name: 'Guns N\' Roses' }],
            releaseDate: { isoString: '1987-08-21T00:00:00Z' },
            audioPreview: { url: 'https://p.scdn.co/mp3-preview/scom' },
            duration: 356_000,
          }), { status: 200 }),
        },
        {
          match: (u) => u.includes('p.scdn.co/mp3-preview/scom'),
          respond: () => audioResponse(PREVIEW_PAYLOAD),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://open.spotify.com/track/7snQQk1zcKl8gZ92AnueZW',
      genreSlug: 'rock',
    });

    expect('id' in out).toBe(true);
    if ('id' in out) {
      expect(out.artist).toBe('Guns N\' Roses');
      expect(out.year).toBe(1987);
      const row = await getTrack(testEnv.CATALOG, out.id);
      expect(row?.itunes_id).toBeNull();
      expect(row?.preview_url).toBe('https://p.scdn.co/mp3-preview/scom');
    }
  });

  it('falls back to the iTunes match when the embed yields no preview', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          // Embed reachable but missing the preview -> resolver must fall back.
          match: (u) => u.includes('open.spotify.com/embed/track'),
          respond: () => new Response(embedHtml({
            title: 'Sweet Child o\' Mine',
            artists: [{ name: 'Guns N\' Roses' }],
            releaseDate: { isoString: '1987-08-21T00:00:00Z' },
          }), { status: 200 }),
        },
        {
          match: (u) => u.includes('accounts.spotify.com/api/token'),
          respond: () => jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
        },
        {
          match: (u) => u.includes('api.spotify.com/v1/tracks'),
          respond: () => jsonResponse({ name: "Sweet Child o' Mine", artists: [{ name: "Guns N' Roses" }] }),
        },
        {
          match: (u) => u.includes('itunes.apple.com/search'),
          respond: () => jsonResponse(itunesTrackJson),
        },
        {
          match: (u) => u.includes('audio-ssl.itunes.apple.com/preview.m4a'),
          respond: () => audioResponse(PREVIEW_PAYLOAD),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://open.spotify.com/track/7snQQk1zcKl8gZ92AnueZW',
      genreSlug: 'rock',
    });

    expect('id' in out).toBe(true);
    if ('id' in out) {
      const row = await getTrack(testEnv.CATALOG, out.id);
      expect(row?.itunes_id).toBe(716135809); // came from the iTunes fallback
    }
  });

  it('imports a Spotify URL with a unique iTunes match', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('accounts.spotify.com/api/token'),
          respond: () => jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
        },
        {
          match: (u) => u.includes('api.spotify.com/v1/tracks'),
          respond: () =>
            jsonResponse({
              name: "Sweet Child o' Mine",
              artists: [{ name: "Guns N' Roses" }],
            }),
        },
        {
          match: (u) => u.includes('itunes.apple.com/search'),
          respond: () => jsonResponse(itunesTrackJson),
        },
        {
          match: (u) => u.includes('audio-ssl.itunes.apple.com/preview.m4a'),
          respond: () => audioResponse(PREVIEW_PAYLOAD),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://open.spotify.com/track/7snQQk1zcKl8gZ92AnueZW',
      genreSlug: 'rock',
    });

    expect('id' in out).toBe(true);
    if ('id' in out) {
      expect(out.year).toBe(1987);
      const row = await getTrack(testEnv.CATALOG, out.id);
      expect(row?.itunes_id).toBe(716135809);
    }
  });

  it('returns ambiguous when Spotify match yields multiple close iTunes candidates', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('accounts.spotify.com/api/token'),
          respond: () => jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
        },
        {
          match: (u) => u.includes('api.spotify.com/v1/tracks'),
          respond: () =>
            jsonResponse({ name: 'Yesterday', artists: [{ name: 'The Beatles' }] }),
        },
        {
          match: (u) => u.includes('itunes.apple.com/search'),
          respond: () =>
            jsonResponse({
              resultCount: 3,
              results: [
                {
                  trackId: 1,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday (Remastered 2009)',
                  releaseDate: '1965-08-06',
                  previewUrl: 'https://x.example/1.m4a',
                },
                {
                  trackId: 2,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday (Live at the BBC)',
                  releaseDate: '1994-01-01',
                  previewUrl: 'https://x.example/2.m4a',
                },
                {
                  trackId: 3,
                  artistName: 'The Beatles',
                  trackName: 'Yesterday (Anthology)',
                  releaseDate: '1996-01-01',
                  previewUrl: 'https://x.example/3.m4a',
                },
              ],
            }),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://open.spotify.com/track/abc',
      genreSlug: 'rock',
    });

    expect('code' in out && out.code === 'ambiguous').toBe(true);
    if ('code' in out && out.code === 'ambiguous') {
      expect(out.message).toMatch(/несколько совпадений/);
      expect(out.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns no_preview when iTunes lookup returns no results', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/lookup'),
          respond: () => jsonResponse({ resultCount: 0, results: [] }),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://music.apple.com/us/album/foo/1?i=2',
      genreSlug: 'rock',
    });

    expect('code' in out && out.code === 'no_preview').toBe(true);
  });

  it('imports a free-text query: searches iTunes, auto-picks, writes row + R2', async () => {
    let searchUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('itunes.apple.com/search')) {
          searchUrl = url;
          return jsonResponse(itunesTrackJson);
        }
        if (url.includes('audio-ssl.itunes.apple.com/preview.m4a')) {
          return audioResponse(PREVIEW_PAYLOAD);
        }
        throw new Error(`no route for ${url}`);
      }),
    );

    const out = await importTrack(testEnv, {
      query: "Guns N' Roses — Sweet Child o' Mine",
      genreSlug: 'rock',
      country: 'US',
    });

    expect('id' in out).toBe(true);
    if ('id' in out) {
      expect(out.artist).toBe("Guns N' Roses");
      expect(out.title).toBe("Sweet Child o' Mine");
      expect(out.year).toBe(1987);
      const row = await getTrack(testEnv.CATALOG, out.id);
      expect(row?.itunes_id).toBe(716135809);
      expect(row?.source_url).toBeNull();
      expect(row?.r2_key).toBe(`tracks/${out.id}.mp3`);
    }
    // country must reach the iTunes search.
    expect(searchUrl).toContain('country=US');
  });

  it('returns no_preview when a query matches nothing on iTunes', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/search'),
          respond: () => jsonResponse({ resultCount: 0, results: [] }),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      query: 'Nonexistent Artist — No Such Song',
      genreSlug: 'rock',
    });

    expect('code' in out && out.code === 'no_preview').toBe(true);
  });

  it('returns unknown_genre for a missing genre slug (before any HTTP work)', async () => {
    // No fetch stub: if the implementation makes any HTTP call here, the test fails.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('genre check must happen before any fetch');
      }),
    );

    const out = await importTrack(testEnv, {
      url: 'https://music.apple.com/us/album/foo/1?i=2',
      genreSlug: 'does-not-exist',
    });

    expect('code' in out && out.code === 'unknown_genre').toBe(true);
    if ('code' in out && out.code === 'unknown_genre') {
      expect(out.message).toMatch(/Неизвестный жанр/);
    }
  });

  it('returns duplicate when the iTunes id is already in D1', async () => {
    await insertTrack(testEnv.CATALOG, {
      id: 'existing1',
      genre_slug: 'rock',
      artist: "Guns N' Roses",
      title: "Sweet Child o' Mine",
      year: 1987,
      itunes_id: 716135809,
      preview_url: 'https://old.example/p.m4a',
      added_at: 1,
    });

    // The lookup must return the matching track so the importer can read its id;
    // R2 must NOT be hit because dedupe short-circuits before download.
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/lookup'),
          respond: () => jsonResponse(itunesTrackJson),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://music.apple.com/us/album/foo/1?i=716135809',
      genreSlug: 'rock',
    });

    expect('code' in out && out.code === 'duplicate').toBe(true);
    if ('code' in out && out.code === 'duplicate') {
      expect(out.existingId).toBe('existing1');
      expect(out.message).toMatch(/уже есть в каталоге/);
      expect(out.message).toMatch(/Guns N' Roses/);
      expect(out.message).toMatch(/Sweet Child o' Mine/);
    }
  });

  it('returns no_preview when iTunes track has an empty releaseDate', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/lookup'),
          respond: () =>
            jsonResponse({
              resultCount: 1,
              results: [
                {
                  trackId: 12345,
                  artistName: 'No Year Artist',
                  trackName: 'Mystery Track',
                  releaseDate: '',
                  previewUrl: 'https://audio-ssl.itunes.apple.com/noyear.m4a',
                },
              ],
            }),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://music.apple.com/us/album/foo/1?i=12345',
      genreSlug: 'rock',
    });

    expect('code' in out && out.code === 'no_preview').toBe(true);
    if ('code' in out && out.code === 'no_preview') {
      expect(out.message).toMatch(/release year/i);
    }
  });

  it('returns no_preview and swallows R2 rollback failure on duplicate insert', async () => {
    // Pre-existing row with the same (artist, title, year) triggers the UNIQUE
    // constraint. The R2 delete is forced to throw — the original D1 duplicate
    // signal must still win.
    await insertTrack(testEnv.CATALOG, {
      id: 'preexisting1',
      genre_slug: 'rock',
      artist: 'Rollback Artist',
      title: 'Rollback Title',
      year: 2010,
      itunes_id: null,
      preview_url: 'https://other.example/p.m4a',
      added_at: 1,
    });

    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/lookup'),
          respond: () =>
            jsonResponse({
              resultCount: 1,
              results: [
                {
                  trackId: 777,
                  artistName: 'Rollback Artist',
                  trackName: 'Rollback Title',
                  releaseDate: '2010-01-01',
                  previewUrl: 'https://audio-ssl.itunes.apple.com/rb.m4a',
                },
              ],
            }),
        },
        {
          match: (u) => u.includes('audio-ssl.itunes.apple.com/rb.m4a'),
          respond: () => audioResponse(PREVIEW_PAYLOAD),
        },
      ]),
    );

    const deleteSpy = vi
      .spyOn(testEnv.AUDIO, 'delete')
      .mockRejectedValueOnce(new Error('R2 down'));

    const out = await importTrack(testEnv, {
      url: 'https://music.apple.com/us/album/rollback/1?i=777',
      genreSlug: 'rock',
    });

    expect('code' in out && out.code === 'duplicate').toBe(true);
    expect(deleteSpy).toHaveBeenCalled();
    deleteSpy.mockRestore();
  });

  it('returns no_preview when Spotify token endpoint responds non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('accounts.spotify.com/api/token'),
          respond: () => new Response('invalid_client', { status: 400 }),
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://open.spotify.com/track/xyz',
      genreSlug: 'rock',
    });

    expect('code' in out && out.code === 'no_preview').toBe(true);
    if ('code' in out && out.code === 'no_preview') {
      expect(out.message).toMatch(/spotify/i);
    }
  });

  it('returns bad_url for a URL that parses as neither iTunes nor Spotify', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('bad_url path must not fetch');
    }));

    const out = await importTrack(testEnv, {
      url: 'https://example.com/random',
      genreSlug: 'rock',
    });

    expect('code' in out && out.code === 'bad_url').toBe(true);
  });

  it('rolls back the R2 object when D1 insert fails on a unique-constraint race', async () => {
    // Race: lookup returns iTunes id 999. After dedupe check passes, but before
    // insert, a competing row with the same (artist, title, year) is inserted.
    // The importer should remove its R2 object and surface a duplicate error.
    let lookupCount = 0;
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: (u) => u.includes('itunes.apple.com/lookup'),
          respond: () => {
            lookupCount += 1;
            return jsonResponse({
              resultCount: 1,
              results: [
                {
                  trackId: 999,
                  artistName: 'Race Artist',
                  trackName: 'Race Title',
                  releaseDate: '2001-01-01',
                  previewUrl: 'https://audio-ssl.itunes.apple.com/race.m4a',
                },
              ],
            });
          },
        },
        {
          match: (u) => u.includes('audio-ssl.itunes.apple.com/race.m4a'),
          respond: async () => {
            // Inject the colliding row mid-flight so the subsequent D1 insert
            // hits the (artist, title, year) UNIQUE index.
            await insertTrack(testEnv.CATALOG, {
              id: 'racewinner',
              genre_slug: 'rock',
              artist: 'Race Artist',
              title: 'Race Title',
              year: 2001,
              itunes_id: null,
              preview_url: 'https://other.example/p.m4a',
              added_at: 1,
            });
            return audioResponse(PREVIEW_PAYLOAD);
          },
        },
      ]),
    );

    const out = await importTrack(testEnv, {
      url: 'https://music.apple.com/us/album/race/1?i=999',
      genreSlug: 'rock',
    });

    expect(lookupCount).toBe(1);
    expect('code' in out && out.code === 'duplicate').toBe(true);

    // No orphaned R2 object — only the (unrelated) race-winner row exists,
    // and it has no r2 key from the importer.
    const ours = await getTrackByItunesId(testEnv.CATALOG, 999);
    expect(ours).toBeNull();

    const list = await testEnv.AUDIO.list({ prefix: 'tracks/' });
    expect(list.objects).toHaveLength(0);
  });
});
