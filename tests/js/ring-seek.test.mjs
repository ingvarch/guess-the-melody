import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { ringPosition, attachRingSeek } from '../../public/static/js/ring-seek.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test("ringPosition: the clip runs clockwise from 12 o'clock", () => {
  assert.ok(near(ringPosition(0, -1), 0));
  assert.ok(near(ringPosition(1, 0), 0.25));
  assert.ok(near(ringPosition(0, 1), 0.5));
  assert.ok(near(ringPosition(-1, 0), 0.75));
  assert.ok(ringPosition(-0.01, -1) > 0.99, 'just before the top is the clip end');
});

function makeRing({ enabled = true } = {}) {
  const win = new Window();
  const ring = win.document.createElement('div');
  win.document.body.append(ring);
  ring.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  const calls = [];
  attachRingSeek(ring, {
    enabled: () => enabled,
    onScrub: (f) => calls.push(['scrub', f]),
    onSeek: (f) => calls.push(['seek', f]),
    onCancel: () => calls.push(['cancel']),
  });
  const pointer = (type, x, y) =>
    ring.dispatchEvent(new win.PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
  return { calls, pointer };
}

test('attachRingSeek: dragging around the ring scrubs, letting go seeks there', () => {
  const { calls, pointer } = makeRing();
  pointer('pointerdown', 200, 100);
  pointer('pointermove', 100, 200);
  pointer('pointerup', 100, 200);
  assert.deepEqual(calls, [['scrub', 0.25], ['scrub', 0.5], ['seek', 0.5]]);
});

test('attachRingSeek: moving without pressing does nothing', () => {
  const { calls, pointer } = makeRing();
  pointer('pointermove', 100, 200);
  pointer('pointerup', 100, 200);
  assert.deepEqual(calls, []);
});

test('attachRingSeek: a cancelled drag seeks nowhere', () => {
  const { calls, pointer } = makeRing();
  pointer('pointerdown', 200, 100);
  pointer('pointercancel', 200, 100);
  pointer('pointerup', 200, 100);
  assert.deepEqual(calls, [['scrub', 0.25], ['cancel']]);
});

test('attachRingSeek: no seeking while the clip cannot seek', () => {
  const { calls, pointer } = makeRing({ enabled: false });
  pointer('pointerdown', 200, 100);
  pointer('pointerup', 200, 100);
  assert.deepEqual(calls, []);
});
