// Unit tests for admin API wrappers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../public/static/js/admin-api.js');
const {
  getGenres,
  createGenre,
  updateGenre,
  deleteGenre,
  getTracks,
  deleteTrack,
  importTrack,
} = mod;

function captureFetch(response = okResponse()) {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return typeof response === 'function' ? response() : response;
  };
  return { fetchFn, calls };
}

function okResponse(body = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('getGenres: GET /admin/api/genres', async () => {
  const { fetchFn, calls } = captureFetch(okResponse([{ slug: 'rock' }]));
  const result = await getGenres(fetchFn);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/admin/api/genres');
  assert.deepEqual(result, [{ slug: 'rock' }]);
});

test('createGenre: POST with JSON body', async () => {
  const { fetchFn, calls } = captureFetch(okResponse({ slug: 'jazz' }));
  await createGenre(fetchFn, { slug: 'jazz', name: 'Jazz', sortOrder: 50 });
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { slug: 'jazz', name: 'Jazz', sortOrder: 50 });
});

test('createGenre: throws with server error text', async () => {
  const fetchFn = async () => new Response(JSON.stringify({ error: 'duplicate' }), { status: 409 });
  await assert.rejects(() => createGenre(fetchFn, { slug: 'x', name: 'X', sortOrder: 1 }), /duplicate/);
});

test('updateGenre: PATCH with JSON body', async () => {
  const { fetchFn, calls } = captureFetch(okResponse({}));
  await updateGenre(fetchFn, 'rock', { name: 'Rock Music' });
  assert.equal(calls[0].url, '/admin/api/genres/rock');
  assert.equal(calls[0].opts.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { name: 'Rock Music' });
});

test('deleteGenre: DELETE', async () => {
  const { fetchFn, calls } = captureFetch(new Response(null, { status: 204 }));
  await deleteGenre(fetchFn, 'rock');
  assert.equal(calls[0].url, '/admin/api/genres/rock');
  assert.equal(calls[0].opts.method, 'DELETE');
});

test('getTracks: builds query string', async () => {
  const { fetchFn, calls } = captureFetch(okResponse([]));
  await getTracks(fetchFn, { genreSlug: 'rock', search: 'queen', limit: 10, offset: 20 });
  assert.ok(calls[0].url.includes('/admin/api/tracks?'));
  assert.ok(calls[0].url.includes('genre=rock'));
  assert.ok(calls[0].url.includes('search=queen'));
  assert.ok(calls[0].url.includes('limit=10'));
  assert.ok(calls[0].url.includes('offset=20'));
});

test('getTracks: omits empty params', async () => {
  const { fetchFn, calls } = captureFetch(okResponse([]));
  await getTracks(fetchFn, {});
  assert.equal(calls[0].url, '/admin/api/tracks');
});

test('deleteTrack: DELETE by id', async () => {
  const { fetchFn, calls } = captureFetch(new Response(null, { status: 204 }));
  await deleteTrack(fetchFn, 'tr-1');
  assert.equal(calls[0].url, '/admin/api/tracks/tr-1');
  assert.equal(calls[0].opts.method, 'DELETE');
});

test('importTrack: POST with url + genreSlug', async () => {
  const { fetchFn, calls } = captureFetch(okResponse({ id: 't1', artist: 'A', title: 'T', year: 2000 }));
  await importTrack(fetchFn, { url: 'https://spotify.com/track/x', genreSlug: 'rock' });
  assert.equal(calls[0].opts.method, 'POST');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.url, 'https://spotify.com/track/x');
  assert.equal(body.genreSlug, 'rock');
});
