import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESTING_DECK, stepDeck, deckStyle, attachTurntable } from '../../public/static/js/turntable.js';

const FRAME = 1 / 60;

function run(deck, seconds, on, onFrame = () => {}) {
  let d = deck;
  for (let t = 0; t < seconds; t += FRAME) {
    d = stepDeck(d, FRAME, on);
    onFrame(d);
  }
  return d;
}

test('play: the platter spins up smoothly to 33 1/3 rpm', () => {
  const speeds = [];
  const d = run(RESTING_DECK, 2, true, (x) => speeds.push(x.speed));
  speeds.slice(1).forEach((s, i) => assert.ok(s >= speeds[i], 'speed never drops while spinning up'));
  assert.ok(speeds[0] < 0.2, 'no instant jump to full speed');
  assert.equal(d.speed, 1);
  const turned = (stepDeck(d, 0.1, true).angle - d.angle + 360) % 360;
  assert.ok(Math.abs(turned - 20) < 1e-9, `200 deg/s at full speed, got ${turned * 10}`);
});

test('play: the arm lifts first, then swings onto the record, then lowers', () => {
  const frames = [];
  const d = run(RESTING_DECK, 3, true, (x) => frames.push(x));
  const firstSwing = frames.findIndex((x) => x.arm > 0);
  assert.ok(firstSwing > 0);
  assert.equal(frames[firstSwing - 1].lift, 1, 'fully lifted before it moves');
  const arrived = frames.findIndex((x) => x.arm === 1);
  assert.equal(frames[arrived].lift, 1, 'still lifted when it arrives');
  assert.equal(d.arm, 1);
  assert.equal(d.lift, 0, 'needle down on the record');
});

test('pause: the needle lifts, the arm returns to rest and the platter stops', () => {
  const playing = run(RESTING_DECK, 3, true);
  const frames = [];
  const d = run(playing, 4, false, (x) => frames.push(x));
  const firstReturn = frames.findIndex((x) => x.arm < 1);
  assert.equal(frames[firstReturn - 1].lift, 1, 'needle off the record before the arm moves');
  assert.equal(d.arm, 0);
  assert.equal(d.lift, 0);
  assert.equal(d.speed, 0);
  assert.equal(stepDeck(d, 0.1, false).angle, d.angle, 'platter stands still');
});

test('pause mid-swing: the arm turns back without lowering', () => {
  const frames = [];
  let d = run(RESTING_DECK, 0.6, true);
  assert.ok(d.arm > 0 && d.arm < 1, 'caught mid-swing');
  d = run(d, 2, false, (x) => frames.push(x));
  assert.ok(frames.filter((x) => x.arm > 0).every((x) => x.lift === 1));
  assert.equal(d.arm, 0);
});

test('deckStyle: the needle touches the record only when the arm is down on it', () => {
  assert.equal(deckStyle(RESTING_DECK)['--contact'], '0');
  assert.equal(deckStyle({ ...RESTING_DECK, arm: 1, lift: 1 })['--contact'], '0');
  assert.equal(deckStyle({ ...RESTING_DECK, arm: 1, lift: 0 })['--contact'], '1');
  assert.equal(deckStyle({ ...RESTING_DECK, angle: 90 })['--disc-angle'], '90deg');
});

function fakeFrames() {
  const queue = [];
  let t = 0;
  return {
    raf: (cb) => queue.push(cb),
    pending: () => queue.length,
    pump(seconds) {
      for (let s = 0; s < seconds && queue.length; s += FRAME) {
        t += FRAME * 1000;
        queue.shift()(t);
      }
    },
  };
}

function fakeEl() {
  const props = {};
  return { style: { setProperty: (k, v) => { props[k] = v; } }, props };
}

test('attachTurntable: animates the deck on and off, then stops asking for frames', () => {
  const el = fakeEl();
  const frames = fakeFrames();
  const deck = attachTurntable(el, { raf: frames.raf });
  assert.equal(el.props['--arm'], '0');

  deck.set(true);
  frames.pump(3);
  assert.equal(el.props['--arm'], '1');
  assert.equal(el.props['--contact'], '1');
  assert.equal(frames.pending(), 1, 'keeps spinning while playing');

  deck.set(false);
  frames.pump(5);
  assert.equal(el.props['--arm'], '0');
  assert.equal(frames.pending(), 0, 'idle deck costs no frames');
});

test('attachTurntable: repeating the same state does not start a second loop', () => {
  const frames = fakeFrames();
  const deck = attachTurntable(fakeEl(), { raf: frames.raf });
  deck.set(true);
  deck.set(true);
  assert.equal(frames.pending(), 1);
});

test('attachTurntable with reduced motion: the arm jumps into place and the platter stays still', () => {
  const el = fakeEl();
  const frames = fakeFrames();
  const deck = attachTurntable(el, { raf: frames.raf, reduceMotion: true });
  deck.set(true);
  assert.equal(frames.pending(), 0);
  assert.equal(el.props['--arm'], '1');
  assert.equal(el.props['--contact'], '1');
  assert.equal(el.props['--disc-angle'], '0deg');
  deck.set(false);
  assert.equal(el.props['--arm'], '0');
});
