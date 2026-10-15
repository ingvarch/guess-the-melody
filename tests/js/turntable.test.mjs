import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESTING_DECK, LIFT_SEC, stepDeck, deckStyle, attachTurntable } from '../../public/static/js/turntable.js';

const FRAME = 1 / 60;

function run(deck, seconds, mode, onFrame = () => {}) {
  let d = deck;
  for (let t = 0; t < seconds; t += FRAME) {
    d = stepDeck(d, FRAME, mode);
    onFrame(d);
  }
  return d;
}

test('play: the platter spins up smoothly to 33 1/3 rpm', () => {
  const speeds = [];
  const d = run(RESTING_DECK, 2, 'play', (x) => speeds.push(x.speed));
  speeds.slice(1).forEach((s, i) => assert.ok(s >= speeds[i], 'speed never drops while spinning up'));
  assert.ok(speeds[0] < 0.2, 'no instant jump to full speed');
  assert.equal(d.speed, 1);
  const turned = (stepDeck(d, 0.1, 'play').angle - d.angle + 360) % 360;
  assert.ok(Math.abs(turned - 20) < 1e-9, `200 deg/s at full speed, got ${turned * 10}`);
});

test('play: the arm lifts first, then swings onto the record, then lowers', () => {
  const frames = [];
  const d = run(RESTING_DECK, 3, 'play', (x) => frames.push(x));
  const firstSwing = frames.findIndex((x) => x.arm > 0);
  assert.ok(firstSwing > 0);
  assert.equal(frames[firstSwing - 1].lift, 1, 'fully lifted before it moves');
  const arrived = frames.findIndex((x) => x.arm === 1);
  assert.equal(frames[arrived].lift, 1, 'still lifted when it arrives');
  assert.equal(d.arm, 1);
  assert.equal(d.lift, 0, 'needle down on the record');
});

test('stop (clip end): the needle lifts, the arm returns to rest and the platter stops', () => {
  const playing = run(RESTING_DECK, 3, 'play');
  const frames = [];
  const d = run(playing, 4, 'stop', (x) => frames.push(x));
  const firstReturn = frames.findIndex((x) => x.arm < 1);
  assert.equal(frames[firstReturn - 1].lift, 1, 'needle off the record before the arm moves');
  assert.equal(d.arm, 0);
  assert.equal(d.lift, 0);
  assert.equal(d.speed, 0);
  assert.equal(stepDeck(d, 0.1, 'stop').angle, d.angle, 'platter stands still');
});

test('stop mid-swing: the arm turns back without lowering', () => {
  const frames = [];
  let d = run(RESTING_DECK, 0.6, 'play');
  assert.ok(d.arm > 0 && d.arm < 1, 'caught mid-swing');
  d = run(d, 2, 'stop', (x) => frames.push(x));
  assert.ok(frames.filter((x) => x.arm > 0).every((x) => x.lift === 1));
  assert.equal(d.arm, 0);
});

test('cue (pause): the needle lifts and hovers over the record while the platter keeps turning', () => {
  const playing = run(RESTING_DECK, 3, 'play');
  const frames = [];
  const d = run(playing, 2, 'cue', (x) => frames.push(x));
  assert.ok(frames.every((x) => x.arm === 1), 'the arm stays over the record');
  assert.equal(d.lift, 1);
  assert.equal(d.speed, 1, 'the record keeps spinning');
  assert.equal(deckStyle(d)['--contact'], '0');
});

test('play after a cue: the needle lowers straight back into the groove', () => {
  const cued = run(run(RESTING_DECK, 3, 'play'), 2, 'cue');
  const frames = [];
  const d = run(cued, LIFT_SEC + 0.05, 'play', (x) => frames.push(x));
  assert.ok(frames.every((x) => x.arm === 1), 'no trip back to the rest');
  assert.equal(d.lift, 0);
  assert.equal(deckStyle(d)['--contact'], '1');
});

test('cue before the needle landed: the arm swings over and hovers', () => {
  const d = run(RESTING_DECK, 3, 'cue');
  assert.equal(d.arm, 1);
  assert.equal(d.lift, 1);
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

  deck.set('play');
  frames.pump(3);
  assert.equal(el.props['--arm'], '1');
  assert.equal(el.props['--contact'], '1');
  assert.equal(frames.pending(), 1, 'keeps spinning while playing');

  deck.set('stop');
  frames.pump(5);
  assert.equal(el.props['--arm'], '0');
  assert.equal(frames.pending(), 0, 'idle deck costs no frames');
});

test('attachTurntable: repeating the same state does not start a second loop', () => {
  const frames = fakeFrames();
  const deck = attachTurntable(fakeEl(), { raf: frames.raf });
  deck.set('play');
  deck.set('play');
  assert.equal(frames.pending(), 1);
});

test('attachTurntable: a cued deck keeps the record turning', () => {
  const el = fakeEl();
  const frames = fakeFrames();
  const deck = attachTurntable(el, { raf: frames.raf });
  deck.set('play');
  frames.pump(3);
  deck.set('cue');
  frames.pump(2);
  assert.equal(el.props['--contact'], '0');
  assert.equal(frames.pending(), 1, 'still spinning');
});

test('attachTurntable with reduced motion: the arm jumps into place and the platter stays still', () => {
  const el = fakeEl();
  const frames = fakeFrames();
  const deck = attachTurntable(el, { raf: frames.raf, reduceMotion: true });
  deck.set('play');
  assert.equal(frames.pending(), 0);
  assert.equal(el.props['--arm'], '1');
  assert.equal(el.props['--contact'], '1');
  assert.equal(el.props['--disc-angle'], '0deg');
  deck.set('cue');
  assert.equal(el.props['--arm'], '1');
  assert.equal(el.props['--contact'], '0');
  deck.set('stop');
  assert.equal(el.props['--arm'], '0');
});
