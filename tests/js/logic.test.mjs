import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../../public/static/js/logic.js';
import { initialState, addTeam } from '../../public/static/js/state.js';

test('spin: idle -> spinning, fills currentTrack and spinSeed', () => {
  const s = initialState();
  const out = applyAction(s, {
    action: 'spin',
    selectedGenre: 'rock',
    trackId: 'abc',
    spinSeed: 42,
  });
  assert.equal(out.phase, 'spinning');
  assert.equal(out.selectedGenre, 'rock');
  assert.deepEqual(out.currentTrack, { id: 'abc', genre: 'rock' });
  assert.equal(out.spinSeed, 42);
});

test('spin: genrePicked true when payload marks a host-chosen genre', () => {
  const out = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 42, genrePicked: true,
  });
  assert.equal(out.genrePicked, true);
});

test('spin: genrePicked defaults to false when absent (auto pick)', () => {
  const out = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 42,
  });
  assert.equal(out.genrePicked, false);
});

test('next: resets genrePicked to false', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1, genrePicked: true,
  });
  s = applyAction(s, { action: 'play', now: 1 });
  s = applyAction(s, { action: 'next' });
  assert.equal(s.genrePicked, false);
});

test('spin: invalid from non-idle', () => {
  const s = { ...initialState(), phase: 'playing' };
  assert.throws(() => applyAction(s, {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 42,
  }));
});

test('play: spinning -> playing, sets audioStartTimestamp', () => {
  const s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  const out = applyAction(s, { action: 'play', now: 1234567890 });
  assert.equal(out.phase, 'playing');
  assert.equal(out.audioStartTimestamp, 1234567890);
});

test('reveal: playing -> revealed, stores revealedTrack', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = applyAction(s, { action: 'play', now: 1 });
  const out = applyAction(s, {
    action: 'reveal',
    track: { artist: 'A', title: 'T', year: 2020 },
  });
  assert.equal(out.phase, 'revealed');
  assert.deepEqual(out.revealedTrack, { artist: 'A', title: 'T', year: 2020 });
});

test('next: revealed -> idle, dedupes track', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = applyAction(s, { action: 'play', now: 1 });
  s = applyAction(s, { action: 'reveal', track: { artist: 'A', title: 'T', year: 2020 } });
  const out = applyAction(s, { action: 'next' });
  assert.equal(out.phase, 'idle');
  assert.deepEqual(out.playedTrackIds, ['abc']);
  assert.equal(out.currentTrack, null);
  assert.equal(out.revealedTrack, null);
  assert.equal(out.selectedGenre, null);
  assert.equal(out.spinSeed, 0);
  assert.equal(out.audioStartTimestamp, null);
});

test('next: playing -> idle is allowed (skip without reveal)', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = applyAction(s, { action: 'play', now: 1 });
  const out = applyAction(s, { action: 'next' });
  assert.equal(out.phase, 'idle');
  assert.deepEqual(out.playedTrackIds, ['abc']);
});

test('replay: playing -> playing, resets audioStartTimestamp', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = applyAction(s, { action: 'play', now: 1000 });
  const out = applyAction(s, { action: 'replay', now: 5000 });
  assert.equal(out.phase, 'playing');
  assert.equal(out.audioStartTimestamp, 5000);
  assert.deepEqual(out.currentTrack, { id: 'abc', genre: 'rock' });
});

test('replay: rejected outside playing', () => {
  const idle = initialState();
  assert.throws(() => applyAction(idle, { action: 'replay', now: 1 }));
  const spinning = applyAction(idle, { action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1 });
  assert.throws(() => applyAction(spinning, { action: 'replay', now: 1 }));
});

function playingAt(start) {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  return applyAction(s, { action: 'play', now: start });
}

test('reveal: keeps the clip clock, running or paused', () => {
  const track = { artist: 'A', title: 'T', year: 2020 };
  const running = applyAction(playingAt(1000), { action: 'reveal', track });
  assert.equal(running.audioStartTimestamp, 1000);
  assert.equal(running.audioPausedTimestamp, null);

  const paused = applyAction(playingAt(1000), { action: 'pause', now: 6000 });
  const out = applyAction(paused, { action: 'reveal', track });
  assert.equal(out.audioStartTimestamp, 1000);
  assert.equal(out.audioPausedTimestamp, 6000);
});

