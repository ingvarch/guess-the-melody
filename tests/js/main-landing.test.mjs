// Unit tests for the landing-page click handler. We exercise `startGame`
// directly with stubbed `fetchFn` + `location` so the module stays decoupled
// from a real DOM. The module's bottom-of-file auto-init guards on
// `typeof document !== 'undefined'`, which is false in Bun, so importing
// here must not throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../public/static/js/main-landing.js');
const { startGame, init, loadStats } = mod;

function stubEl() {
  return { textContent: '' };
}

function statsDoc(els) {
  return {
    getElementById(id) {
      return els[id] ?? null;
    },
  };
}

function fakeLocation() {
  return { href: '' };
}

test('startGame: POSTs /api/session and redirects to the host console /s/<id>/ on success', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push([url, opts]);
    return new Response(JSON.stringify({ sessionId: 'abc123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const location = fakeLocation();
  const id = await startGame({ fetchFn, location });
  assert.equal(id, 'abc123');
  // The creator is the host: land them on the console (where the owner cookie
  // grants control), not the read-only display.
  assert.equal(location.href, '/s/abc123/');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/session');
  assert.deepEqual(calls[0][1], { method: 'POST' });
});

test('startGame: throws when response is non-2xx', async () => {
  const fetchFn = async () =>
    new Response('boom', { status: 500 });
  const location = fakeLocation();
  await assert.rejects(
    () => startGame({ fetchFn, location }),
    /session creation failed: 500/,
  );
  assert.equal(location.href, '');
});

test('startGame: throws when response body has no sessionId', async () => {
  const fetchFn = async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const location = fakeLocation();
  await assert.rejects(
    () => startGame({ fetchFn, location }),
    /bad session response/,
  );
  assert.equal(location.href, '');
});

test('startGame: propagates network errors from fetchFn', async () => {
  const fetchFn = async () => {
    throw new Error('network down');
  };
  const location = fakeLocation();
  await assert.rejects(
    () => startGame({ fetchFn, location }),
    /network down/,
  );
  assert.equal(location.href, '');
});

test('loadStats: fills #stat-tracks and #stat-genres from /api/stats', async () => {
  const els = { 'stat-tracks': stubEl(), 'stat-genres': stubEl() };
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ tracks: 42, genres: 7 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  await loadStats({ fetchFn, doc: statsDoc(els) });
  assert.equal(calls[0], '/api/stats');
  assert.equal(els['stat-tracks'].textContent, '42');
  assert.equal(els['stat-genres'].textContent, '7');
});

test('loadStats: leaves elements untouched on fetch failure', async () => {
  const els = { 'stat-tracks': stubEl(), 'stat-genres': stubEl() };
  const fetchFn = async () => new Response('boom', { status: 500 });
  await loadStats({ fetchFn, doc: statsDoc(els) });
  assert.equal(els['stat-tracks'].textContent, '');
  assert.equal(els['stat-genres'].textContent, '');
});

test('loadStats: no-op when stat elements are absent', async () => {
  const fetchFn = async () => {
    throw new Error('should not fetch');
  };
  // Must not throw.
  await loadStats({ fetchFn, doc: statsDoc({}) });
});

test('init: no-op when no #start button exists', () => {
  const stubDoc = {
    getElementById(id) {
      assert.equal(id, 'start');
      return null;
    },
  };
  // Must not throw.
  init(stubDoc);
});

test('init: attaches a click listener to the #start button', () => {
  let attachedEvent = null;
  let attachedHandler = null;
  const btn = {
    disabled: false,
    addEventListener(event, handler) {
      attachedEvent = event;
      attachedHandler = handler;
    },
  };
  const stubDoc = {
    getElementById(id) {
      if (id === 'start') return btn;
      return null;
    },
  };
  init(stubDoc);
  assert.equal(attachedEvent, 'click');
  assert.equal(typeof attachedHandler, 'function');
});
