// connectStateStream: EventSource wrapper that survives fatal stream
// failures. Browsers only auto-retry network drops; an HTTP error response
// closes EventSource permanently (readyState CLOSED, per spec).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectStateStream } from '../../public/static/js/sse.js';

class FakeSource {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.listeners = new Map();
    this.closedByClient = false;
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  emit(type, data) {
    this.listeners.get(type)?.({ data });
  }
  close() {
    this.closedByClient = true;
  }
}

function harness() {
  const sources = [];
  const timers = [];
  const states = [];
  const stream = connectStateStream({
    url: '/events',
    onState: (s) => states.push(s),
    makeSource: (u) => {
      const s = new FakeSource(u);
      sources.push(s);
      return s;
    },
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
    },
  });
  return { sources, timers, states, stream };
}

test('forwards parsed state frames to onState', () => {
  const { sources, states } = harness();
  sources[0].emit('state', JSON.stringify({ phase: 'playing' }));
  assert.deepEqual(states, [{ phase: 'playing' }]);
});

test('ignores malformed frames', () => {
  const { sources, states } = harness();
  sources[0].emit('state', '{nope');
  assert.deepEqual(states, []);
});

test('does not reopen while the browser is retrying on its own', () => {
  const { sources, timers } = harness();
  sources[0].readyState = 0; // CONNECTING
  sources[0].emit('error');
  assert.equal(timers.length, 0);
  assert.equal(sources.length, 1);
});

test('reopens after a fatal close, with growing capped backoff', () => {
  const { sources, timers } = harness();
  sources[0].readyState = 2; // CLOSED
  sources[0].emit('error');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1000);
  timers[0].fn();
  assert.equal(sources.length, 2);

  sources[1].readyState = 2;
  sources[1].emit('error');
  assert.equal(timers[1].ms, 2000);
  timers[1].fn();

  // Delay caps at 15s no matter how many consecutive failures.
  for (let i = 2; i < 10; i++) {
    sources[i].readyState = 2;
    sources[i].emit('error');
    timers[i].fn();
  }
  assert.equal(timers.at(-1).ms, 15000);
});

test('a state frame resets the backoff', () => {
  const { sources, timers } = harness();
  sources[0].readyState = 2;
  sources[0].emit('error');
  timers[0].fn();
  sources[1].emit('state', JSON.stringify({ phase: 'idle' }));
  sources[1].readyState = 2;
  sources[1].emit('error');
  assert.equal(timers[1].ms, 1000);
});

test('close() stops reconnection for good', () => {
  const { sources, timers, stream } = harness();
  stream.close();
  assert.ok(sources[0].closedByClient);
  sources[0].readyState = 2;
  sources[0].emit('error');
  if (timers[0]) timers[0].fn();
  assert.equal(sources.length, 1);
});