test('pause: playing stores the pause timestamp, phase stays playing', () => {
  const s = playingAt(1000);
  const out = applyAction(s, { action: 'pause', now: 6000 });
  assert.equal(out.phase, 'playing');
  assert.equal(out.audioStartTimestamp, 1000);
  assert.equal(out.audioPausedTimestamp, 6000);
});

test('pause: rejected outside playing', () => {
  const idle = initialState();
  assert.throws(() => applyAction(idle, { action: 'pause', now: 1 }));
  const spinning = applyAction(idle, { action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1 });
  assert.throws(() => applyAction(spinning, { action: 'pause', now: 1 }));
});

test('pause: second pause keeps the original timestamp (idempotent)', () => {
  let s = applyAction(playingAt(1000), { action: 'pause', now: 6000 });
  s = applyAction(s, { action: 'pause', now: 9000 });
  assert.equal(s.audioPausedTimestamp, 6000);
});

test('resume: shifts audioStartTimestamp by the paused duration and clears the pause', () => {
  // played 5s (1000->6000), paused 3s (6000->9000): start shifts forward 3000.
  let s = applyAction(playingAt(1000), { action: 'pause', now: 6000 });
  const out = applyAction(s, { action: 'resume', now: 9000 });
  assert.equal(out.phase, 'playing');
  assert.equal(out.audioStartTimestamp, 4000);
  assert.equal(out.audioPausedTimestamp, null);
});

test('resume: no-op when not paused', () => {
  const s = playingAt(1000);
  const out = applyAction(s, { action: 'resume', now: 9000 });
  assert.equal(out.audioStartTimestamp, 1000);
  assert.equal(out.audioPausedTimestamp, null);
});

test('resume: rejected outside playing', () => {
  assert.throws(() => applyAction(initialState(), { action: 'resume', now: 1 }));
});

test('play clears any stale pause timestamp', () => {
  const out = playingAt(2000);
  assert.equal(out.audioPausedTimestamp, null);
});

test('replay from a paused clip restarts playing from zero', () => {
  let s = applyAction(playingAt(1000), { action: 'pause', now: 6000 });
  const out = applyAction(s, { action: 'replay', now: 9000 });
  assert.equal(out.phase, 'playing');
  assert.equal(out.audioStartTimestamp, 9000);
  assert.equal(out.audioPausedTimestamp, null);
});

test('seek: rewinds a running clip by restamping the start', () => {
  // Started at 1000, now 11000 = position 10s. Seek back to 4s.
  const s = playingAt(1000);
  const out = applyAction(s, { action: 'seek', positionSec: 4, now: 11000 });
  assert.equal(out.phase, 'playing');
  assert.equal(out.audioStartTimestamp, 7000);
  assert.equal(out.audioPausedTimestamp, null);
});

test('seek: jumps forward as well as back', () => {
  // Position is 10s; asking for 15s must move the clip ahead to 15s.
  const s = playingAt(1000);
  const out = applyAction(s, { action: 'seek', positionSec: 15, now: 11000 });
  assert.equal(out.audioStartTimestamp, -4000);
});

test('seek: negative positions clamp to zero', () => {
  const s = playingAt(1000);
  const out = applyAction(s, { action: 'seek', positionSec: -5, now: 11000 });
  assert.equal(out.audioStartTimestamp, 11000);
});

test('seek: while paused repositions but stays paused', () => {
  // Paused at position 5s (1000 -> 6000). Seek back to 2s: the frozen clock
  // (pausedAt - start) must now read 2s, and the pause must survive.
  let s = applyAction(playingAt(1000), { action: 'pause', now: 6000 });
  const out = applyAction(s, { action: 'seek', positionSec: 2, now: 9000 });
  assert.equal(out.audioStartTimestamp, 4000);
  assert.equal(out.audioPausedTimestamp, 6000);
});

