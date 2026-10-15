import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_CUE_MS } from '../../public/static/js/logic.js';
import { LIFT_SEC, SWING_SEC } from '../../public/static/js/turntable.js';
import { CUE_SOUNDS, cueSchedule, playCue, createCuePlayer } from '../../public/static/js/jukebox-sound.js';

const CUE_SEC = RECORD_CUE_MS / 1000;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const find = (list, kind) => list.find((s) => s.kind === kind);

test('CUE_SOUNDS: the needle sound lands with the tonearm, before the music', () => {
  const needle = find(CUE_SOUNDS, 'needle');
  // The deck starts at the Play press, lifts, swings over and lowers the arm.
  assert.ok(near(needle.at, -CUE_SEC + 2 * LIFT_SEC + SWING_SEC), `needle at ${needle.at}`);
  assert.ok(needle.at < 0);
  CUE_SOUNDS.forEach((s) => assert.ok(s.at >= -CUE_SEC, `${s.kind} starts before the Play press`));
});

test('cueSchedule: at the Play press every sound lies ahead, the record drop first', () => {
  const plan = cueSchedule(CUE_SEC);
  assert.deepEqual(plan.map((s) => s.kind).sort(), CUE_SOUNDS.map((s) => s.kind).sort());
  assert.equal(find(plan, 'drop').inSec, 0);
  assert.ok(near(find(plan, 'needle').inSec, 2 * LIFT_SEC + SWING_SEC));
});

test('cueSchedule: a screen that hears of the press a moment late still plays the drop', () => {
  const plan = cueSchedule(CUE_SEC - 0.15);
  assert.equal(find(plan, 'drop').inSec, 0);
  assert.equal(find(plan, 'motor').inSec, 0);
});

test('cueSchedule: joining mid-cue skips what has passed and shortens what is running', () => {
  const plan = cueSchedule(0.8);
  assert.equal(find(plan, 'drop'), undefined, 'no late clunk');
  const motor = find(plan, 'motor');
  assert.equal(motor.inSec, 0);
  assert.ok(near(motor.dur, find(CUE_SOUNDS, 'motor').dur - (CUE_SEC - 0.8)));
  assert.ok(find(plan, 'needle'), 'the needle is still ahead');
});

// A Web Audio stand-in that records when each source starts and what feeds the output.
function fakeContext(state = 'running') {
  const started = [];
  const param = () => ({
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {},
  });
  const node = (extra = {}) => ({
    connections: [],
    connect(dest) { this.connections.push(dest); return dest; },
    disconnect() { this.connections = []; },
    ...extra,
  });
  const source = (kind) => node({
    kind,
    start(t) { started.push({ kind, t }); },
    stop() {},
  });
  return {
    state,
    currentTime: 10,
    sampleRate: 8000,
    started,
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param() }),
    createOscillator: () => Object.assign(source('osc'), { type: '', frequency: param() }),
    createBufferSource: () => Object.assign(source('buffer'), { buffer: null }),
    createBuffer: (channels, length) => ({ length, getChannelData: () => new Float32Array(length) }),
  };
}

test('playCue: schedules the sounds on the audio clock through one output', () => {
  const ctx = fakeContext();
  const out = { name: 'analyser' };
  const cue = playCue(ctx, out, CUE_SEC);
  assert.ok(cue);
  const times = ctx.started.map((s) => s.t);
  assert.ok(times.includes(10), 'the drop starts right away');
  assert.ok(times.some((t) => near(t, 10 + 2 * LIFT_SEC + SWING_SEC)), 'the needle lands with the arm');
  assert.ok(times.every((t) => t >= 10));
});

test('playCue: stop cuts every sound at once', () => {
  const ctx = fakeContext();
  const out = {};
  let master = null;
  const createGain = ctx.createGain;
  ctx.createGain = () => {
    const g = createGain();
    master ??= g;
    return g;
  };
  playCue(ctx, out, CUE_SEC).stop();
  assert.deepEqual(master.connections, [], 'the master gain no longer feeds the output');
});

test('playCue: a locked audio context plays nothing (no late clunk after unlock)', () => {
  const ctx = fakeContext('suspended');
  assert.equal(playCue(ctx, {}, CUE_SEC), null);
  assert.equal(ctx.started.length, 0);
});

function cueState(start, extra = {}) {
  return { phase: 'playing', audioStartTimestamp: start, audioPausedTimestamp: null, ...extra };
}

function makePlayer() {
  const calls = [];
  const player = createCuePlayer({
    play: (inSec) => {
      const handle = { inSec, stopped: false, stop() { this.stopped = true; } };
      calls.push(handle);
      return handle;
    },
  });
  return { player, calls };
}

test('createCuePlayer: plays once per Play press, timed to the music start', () => {
  const { player, calls } = makePlayer();
  player.sync(cueState(12_000), 10_000);
  player.sync(cueState(12_000), 10_250);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].inSec, 2);
});

test('createCuePlayer: the crackle runs on into the music', () => {
  const { player, calls } = makePlayer();
  player.sync(cueState(12_000), 10_000);
  player.sync(cueState(12_000), 12_300);
  assert.equal(calls[0].stopped, false);
});

test('createCuePlayer: a pause, a seek or leaving the round stops the cue', () => {
  for (const next of [
    cueState(12_000, { audioPausedTimestamp: 10_500 }),
    cueState(10_500),
    { phase: 'idle', audioStartTimestamp: null, audioPausedTimestamp: null },
  ]) {
    const { player, calls } = makePlayer();
    player.sync(cueState(12_000), 10_000);
    player.sync(next, 10_500);
    assert.equal(calls[0].stopped, true);
  }
});

test('createCuePlayer: no cue for a clip that is already playing', () => {
  const { player, calls } = makePlayer();
  player.sync(cueState(9_000), 10_000);
  assert.equal(calls.length, 0);
});

test('createCuePlayer: tries again while the audio is not ready yet', () => {
  let ready = false;
  const calls = [];
  const player = createCuePlayer({ play: (inSec) => (ready ? (calls.push(inSec), { stop() {} }) : null) });
  player.sync(cueState(12_000), 10_000);
  ready = true;
  player.sync(cueState(12_000), 10_500);
  assert.deepEqual(calls, [1.5]);
});
