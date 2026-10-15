// attachWaveform fallback contract. The real AudioContext path cannot run
// under happy-dom; what matters for the sound gate is that every return
// shape exposes suspended().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachWaveform, ringBar, ringBin, ringGeometry, PROGRESS_RING_OUTER } from '../../public/static/js/waveform.js';

// `window` is read at call time. Bun shares one global object across test
// files, so it is installed only for the duration of the call — a leaked
// `window` changes how other modules branch.
function withWindow(win, fn) {
  const had = 'window' in globalThis;
  const prev = globalThis.window;
  globalThis.window = win;
  try {
    return fn();
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
}

test('missing canvas: noop controller with suspended() === false', () => {
  const ctrl = withWindow({}, () => attachWaveform({ audioEl: {}, canvas: null }));
  assert.equal(typeof ctrl.stop, 'function');
  assert.equal(ctrl.suspended(), false);
});

test('no AudioContext: noop controller with suspended() === false', () => {
  const ctrl = withWindow({}, () => attachWaveform({ audioEl: {}, canvas: {} }));
  assert.equal(ctrl.suspended(), false);
});

function assertNear(actual, expected) {
  for (const k of Object.keys(expected)) {
    assert.ok(Math.abs(actual[k] - expected[k]) < 1e-9, `${k}: ${actual[k]} vs ${expected[k]}`);
  }
}

test('ringBar: bars start at the record edge and grow outward with the level', () => {
  const ring = { cx: 100, cy: 100, inner: 50, reach: 30, count: 4 };
  assertNear(ringBar(0, 0, ring), { x1: 100, y1: 50, x2: 100, y2: 50 });
  assertNear(ringBar(0, 255, ring), { x1: 100, y1: 50, x2: 100, y2: 20 });
  assertNear(ringBar(1, 255, ring), { x1: 150, y1: 100, x2: 180, y2: 100 });
});

test('ringBin: both halves of the ring mirror the same low and mid bins', () => {
  assert.equal(ringBin(0, 64), 0);
  assert.equal(ringBin(1, 64), 1);
  assert.equal(ringBin(63, 64), 1);
  assert.equal(ringBin(32, 64), 32);
});

test('stop clears the ring, so no frozen bars stay around a still record', () => {
  const calls = [];
  const c2d = { clearRect: () => calls.push('clear'), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const canvas = { width: 720, height: 720, getContext: () => c2d };
  class FakeAudioContext {
    state = 'running';
    destination = {};
    createMediaElementSource() { return { connect() {} }; }
    createAnalyser() { return { frequencyBinCount: 64, connect() {}, getByteFrequencyData() {} }; }
  }
  const hadRaf = 'requestAnimationFrame' in globalThis;
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    const ctrl = withWindow({ AudioContext: FakeAudioContext }, () => attachWaveform({ audioEl: {}, canvas }));
    calls.length = 0;
    ctrl.stop();
    assert.deepEqual(calls, ['clear']);
  } finally {
    if (hadRaf) globalThis.requestAnimationFrame = prevRaf;
    else delete globalThis.requestAnimationFrame;
  }
});

test('the jukebox sound can share the ring: the context and the analyser input are exposed', () => {
  const canvas = { width: 720, height: 720, getContext: () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }) };
  const analyser = { frequencyBinCount: 64, connect() {}, getByteFrequencyData() {} };
  class FakeAudioContext {
    state = 'running';
    destination = {};
    createMediaElementSource() { return { connect() {} }; }
    createAnalyser() { return analyser; }
  }
  const hadRaf = 'requestAnimationFrame' in globalThis;
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    const ctrl = withWindow({ AudioContext: FakeAudioContext }, () => attachWaveform({ audioEl: {}, canvas }));
    assert.ok(ctrl.context instanceof FakeAudioContext);
    assert.equal(ctrl.input, analyser);
  } finally {
    if (hadRaf) globalThis.requestAnimationFrame = prevRaf;
    else delete globalThis.requestAnimationFrame;
  }
});

test('ringGeometry: the bars start past the progress ring and stay on the canvas', () => {
  const size = 1440;
  const unit = size / 150; // the canvas spans 150 record units, the record radius is 50
  const ring = ringGeometry(size);
  assert.equal(ring.cx, size / 2);
  assert.equal(ring.cy, size / 2);
  assert.ok(ring.inner > PROGRESS_RING_OUTER * unit, 'a gap between the progress ring and the bars');
  assert.ok(PROGRESS_RING_OUTER > 50, 'the progress ring sits outside the record');
  assert.ok(ring.inner + ring.reach <= size / 2, 'full bars stay on the canvas');
  assert.ok(ring.reach > 10 * unit, 'room for the bars to move');
});