test('seek: forward while paused repositions and stays paused', () => {
  // Paused at 5s; jumping to 10s must hold the pause at the new position.
  let s = applyAction(playingAt(1000), { action: 'pause', now: 6000 });
  const out = applyAction(s, { action: 'seek', positionSec: 10, now: 9000 });
  assert.equal(out.audioStartTimestamp, -4000);
  assert.equal(out.audioPausedTimestamp, 6000);
});

test('seek: rejected outside playing', () => {
  const idle = initialState();
  assert.throws(() => applyAction(idle, { action: 'seek', positionSec: 1, now: 1 }));
  const spinning = applyAction(idle, { action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1 });
  assert.throws(() => applyAction(spinning, { action: 'seek', positionSec: 1, now: 1 }));
});

test('seek: rejects a non-finite position', () => {
  const s = playingAt(1000);
  assert.throws(() => applyAction(s, { action: 'seek', now: 2000 }));
  assert.throws(() => applyAction(s, { action: 'seek', positionSec: 'x', now: 2000 }));
  assert.throws(() => applyAction(s, { action: 'seek', positionSec: NaN, now: 2000 }));
});

test('next from a paused clip clears the pause timestamp', () => {
  let s = applyAction(playingAt(1000), { action: 'pause', now: 6000 });
  const out = applyAction(s, { action: 'next' });
  assert.equal(out.phase, 'idle');
  assert.equal(out.audioPausedTimestamp, null);
});

test('award: allowed in playing and revealed', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = addTeam(s, { id: 't1', name: 'Cats' });
  s = applyAction(s, { action: 'play', now: 1 });
  let out = applyAction(s, { action: 'award', teamId: 't1', points: 2 });
  assert.equal(out.teams[0].score, 2);
  out = applyAction(out, {
    action: 'reveal', track: { artist: 'A', title: 'T', year: 2020 },
  });
  out = applyAction(out, { action: 'award', teamId: 't1', points: 1 });
  assert.equal(out.teams[0].score, 3);
});

test('award: rejected in idle and spinning', () => {
  let s = addTeam(initialState(), { id: 't1', name: 'Cats' });
  assert.throws(() => applyAction(s, { action: 'award', teamId: 't1', points: 1 }));
  s = applyAction(s, { action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1 });
  assert.throws(() => applyAction(s, { action: 'award', teamId: 't1', points: 1 }));
});

test('team CRUD: allowed in any phase', () => {
  let s = initialState();
  s = applyAction(s, { action: 'team.add', id: 't1', name: 'A' });
  s = applyAction(s, { action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1 });
  s = applyAction(s, { action: 'team.add', id: 't2', name: 'B' });
  s = applyAction(s, { action: 'team.rename', id: 't2', name: 'Bee' });
  s = applyAction(s, { action: 'team.remove', id: 't1' });
  assert.equal(s.teams.length, 1);
  assert.equal(s.teams[0].name, 'Bee');
});

test('endgame: hard reset, optionally keeping scores', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = addTeam(s, { id: 't1', name: 'Cats' });
  s = applyAction(s, { action: 'play', now: 1 });
  s = applyAction(s, { action: 'award', teamId: 't1', points: 2 });

  const out1 = applyAction(s, { action: 'endgame', resetScores: false });
  assert.equal(out1.phase, 'idle');
  assert.equal(out1.teams[0].score, 2);
  assert.deepEqual(out1.playedTrackIds, []);

  const out2 = applyAction(s, { action: 'endgame', resetScores: true });
  assert.equal(out2.teams[0].score, 0);
});

test('unknown action throws', () => {
  const s = initialState();
  assert.throws(() => applyAction(s, { action: 'nope' }));
});

test('team.add preserves unrelated fields (playedTrackIds, spinSeed)', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 7,
  });
  s = applyAction(s, { action: 'play', now: 100 });
  s = applyAction(s, { action: 'next' });
  s = applyAction(s, { action: 'team.add', id: 't1', name: 'Cats' });
  assert.deepEqual(s.playedTrackIds, ['abc']);
  assert.equal(s.teams.length, 1);
});
