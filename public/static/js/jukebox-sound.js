// Jukebox sounds, synthesised with Web Audio. The record cue: the record
// drops onto the platter, the motor spins up, the tonearm swings over and the
// needle lands, then the record crackles until the music starts and a little
// after. The cue follows the deck's motion (turntable.js), which starts at the
// Play press; its times are seconds relative to the music start. A pause
// lifts the needle off the record and Play drops it back on.

import { RECORD_CUE_MS } from './logic.js';
import { LIFT_SEC, SWING_SEC } from './turntable.js';

const CUE_SEC = RECORD_CUE_MS / 1000;
const NEEDLE_AT = 2 * LIFT_SEC + SWING_SEC - CUE_SEC;
// How long the crackle runs on under the music, fading out.
const CRACKLE_TAIL_SEC = 1;
// A screen hears of the press a little late; sounds that late still play.
const LATE_SEC = 0.3;
const VOLUME = 0.8;

export const CUE_SOUNDS = Object.freeze([
  { kind: 'drop', at: -CUE_SEC },
  { kind: 'motor', at: -CUE_SEC, dur: CUE_SEC + 0.4 },
  { kind: 'servo', at: -CUE_SEC + LIFT_SEC, dur: SWING_SEC },
  { kind: 'needle', at: NEEDLE_AT },
  { kind: 'crackle', at: NEEDLE_AT, dur: -NEEDLE_AT + CRACKLE_TAIL_SEC },
]);

const NEEDLE_SOUNDS = {
  lift: [{ kind: 'lift', inSec: 0 }],
  drop: [{ kind: 'needle', inSec: 0 }, { kind: 'crackle', inSec: 0, dur: 0.7 }],
};

// The sounds still ahead when the music starts in `musicInSec`: when each
// starts from now and, for long ones, how much of it is left.
export function cueSchedule(musicInSec) {
  const plan = [];
  for (const { kind, at, dur } of CUE_SOUNDS) {
    const inSec = musicInSec + at;
    if (dur === undefined) {
      if (inSec > -LATE_SEC) plan.push({ kind, inSec: Math.max(0, inSec) });
      continue;
    }
    const left = dur + Math.min(0, inSec);
    if (left > LATE_SEC) plan.push({ kind, inSec: Math.max(0, inSec), dur: left });
  }
  return plan;
}

function envelope(param, t, peak, attack, decay) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noise(ctx, sec, fill = () => Math.random() * 2 - 1) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.round(sec * ctx.sampleRate)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = fill(i);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

function filtered(ctx, src, type, frequency, q = 1) {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  src.connect(filter);
  return filter;
}

// A low body note falling in pitch: the weight of a record or the stylus.
function thump(ctx, out, t, from, to, peak, decay) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + decay * 0.5);
  const gain = ctx.createGain();
  envelope(gain.gain, t, peak, 0.004, decay);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + decay + 0.05);
}

// A short burst of filtered noise: clicks, rattles, the pop of the needle.
function tick(ctx, out, t, frequency, peak, decay, type = 'bandpass') {
  const src = noise(ctx, decay + 0.02);
  const gain = ctx.createGain();
  envelope(gain.gain, t, peak, 0.002, decay);
  filtered(ctx, src, type, frequency, 1.2).connect(gain).connect(out);
  src.start(t);
}

