// Unit tests for host POST dispatchers. The module is pure — every action
// takes an injectable `fetchFn` so the tests never touch the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../public/static/js/host-actions.js');
const {
  postAction,
  addTeam,
  renameTeam,
  removeTeam,
  spin,
  play,
  replay,
  seek,
  award,
  reveal,
  next,
  endgame,
  fetchGenres,
  fetchState,
} = mod;

function okResponse(body = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function captureFetch(response = okResponse()) {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return typeof response === 'function' ? response() : response;
  };
  return { fetchFn, calls };
}

test('postAction: POSTs JSON body to /s/<id>/api/state and returns parsed body', async () => {
  const { fetchFn, calls } = captureFetch(okResponse({ ok: true }));
  const result = await postAction(fetchFn, 'sess1', { action: 'noop' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/s/sess1/api/state');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'noop' });
  assert.deepEqual(result, { ok: true });
});

test('postAction: throws with status + text on non-2xx', async () => {
  const fetchFn = async () =>
    new Response('boom', { status: 409 });
  await assert.rejects(
    () => postAction(fetchFn, 's', { action: 'spin' }),
    /action spin failed: 409 boom/,
  );
});

test('addTeam: posts team.add with id + name', async () => {
  const { fetchFn, calls } = captureFetch();
  await addTeam(fetchFn, 's', 't1', 'Cats');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    action: 'team.add',
    id: 't1',
    name: 'Cats',
  });
});

test('renameTeam: posts team.rename with id + name', async () => {
  const { fetchFn, calls } = captureFetch();
  await renameTeam(fetchFn, 's', 't1', 'Dogs');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    action: 'team.rename',
    id: 't1',
    name: 'Dogs',
  });
});

test('removeTeam: posts team.remove with id', async () => {
  const { fetchFn, calls } = captureFetch();
  await removeTeam(fetchFn, 's', 't1');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    action: 'team.remove',
    id: 't1',
  });
});

test('spin: no genre → { action: "spin" } with no selectedGenre key', async () => {
  const { fetchFn, calls } = captureFetch();
  await spin(fetchFn, 's');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'spin' });
});

test('spin: with genre → includes selectedGenre', async () => {
  const { fetchFn, calls } = captureFetch();
  await spin(fetchFn, 's', 'rock');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    action: 'spin',
    selectedGenre: 'rock',
  });
});

test('play: includes now timestamp from Date.now', async () => {
  const { fetchFn, calls } = captureFetch();
  const orig = Date.now;
  Date.now = () => 12345;
  try {
    await play(fetchFn, 's');
  } finally {
    Date.now = orig;
  }
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    action: 'play',
    now: 12345,
  });
});

test('replay: posts { action: "replay" } with no payload (server stamps now)', async () => {
  const { fetchFn, calls } = captureFetch();
  await replay(fetchFn, 's');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'replay' });
});

test('seek: posts positionSec (server stamps now)', async () => {
  const { fetchFn, calls } = captureFetch();
  await seek(fetchFn, 's', 12.5);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'seek', positionSec: 12.5 });
});

test('award: posts award with teamId + points', async () => {
  const { fetchFn, calls } = captureFetch();
  await award(fetchFn, 's', 't1', 2);
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    action: 'award',
    teamId: 't1',
    points: 2,
  });
});

test('reveal: posts { action: "reveal" } with no payload', async () => {
  const { fetchFn, calls } = captureFetch();
  await reveal(fetchFn, 's');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'reveal' });
});

test('next: posts { action: "next" } with no payload', async () => {
  const { fetchFn, calls } = captureFetch();
  await next(fetchFn, 's');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'next' });
});

test('endgame: defaults to resetScores false', async () => {
  const { fetchFn, calls } = captureFetch();
  await endgame(fetchFn, 's');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    action: 'endgame',
    resetScores: false,
  });
});

test('endgame: explicit resetScores true', async () => {
  const { fetchFn, calls } = captureFetch();
  await endgame(fetchFn, 's', true);
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    action: 'endgame',
    resetScores: true,
  });
});

test('fetchGenres: GET /api/genres returns parsed body', async () => {
  const fetchFn = async (url) => {
    assert.equal(url, '/api/genres');
    return okResponse([{ slug: 'rock' }]);
  };
  const body = await fetchGenres(fetchFn);
  assert.deepEqual(body, [{ slug: 'rock' }]);
});

test('fetchGenres: throws on non-2xx', async () => {
  const fetchFn = async () => new Response('x', { status: 500 });
  await assert.rejects(() => fetchGenres(fetchFn), /fetchGenres: 500/);
});

test('fetchState: GET /s/<id>/api/state returns parsed body', async () => {
  const fetchFn = async (url) => {
    assert.equal(url, '/s/abc/api/state');
    return okResponse({ phase: 'idle' });
  };
  const body = await fetchState(fetchFn, 'abc');
  assert.deepEqual(body, { phase: 'idle' });
});

test('fetchState: throws on non-2xx', async () => {
  const fetchFn = async () => new Response('', { status: 404 });
  await assert.rejects(() => fetchState(fetchFn, 'abc'), /fetchState: 404/);
});
