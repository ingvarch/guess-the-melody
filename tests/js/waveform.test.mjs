// attachWaveform fallback contract. The real AudioContext path cannot run
// under happy-dom; what matters for the sound gate is that every return
// shape exposes suspended().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachWaveform } from '../../public/static/js/waveform.js';

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