const SOUNDS = {
  drop(ctx, out, t) {
    thump(ctx, out, t, 110, 55, 0.8, 0.35);
    tick(ctx, out, t, 900, 0.35, 0.06);
    // The record settles with a smaller second bounce.
    thump(ctx, out, t + 0.09, 90, 60, 0.3, 0.15);
  },

  motor(ctx, out, t, dur) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.06, t + Math.min(0.5, dur / 2));
    gain.gain.setValueAtTime(0.06, t + Math.max(dur - 0.5, dur / 2));
    gain.gain.linearRampToValueAtTime(0.0001, t + dur);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 260;
    lowpass.connect(gain).connect(out);
    for (const [type, mult] of [['sawtooth', 1], ['triangle', 2]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      // The platter spins up.
      osc.frequency.setValueAtTime(30 * mult, t);
      osc.frequency.exponentialRampToValueAtTime(50 * mult, t + Math.min(1.2, dur));
      osc.connect(lowpass);
      osc.start(t);
      osc.stop(t + dur);
    }
  },

  servo(ctx, out, t, dur) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.08);
    gain.gain.setValueAtTime(0.05, t + Math.max(0.08, dur - 0.12));
    gain.gain.linearRampToValueAtTime(0.0001, t + dur);
    gain.connect(out);
    const whine = ctx.createOscillator();
    whine.type = 'square';
    whine.frequency.setValueAtTime(140, t);
    whine.frequency.linearRampToValueAtTime(160, t + dur);
    filtered(ctx, whine, 'bandpass', 1100, 4).connect(gain);
    whine.start(t);
    whine.stop(t + dur);
    const hiss = noise(ctx, dur);
    filtered(ctx, hiss, 'bandpass', 2400, 3).connect(gain);
    hiss.start(t);
    tick(ctx, out, t, 3000, 0.15, 0.01, 'highpass');
    tick(ctx, out, t + dur, 3000, 0.15, 0.01, 'highpass');
  },

  needle(ctx, out, t) {
    thump(ctx, out, t, 70, 40, 0.5, 0.18);
    tick(ctx, out, t, 1500, 0.4, 0.008, 'highpass');
  },

  // The stylus leaves the groove: a pop, a short scratch and a light knock.
  lift(ctx, out, t) {
    tick(ctx, out, t, 1800, 0.35, 0.012, 'highpass');
    tick(ctx, out, t, 3200, 0.18, 0.09);
    thump(ctx, out, t, 90, 120, 0.15, 0.08);
  },

  // Surface noise: a soft hiss with random pops, fading out under the music.
  crackle(ctx, out, t, dur) {
    let pop = 0;
    const src = noise(ctx, dur, () => {
      if (Math.random() < 30 / ctx.sampleRate) pop = (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.5);
      pop *= 0.995;
      return pop + (Math.random() * 2 - 1) * 0.015;
    });
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.03);
    gain.gain.setValueAtTime(0.5, t + Math.max(0.03, dur - 0.8));
    gain.gain.linearRampToValueAtTime(0.0001, t + dur);
    const highpass = filtered(ctx, src, 'highpass', 700);
    filtered(ctx, highpass, 'lowpass', 7000).connect(gain).connect(out);
    src.start(t);
  },
};

// Plays the planned sounds into `out` through one gain, so stop() cuts them
// all. A locked context would play them late, after an unlock, so it plays
// nothing instead.
function playPlan(ctx, out, plan) {
  if (ctx.state !== 'running') return null;
  const master = ctx.createGain();
  master.gain.value = VOLUME;
  master.connect(out);
  const t0 = ctx.currentTime;
  for (const { kind, inSec, dur } of plan) SOUNDS[kind](ctx, master, t0 + inSec, dur);
  return { stop: () => master.disconnect() };
}

// The record cue for music starting in `musicInSec`.
export function playCue(ctx, out, musicInSec) {
  return playPlan(ctx, out, cueSchedule(musicInSec));
}

// `kind`: 'lift' (the needle comes off the record) or 'drop' (it goes back on).
export function playNeedle(ctx, out, kind) {
  return playPlan(ctx, out, NEEDLE_SOUNDS[kind]);
}

// Starts the cue once per Play press and stops it if the press is undone: a
// pause, a seek or the round moving on. `play(musicInSec)` returns a handle
// with stop(), or null while the audio is not ready (then it tries again).
export function createCuePlayer({ play }) {
  let current = null;
  return {
    sync(state, now) {
      const start = state.phase === 'playing' ? state.audioStartTimestamp : null;
      const paused = state.audioPausedTimestamp != null;
      if (current && (current.start !== start || paused)) {
        current.handle.stop();
        current = null;
      }
      if (!current && start != null && !paused && now < start) {
        const handle = play((start - now) / 1000);
        if (handle) current = { start, handle };
      }
    },
  };
}

// Plays the needle sounds as the needle moves (display-ui needleAt): leaving
// the groove lifts it, coming back from a pause drops it on. The record cue
// lands the needle with its own sound.
export function createNeedleSounds({ play }) {
  let last = null;
  return {
    sync(at) {
      if (last === 'groove' && at !== 'groove') play('lift');
      else if (last === 'lifted' && at === 'groove') play('drop');
      last = at;
    },
  };
}
