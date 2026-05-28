// Unit tests for the landing-page click handler. We exercise `startGame`
// directly with stubbed `fetchFn` + `location` so the module stays decoupled
// from a real DOM. The module's bottom-of-file auto-init guards on
// `typeof document !== 'undefined'`, which is false in Bun, so importing
// here must not throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../public/static/js/main-landing.js');
const { startGame, init } = mod;

function fakeLocation() {
  return { href: '' };
}

test('startGame: POSTs /api/session and redirects to /s/<id>/ on success', async () => {
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
